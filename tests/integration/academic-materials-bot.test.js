import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app.js';
import { academicService } from '../../src/services/academic.service.js';
import { academicRepository } from '../../src/repositories/academic.repository.js';
import { materialService } from '../../src/services/material.service.js';
import { materialRepository } from '../../src/repositories/material.repository.js';
import { botAcessService } from '../../src/integrations/bot-acess/service.js';

test('Testes de Módulos Acadêmicos, Matriz Flexível, Materiais e bot-acess', async (t) => {
  const app = await buildApp({ logger: false });

  const adminActor = { id: 1, roleCode: 'ADMINISTRADOR' };
  const teacherActor = { id: 2, roleCode: 'PROFESSOR' };
  const studentActor = { id: 4, roleCode: 'ALUNO' };

  let course, subject, newClass, createdMaterial, createdVersion;

  await t.test('1. Criação de Curso e Disciplina no Departamento INF', async () => {
    const uniqueSuffix = Date.now();
    course = await academicService.createCourse({
      departmentId: 1,
      code: `ES-${uniqueSuffix}`,
      name: 'Engenharia de Software',
      modality: 'PRESENCIAL',
      durationSemesters: 8
    }, adminActor);

    subject = await academicService.createSubject({
      departmentId: 1,
      code: `A11Y-${uniqueSuffix}`,
      name: 'Acessibilidade em Sistemas Web',
      description: 'Ementa sobre WCAG e design inclusivo',
      workloadHours: 64
    }, adminActor);

    assert.ok(course.id);
    assert.ok(subject.id);
    assert.equal(course.code, `ES-${uniqueSuffix}`);
  });

  await t.test('2. Matriz Curricular M:N - Compartilhar disciplina no curso', async () => {
    await academicService.linkSubjectToCourse(course.id, subject.id, 3, true, adminActor);
    const matrix = await academicService.getCourseSubjects(course.id);

    assert.equal(matrix.length, 1);
    assert.equal(matrix[0].subject_code, subject.code);
    assert.equal(matrix[0].recommended_semester, 3);
  });

  await t.test('3. Criação de Turma, Alocação Docente e Matrícula Discente', async () => {
    newClass = await academicService.createClass({
      courseId: course.id,
      subjectId: subject.id,
      academicPeriodId: 1,
      code: 'TURMA-2026-1'
    }, adminActor);

    await academicService.assignTeacher(newClass.id, teacherActor.id, 'TITULAR', adminActor);
    await academicService.enrollStudent(newClass.id, studentActor.id, adminActor);

    const isTeacher = academicRepository.isTeacherOfClass(teacherActor.id, newClass.id);
    const isStudent = academicRepository.isStudentInClass(studentActor.id, newClass.id);

    assert.equal(isTeacher, true);
    assert.equal(isStudent, true);
  });

  await t.test('4. Upload de Material e Criação de Job Assíncrono com Idempotência', async () => {
    const uploadResult = await materialService.uploadMaterial({
      subjectId: subject.id,
      classId: newClass.id,
      title: 'Apostila de Leitores de Tela',
      category: 'APOSTILA',
      originalFilename: 'apostila_nvda.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 10240,
      fileBuffer: Buffer.from('TEST_PDF_BYTES')
    }, teacherActor);

    createdMaterial = uploadResult.material;
    createdVersion = uploadResult.version;

    assert.ok(createdMaterial.id);
    assert.equal(createdVersion.version_number, 1);
    assert.equal(createdVersion.version_type, 'ORIGINAL');

    // Criação de Job com Idempotência
    const job1 = await materialService.requestProcessing(createdVersion.id, teacherActor);
    const job2 = await materialService.requestProcessing(createdVersion.id, teacherActor);

    // Mesma versão gera o mesmo idempotency_key e reusa o registro
    assert.equal(job1.id, job2.id);
    assert.equal(job1.idempotency_key, job2.idempotency_key);
  });

  await t.test('5. Integração com bot-acess e Geração da Versão v2 Processada', async () => {
    const latestVersion = materialRepository.getLatestVersion(createdMaterial.id);
    const job = await materialService.requestProcessing(latestVersion.id, teacherActor);

    // Dispara para bot-acess
    const dispatchResult = await botAcessService.dispatchJob(job.id);
    assert.equal(dispatchResult.success, true);
    assert.ok(dispatchResult.externalJobId);

    // Conclusão do processamento externo
    const processedVersion = await botAcessService.handleJobCompleted(job.id);
    assert.ok(processedVersion);
    assert.equal(processedVersion.version_number, 2);
    assert.equal(processedVersion.version_type, 'PROCESSADO_BOT');

    const updatedMaterial = materialRepository.findMaterialById(createdMaterial.id);
    assert.equal(updatedMaterial.current_status, 'AGUARDANDO_REVISAO');
  });

  await t.test('6. Controle Fino de Download (Aluno só acessa se Aprovado)', async () => {
    // Enquanto estiver em AGUARDANDO_REVISAO, aluno NÃO pode baixar
    const canDownloadBefore = await materialService.canUserDownloadMaterial(studentActor, createdMaterial.id);
    assert.equal(canDownloadBefore, false);

    // Revisor aprova
    const latestVersion = materialRepository.getLatestVersion(createdMaterial.id);
    const review = await materialService.startReview(latestVersion.id, { id: 3, roleCode: 'REVISOR' });
    await materialService.finishReview(review.id, 'APROVADO', {}, { id: 3, roleCode: 'REVISOR' });

    // Após aprovação, aluno matriculado PODE baixar
    const canDownloadAfter = await materialService.canUserDownloadMaterial(studentActor, createdMaterial.id);
    assert.equal(canDownloadAfter, true);
  });

  await app.close();
});
