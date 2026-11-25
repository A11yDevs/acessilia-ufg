import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toUtcFromGoiania,
  fromUtcToGoiania,
  formatInGoiania,
  isFutureInGoiania,
  getNowInGoiania,
  parseGoianiaDateTime,
  GOIANIA_TIMEZONE
} from '../../src/utils/timezone.js';

test('Timezone Goiânia - Conversão UTC ↔ America/Sao_Paulo', async (t) => {
  await t.test('toUtcFromGoiania: converte data local de Goiânia para UTC', () => {
    // 2024-01-15 14:30 em Goiânia (UTC-3) = 2024-01-15 17:30 UTC
    const goianiaDate = '2024-01-15T14:30:00';
    const utcResult = toUtcFromGoiania(goianiaDate);
    assert.ok(utcResult);
    const utcDate = new Date(utcResult);
    assert.equal(utcDate.getUTCHours(), 17);
    assert.equal(utcDate.getUTCMinutes(), 30);
    assert.equal(utcDate.getUTCDate(), 15);
    assert.equal(utcDate.getUTCMonth(), 0); // Janeiro = 0
  });

  await t.test('fromUtcToGoiania: converte UTC para horário de Goiânia', () => {
    // 2024-01-15 17:30 UTC = 2024-01-15 14:30 em Goiânia (UTC-3)
    const utcDate = '2024-01-15T17:30:00.000Z';
    const goianiaResult = fromUtcToGoiania(utcDate);
    assert.ok(goianiaResult);
    assert.equal(goianiaResult.getHours(), 14);
    assert.equal(goianiaResult.getMinutes(), 30);
    assert.equal(goianiaResult.getDate(), 15);
    assert.equal(goianiaResult.getMonth(), 0);
  });

  await t.test('formatInGoiania: formata data UTC no padrão brasileiro', () => {
    const utcDate = '2024-01-15T17:30:00.000Z';
    const formatted = formatInGoiania(utcDate);
    assert.match(formatted, /15\/01\/2024/);
    assert.match(formatted, /14:30/);
  });

  await t.test('isFutureInGoiania: detecta data futura corretamente', () => {
    const now = new Date();
    const futureInGoiania = new Date(now.getTime() + 2 * 60 * 60 * 1000); // 2 horas no futuro
    const pastInGoiania = new Date(now.getTime() - 2 * 60 * 60 * 1000); // 2 horas no passado

    const futureUtc = futureInGoiania.toISOString();
    const pastUtc = pastInGoiania.toISOString();

    assert.equal(isFutureInGoiania(futureUtc), true);
    assert.equal(isFutureInGoiania(pastUtc), false);
  });

  await t.test('isFutureInGoiania: retorna false para datas nulas', () => {
    assert.equal(isFutureInGoiania(null), false);
    assert.equal(isFutureInGoiania(undefined), false);
    assert.equal(isFutureInGoiania(''), false);
  });

  await t.test('toUtcFromGoiania: retorna null para datas inválidas', () => {
    assert.equal(toUtcFromGoiania(null), null);
    assert.equal(toUtcFromGoiania(undefined), null);
    assert.equal(toUtcFromGoiania('invalid-date'), null);
  });

  await t.test('fromUtcToGoiania: retorna null para datas inválidas', () => {
    assert.equal(fromUtcToGoiania(null), null);
    assert.equal(fromUtcToGoiania(undefined), null);
    assert.equal(fromUtcToGoiania('invalid-date'), null);
  });

  await t.test('Virada de ano: 31/12 23:00 Goiânia = 01/01 02:00 UTC', () => {
    const goianiaDate = '2024-12-31T23:00:00';
    const utcResult = toUtcFromGoiania(goianiaDate);
    const utcDate = new Date(utcResult);
    assert.equal(utcDate.getUTCDate(), 1);
    assert.equal(utcDate.getUTCMonth(), 0); // Janeiro
    assert.equal(utcDate.getUTCFullYear(), 2025);
    assert.equal(utcDate.getUTCHours(), 2);
  });

  await t.test('Meia-noite: 00:00 Goiânia = 03:00 UTC (mesmo dia)', () => {
    const goianiaDate = '2024-06-15T00:00:00';
    const utcResult = toUtcFromGoiania(goianiaDate);
    const utcDate = new Date(utcResult);
    assert.equal(utcDate.getUTCDate(), 15);
    assert.equal(utcDate.getUTCMonth(), 5); // Junho
    assert.equal(utcDate.getUTCHours(), 3);
  });

  await t.test('GOIANIA_TIMEZONE constante está correta', () => {
    assert.equal(GOIANIA_TIMEZONE, 'America/Sao_Paulo');
  });
});

