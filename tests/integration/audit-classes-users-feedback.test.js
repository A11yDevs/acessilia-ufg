import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app.js';
import { db } from '../../database/connection.js';
import { academicService } from '../../src/services/academic.service.js';
import { materialService } from '../../src/services/material.service.js';
import { materialRepository } from '../../src/repositories/material.repository.js';

test('Gestão de Turmas, Feedbacks Discentes, Edição de Materiais e Edição de Usuários', async (t) => {
  const app = await buildApp({ logger: false });

  const admin = {
    id: 1,
    roleCode: 'ADMINISTRADOR',
    name: 'Administrador UFG',
    permissions: [
      'cursos.visualizar', 'cursos.gerenciar',
      'turmas.visualizar', 'turmas.gerenciar',
      'materiais.visualizar', 'materiais.editar', 'materiais.excluir',
      'usuarios.visualizar', 'usuarios.criar', 'usuarios.editar', 'usuarios.desativar'
    ]
  };

  let currentUser = admin;
  app.addHook('onRequest', async (req) => {
    if (currentUser) {
      req.user = currentUser;
      req.session.set('user', currentUser);
    }
  });

  const suffix = Date.now();

  await t.test('1. Listagem e Criação de Turmas (/academico/turmas)', async () => {
    // GET /academico/turmas
    const resList = await app.inject({
      method: 'GET',
      url: '/academico/turmas'
    });
    assert.equal(resList.statusCode, 200);
    assert.match(resList.payload, /Gestão de Turmas/);
    assert.match(resList.payload, /Nova Turma/);

    const match = resList.payload.match(/name="_csrf" value="([^"]+)"/);
    assert.ok(match, 'Token CSRF deve estar presente');
    const csrfToken = match[1];
    const cookieHeader = resList.cookies.map(c => `${c.name}=${c.value}`).join('; ');

    // Criação de Turma
    const resCreate = await app.inject({
      method: 'POST',
      url: '/academico/turmas',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'cookie': cookieHeader
      },
      payload: `courseId=1&subjectId=1&academicPeriodId=1&code=T-TEST-${suffix}&location=Lab+150&scheduleDescription=Terca+e+Quinta+14:00&_csrf=${encodeURIComponent(csrfToken)}`
    });
    assert.equal(resCreate.statusCode, 302);
    assert.equal(resCreate.headers.location, '/academico/turmas');

    const createdClass = db.prepare('SELECT * FROM classes WHERE code = ?').get(`T-TEST-${suffix}`);
    assert.ok(createdClass);
    assert.equal(createdClass.location, 'Lab 150');

    // Atribuir professor
    const resProf = await app.inject({
      method: 'POST',
      url: `/academico/turmas/${createdClass.id}/professores`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'cookie': cookieHeader
      },
      payload: `teacherUserId=2&roleInClass=TITULAR&_csrf=${encodeURIComponent(csrfToken)}`
    });
    assert.equal(resProf.statusCode, 302);

    // Detalhes da turma (API JSON)
    const resDetail = await app.inject({
      method: 'GET',
      url: `/academico/turmas/${createdClass.id}/detalhes`,
      headers: { 'cookie': cookieHeader }
    });
    assert.equal(resDetail.statusCode, 200);
    const detail = JSON.parse(resDetail.payload);
    assert.equal(detail.code, `T-TEST-${suffix}`);
    assert.equal(detail.teachers.length, 1);
    assert.equal(detail.teachers[0].teacher_user_id, 2);
  });

  await t.test('2. Gestão de Feedback Discente (Atualização de Status)', async () => {
    // GET /materiais/9 para obter token CSRF e cookie
    const resMat = await app.inject({
      method: 'GET',
      url: '/materiais/9'
    });
    assert.equal(resMat.statusCode, 200);
    const match = resMat.payload.match(/name="_csrf" value="([^"]+)"/);
    assert.ok(match);
    const csrfToken = match[1];
    const cookieHeader = resMat.cookies.map(c => `${c.name}=${c.value}`).join('; ');

    // Criar feedback de teste
    const fb = materialRepository.createMaterialFeedback({
      materialId: 9,
      studentUserId: 4,
      issueType: 'FORMULA',
      description: 'A fórmula da página 3 não está sendo lida pelo sintetizador.'
    });
    assert.ok(fb);
    assert.equal(fb.status, 'ABERTO');

    // Atualizar status para RESOLVIDO
    const resUpdate = await app.inject({
      method: 'POST',
      url: `/materiais/9/feedbacks/${fb.id}/status`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'cookie': cookieHeader
      },
      payload: `status=RESOLVIDO&_csrf=${encodeURIComponent(csrfToken)}`
    });
    assert.equal(resUpdate.statusCode, 302);
    assert.equal(resUpdate.headers.location, '/materiais/9#sec-feedbacks');

    const updatedFb = materialRepository.findFeedbackById(fb.id);
    assert.equal(updatedFb.status, 'RESOLVIDO');
  });

  await t.test('3. Edição de Metadados do Material (/materiais/:id/editar)', async () => {
    const resMat = await app.inject({
      method: 'GET',
      url: '/materiais/9'
    });
    const match = resMat.payload.match(/name="_csrf" value="([^"]+)"/);
    const csrfToken = match[1];
    const cookieHeader = resMat.cookies.map(c => `${c.name}=${c.value}`).join('; ');

    const matBefore = materialRepository.findMaterialById(9);
    assert.ok(matBefore);

    const resEdit = await app.inject({
      method: 'POST',
      url: '/materiais/9/editar',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'cookie': cookieHeader
      },
      payload: `title=${encodeURIComponent('O que faz o Brasil, Brasil? - Edição Revisada')}&description=${encodeURIComponent('Ensaio de antropologia social brasileira.')}&category=LIVRO&subjectId=${matBefore.subject_id}&_csrf=${encodeURIComponent(csrfToken)}`
    });
    assert.equal(resEdit.statusCode, 302);
    assert.equal(resEdit.headers.location, '/materiais/9');

    const matAfter = materialRepository.findMaterialById(9);
    assert.equal(matAfter.title, 'O que faz o Brasil, Brasil? - Edição Revisada');
    assert.equal(matAfter.category, 'LIVRO');
  });

  await t.test('4. Edição de Usuário e Redefinição de Senha (/usuarios/:id)', async () => {
    const resUsers = await app.inject({
      method: 'GET',
      url: '/usuarios'
    });
    assert.equal(resUsers.statusCode, 200);
    const match = resUsers.payload.match(/name="_csrf" value="([^"]+)"/);
    const csrfToken = match[1];
    const cookieHeader = resUsers.cookies.map(c => `${c.name}=${c.value}`).join('; ');

    // Edição do usuário ID 4 (aluno)
    const resUserEdit = await app.inject({
      method: 'POST',
      url: '/usuarios/4',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'cookie': cookieHeader
      },
      payload: `name=${encodeURIComponent('Lucas Aluno Atualizado')}&email=${encodeURIComponent('lucas.aluno@acessilia.ufg.br')}&registrationNumber=ALU-2026-REV&roleId=7&_csrf=${encodeURIComponent(csrfToken)}`
    });
    assert.equal(resUserEdit.statusCode, 302);
    assert.equal(resUserEdit.headers.location, '/usuarios');

    const updatedUser = db.prepare('SELECT * FROM users WHERE id = 4').get();
    assert.equal(updatedUser.name, 'Lucas Aluno Atualizado');
    assert.equal(updatedUser.registration_number, 'ALU-2026-REV');
  });
});
