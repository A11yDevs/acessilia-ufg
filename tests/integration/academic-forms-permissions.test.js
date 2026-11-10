import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app.js';

async function loginUser(app, email, password = 'Temp@123456') {
  const getLogin = await app.inject({ method: 'GET', url: '/login' });
  const initialCookies = getLogin.cookies;
  const csrfMatch = getLogin.payload.match(/name="_csrf" value="([^"]+)"/);
  const csrfToken = csrfMatch ? csrfMatch[1] : '';
  const initialCookieHeader = initialCookies.map(c => `${c.name}=${c.value}`).join('; ');

  const postLogin = await app.inject({
    method: 'POST',
    url: '/login',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: initialCookieHeader
    },
    payload: `email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}&_csrf=${encodeURIComponent(csrfToken)}`
  });

  const cookieMap = new Map();
  for (const c of [...initialCookies, ...postLogin.cookies]) {
    cookieMap.set(c.name, c.value);
  }
  const sessionCookieHeader = Array.from(cookieMap.entries()).map(([k, v]) => `${k}=${v}`).join('; ');

  return { cookieHeader: sessionCookieHeader };
}

test('Telas acadêmicas omitem formulários de cadastro para usuários sem permissão (Issue #8)', async (t) => {
  const app = await buildApp({ logger: false });
  t.after(() => app.close());

  await t.test('1. ALUNO não recebe modais ou formulários de criação em /academico/disciplinas, /cursos, /cursos/:id e /turmas', async () => {
    const { cookieHeader } = await loginUser(app, 'lucas.aluno@acessilia.ufg.br');

    // 1.1 Disciplinas
    const resSubjects = await app.inject({
      method: 'GET',
      url: '/academico/disciplinas',
      headers: { cookie: cookieHeader }
    });
    assert.equal(resSubjects.statusCode, 200);
    assert.equal(resSubjects.payload.includes('action="/academico/disciplinas"'), false, 'Não deve conter form de criar disciplina');
    assert.equal(resSubjects.payload.includes('id="modal-nova-disciplina"'), false, 'Não deve conter modal de nova disciplina');
    assert.equal(resSubjects.payload.includes('+ Nova Disciplina'), false, 'Não deve conter botão de nova disciplina');

    // 1.2 Cursos
    const resCourses = await app.inject({
      method: 'GET',
      url: '/academico/cursos',
      headers: { cookie: cookieHeader }
    });
    assert.equal(resCourses.statusCode, 200);
    assert.equal(resCourses.payload.includes('action="/academico/cursos"'), false, 'Não deve conter form de criar curso');
    assert.equal(resCourses.payload.includes('id="modal-novo-curso"'), false, 'Não deve conter modal de novo curso');
    assert.equal(resCourses.payload.includes('+ Novo Curso'), false, 'Não deve conter botão de novo curso');

    // 1.3 Detalhes do Curso (Matriz)
    const resCourseDetail = await app.inject({
      method: 'GET',
      url: '/academico/cursos/1',
      headers: { cookie: cookieHeader }
    });
    assert.equal(resCourseDetail.statusCode, 200);
    assert.equal(resCourseDetail.payload.includes('action="/academico/cursos/1/disciplinas"'), false, 'Não deve conter form de vincular disciplina');
    assert.equal(resCourseDetail.payload.includes('id="modal-vincular-disciplina"'), false, 'Não deve conter modal de vincular disciplina');
    assert.equal(resCourseDetail.payload.includes('id="modal-nova-disciplina-curso"'), false, 'Não deve conter modal de nova disciplina no curso');

    // 1.4 Turmas
    const resClasses = await app.inject({
      method: 'GET',
      url: '/academico/turmas',
      headers: { cookie: cookieHeader }
    });
    assert.equal(resClasses.statusCode, 200);
    assert.equal(resClasses.payload.includes('action="/academico/turmas" method="POST"'), false, 'Não deve conter form de criar turma');
    assert.equal(resClasses.payload.includes('id="modal-nova-turma"'), false, 'Não deve conter modal de nova turma');
    assert.equal(resClasses.payload.includes('+ Nova Turma'), false, 'Não deve conter botão de nova turma');
    assert.equal(resClasses.payload.includes('id="form-add-docente"'), false, 'Não deve conter form de adicionar docente');
    assert.equal(resClasses.payload.includes('id="form-add-aluno"'), false, 'Não deve conter form de matricular aluno');
  });

  await t.test('2. ADMINISTRADOR visualiza modais e botões de criação nas páginas acadêmicas', async () => {
    const { cookieHeader } = await loginUser(app, 'admin@acessilia.ufg.br');

    // 2.1 Disciplinas
    const resSubjects = await app.inject({
      method: 'GET',
      url: '/academico/disciplinas',
      headers: { cookie: cookieHeader }
    });
    assert.equal(resSubjects.statusCode, 200);
    assert.ok(resSubjects.payload.includes('action="/academico/disciplinas"'));
    assert.ok(resSubjects.payload.includes('id="modal-nova-disciplina"'));
    assert.ok(resSubjects.payload.includes('+ Nova Disciplina'));

    // 2.2 Cursos
    const resCourses = await app.inject({
      method: 'GET',
      url: '/academico/cursos',
      headers: { cookie: cookieHeader }
    });
    assert.equal(resCourses.statusCode, 200);
    assert.ok(resCourses.payload.includes('action="/academico/cursos"'));
    assert.ok(resCourses.payload.includes('id="modal-novo-curso"'));
    assert.ok(resCourses.payload.includes('+ Novo Curso'));

    // 2.3 Detalhes do Curso (Matriz)
    const resCourseDetail = await app.inject({
      method: 'GET',
      url: '/academico/cursos/1',
      headers: { cookie: cookieHeader }
    });
    assert.equal(resCourseDetail.statusCode, 200);
    assert.ok(resCourseDetail.payload.includes('action="/academico/cursos/1/disciplinas"'));
    assert.ok(resCourseDetail.payload.includes('id="modal-vincular-disciplina"'));
    assert.ok(resCourseDetail.payload.includes('id="modal-nova-disciplina-curso"'));

    // 2.4 Turmas
    const resClasses = await app.inject({
      method: 'GET',
      url: '/academico/turmas',
      headers: { cookie: cookieHeader }
    });
    assert.equal(resClasses.statusCode, 200);
    assert.ok(resClasses.payload.includes('action="/academico/turmas" method="POST"'));
    assert.ok(resClasses.payload.includes('id="modal-nova-turma"'));
    assert.ok(resClasses.payload.includes('+ Nova Turma'));
    assert.ok(resClasses.payload.includes('id="form-add-docente"'));
    assert.ok(resClasses.payload.includes('id="form-add-aluno"'));
  });
});
