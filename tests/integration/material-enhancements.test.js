import test from 'node:test';
import assert from 'node:assert/strict';
import { materialService } from '../../src/services/material.service.js';
import { materialRepository } from '../../src/repositories/material.repository.js';
import { academicService } from '../../src/services/academic.service.js';
import { academicRepository } from '../../src/repositories/academic.repository.js';
import { userRepository } from '../../src/repositories/user.repository.js';

test('Novas Funcionalidades: Agendamento, Bulk Actions, Feedback Discente e Alt Texts', async (t) => {
  const admin = { id: 1, roleCode: 'ADMINISTRADOR', name: 'Administrador UFG' };
  const teacher = { id: 2, roleCode: 'PROFESSOR', name: 'Prof. Carlos' };
  const student = { id: 4, roleCode: 'ALUNO', name: 'Lucas Aluno' };
  
  // Criar curso, disciplina e turma dedicados para este teste
  const suffix = Date.now();
  const course = await academicService.createCourse({
    departmentId: 1,
    code: `CS-${suffix}`,
    name: 'Ciencia da Computacao',
    modality: 'PRESENCIAL',
    durationSemesters: 8
  }, admin);

  const subject = await academicService.createSubject({
    departmentId: 1,
    code: `DISC-${suffix}`,
    name: 'Sistemas Embarcados',
    description: 'Ementa',
    workloadHours: 64
  }, admin);

  const testClass = await academicService.createClass({
    courseId: course.id,
    subjectId: subject.id,
    academicPeriodId: 1,
    code: `T-${suffix}`
  }, admin);

  await academicService.assignTeacher(testClass.id, teacher.id, 'TITULAR', admin);
  await academicService.enrollStudent(testClass.id, student.id, admin);

  await t.test('1. Agendamento de Liberação: Aluno não acessa se publish_at for futuro', async () => {
    const futureDate = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const { material } = await materialService.uploadMaterial({
      subjectId: subject.id,
      classId: testClass.id,
      title: 'Material Agendado Futuro',
      description: 'Aula futura',
      category: 'SLIDE',
      originalFilename: 'aula_futura.pdf',
      publishAt: futureDate
    }, teacher);

    materialRepository.updateMaterialStatus(material.id, 'APROVADO');

    const teacherCanView = await materialService.canUserViewMaterial(teacher, material.id);
    assert.equal(teacherCanView, true);

    const studentCanView = await materialService.canUserViewMaterial(student, material.id);
    assert.equal(studentCanView, false, 'Aluno não deve visualizar material agendado para o futuro');

    const studentCanDownload = await materialService.canUserDownloadMaterial(student, material.id);
    assert.equal(studentCanDownload, false, 'Aluno não deve baixar material agendado para o futuro');
  });

  await t.test('2. Ações em Lote: Aprovação e Reprocessamento em Massa', async () => {
    const { material: m1 } = await materialService.uploadMaterial({
      subjectId: subject.id,
      classId: testClass.id,
      title: 'Material Lote 1',
      category: 'APOSTILA',
      originalFilename: 'lote1.pdf'
    }, teacher);

    const { material: m2 } = await materialService.uploadMaterial({
      subjectId: subject.id,
      classId: testClass.id,
      title: 'Material Lote 2',
      category: 'APOSTILA',
      originalFilename: 'lote2.pdf'
    }, teacher);

    const resApprove = await materialService.executeBulkAction([m1.id, m2.id], 'APPROVE', admin);
    assert.equal(resApprove.affected, 2);

    const updatedM1 = materialRepository.findMaterialById(m1.id);
    assert.equal(updatedM1.current_status, 'APROVADO');

    const resReprocess = await materialService.executeBulkAction([m1.id, m2.id], 'REPROCESS', admin);
    assert.equal(resReprocess.affected, 2);

    const reprocessedM1 = materialRepository.findMaterialById(m1.id);
    assert.equal(reprocessedM1.current_status, 'AGUARDANDO_PROCESSAMENTO');
  });

  await t.test('3. Canal de Feedback de Acessibilidade Discente', async () => {
    const { material } = await materialService.uploadMaterial({
      subjectId: subject.id,
      classId: testClass.id,
      title: 'Material para Feedback',
      category: 'SLIDE',
      originalFilename: 'feedback_test.pdf'
    }, teacher);

    const feedback = await materialService.submitFeedback({
      materialId: material.id,
      issueType: 'FORMULA',
      description: 'A fórmula de matriz de covariância no slide 4 está truncada no leitor de tela.'
    }, student);

    assert.ok(feedback.id);
    assert.equal(feedback.issue_type, 'FORMULA');
    assert.equal(feedback.status, 'ABERTO');

    const feedbacks = materialRepository.listFeedbacksByMaterial(material.id);
    assert.equal(feedbacks.length, 1);
    assert.equal(feedbacks[0].description, 'A fórmula de matriz de covariância no slide 4 está truncada no leitor de tela.');
  });

  await t.test('4. Validação de Descrições de Imagens (Alt Text Review)', async () => {
    const { version } = await materialService.uploadMaterial({
      subjectId: subject.id,
      classId: testClass.id,
      title: 'Material com Imagens',
      category: 'SLIDE',
      originalFilename: 'alt_test.pdf'
    }, teacher);

    const alt = materialRepository.createAltText({
      materialVersionId: version.id,
      imageUrlOrPath: '/public/images/figura1.png',
      aiSuggestedAlt: 'Diagrama de blocos da arquitetura de Von Neumann'
    });

    assert.ok(alt.id);
    assert.equal(alt.status, 'PENDENTE');

    const updated = materialRepository.updateAltText(alt.id, {
      humanReviewedAlt: 'Diagrama de blocos detalhado exibindo CPU, barramento e memória principal.',
      status: 'APROVADO',
      reviewedByUserId: teacher.id
    });

    assert.equal(updated.status, 'APROVADO');
    assert.equal(updated.human_reviewed_alt, 'Diagrama de blocos detalhado exibindo CPU, barramento e memória principal.');
  });
});