test('Timezone Goiânia - Integração com materialService', async (t) => {
  const { materialService } = await import('../../src/services/material.service.js');
  const { materialRepository } = await import('../../src/repositories/material.repository.js');
  const { academicService } = await import('../../src/services/academic.service.js');
  const { academicRepository } = await import('../../src/repositories/academic.repository.js');
  const { userRepository } = await import('../../src/repositories/user.repository.js');

  const admin = { id: 1, roleCode: 'ADMINISTRADOR', name: 'Administrador UFG' };
  const teacher = { id: 2, roleCode: 'PROFESSOR', name: 'Prof. Carlos' };
  const student = { id: 4, roleCode: 'ALUNO', name: 'Lucas Aluno' };

  const suffix = Date.now();
  const course = await academicService.createCourse({
    departmentId: 1,
    code: `CS-TZ-${suffix}`,
    name: 'Ciencia da Computacao TZ',
    modality: 'PRESENCIAL',
    durationSemesters: 8
  }, admin);

  const subject = await academicService.createSubject({
    departmentId: 1,
    code: `DISC-TZ-${suffix}`,
    name: 'Teste Timezone',
    description: 'Ementa',
    workloadHours: 64
  }, admin);

  const testClass = await academicService.createClass({
    courseId: course.id,
    subjectId: subject.id,
    academicPeriodId: 1,
    code: `T-TZ-${suffix}`
  }, admin);

  await academicService.assignTeacher(testClass.id, teacher.id, 'TITULAR', admin);
  await academicService.enrollStudent(testClass.id, student.id, admin);

  await t.test('Agendamento com horário de Goiânia é salvo corretamente em UTC', async () => {
    // 14:30 em Goiânia = 17:30 UTC
    const goianiaTime = '2025-06-15T14:30:00';
    const { material } = await materialService.uploadMaterial({
      subjectId: subject.id,
      classId: testClass.id,
      title: 'Material Timezone Test',
      category: 'SLIDE',
      originalFilename: 'tz_test.pdf',
      publishAt: goianiaTime
    }, teacher);

    // Verificar se foi salvo como UTC no banco
    const savedMaterial = materialRepository.findMaterialById(material.id);
    assert.ok(savedMaterial.publish_at);
    const savedDate = new Date(savedMaterial.publish_at);
    assert.equal(savedDate.getUTCHours(), 17);
    assert.equal(savedDate.getUTCMinutes(), 30);
  });

  await t.test('Aluno não acessa material agendado para futuro (horário Goiânia)', async () => {
    const futureGoiania = new Date(Date.now() + 3 * 60 * 60 * 1000); // 3 horas no futuro
    const futureGoianiaStr = futureGoiania.toISOString().slice(0, 16).replace('T', 'T'); // formato datetime-local
    
    const { material } = await materialService.uploadMaterial({
      subjectId: subject.id,
      classId: testClass.id,
      title: 'Material Futuro TZ',
      category: 'APOSTILA',
      originalFilename: 'future_tz.pdf',
      publishAt: futureGoianiaStr
    }, teacher);

    materialRepository.updateMaterialStatus(material.id, 'APROVADO');

    const teacherCanView = await materialService.canUserViewMaterial(teacher, material.id);
    assert.equal(teacherCanView, true);

    const studentCanView = await materialService.canUserViewMaterial(student, material.id);
    assert.equal(studentCanView, false, 'Aluno não deve visualizar material agendado para o futuro no horário de Goiânia');
  });

  await t.test('Aluno acessa material agendado para passado (horário Goiânia)', async () => {
    const pastGoiania = new Date(Date.now() - 3 * 60 * 60 * 1000); // 3 horas no passado
    const pastGoianiaStr = pastGoiania.toISOString().slice(0, 16);
    
    const { material } = await materialService.uploadMaterial({
      subjectId: subject.id,
      classId: testClass.id,
      title: 'Material Passado TZ',
      category: 'ARTIGO',
      originalFilename: 'past_tz.pdf',
      publishAt: pastGoianiaStr
    }, teacher);

    materialRepository.updateMaterialStatus(material.id, 'APROVADO');

    const studentCanView = await materialService.canUserViewMaterial(student, material.id);
    assert.equal(studentCanView, true, 'Aluno deve visualizar material agendado para o passado no horário de Goiânia');
  });
});