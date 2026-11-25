import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app.js';
import { academicService } from '../../src/services/academic.service.js';
import { authService } from '../../src/services/auth.service.js';

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

  return { cookieHeader: sessionCookieHeader, csrfToken };
}

test('Tratamento Acessível de Erros de Formulário (WCAG 3.3.1 e 3.3.3 / Issue #7)', async (t) => {
  const app = await buildApp({ logger: false });
  t.after(() => app.close());

  const admin = await authService.authenticate('admin@acessilia.ufg.br', 'Temp@123456');
  const teacher = await authService.authenticate('carlos.professor@acessilia.ufg.br', 'Temp@123456');

  const suffix = Date.now();
  const subject = await academicService.createSubject({
    departmentId: 1,
    code: `WCAG-${suffix}`,
    name: 'Disciplina Teste WCAG',
    workloadHours: 64
  }, admin);

  await t.test('1. Envio de material com título vazio e Accept text/html devolve página com role="alert", foco e aria-describedby', async () => {
    const { cookieHeader } = await loginUser(app, teacher.email);

    // Obtém CSRF token da página de materiais
    const getPage = await app.inject({
      method: 'GET',
      url: '/materiais',
      headers: { cookie: cookieHeader }
    });
    const csrfToken = getPage.payload.match(/name="_csrf"\s+value="([^"]+)"/)[1];

    const boundary = `formerror${Date.now()}`;
    const multipart = [
      `--${boundary}`, 'Content-Disposition: form-data; name="_csrf"', '', csrfToken,
      `--${boundary}`, 'Content-Disposition: form-data; name="title"', '', '   ', // título vazio
      `--${boundary}`, 'Content-Disposition: form-data; name="description"', '', 'Descrição explicativa preservada',
      `--${boundary}`, 'Content-Disposition: form-data; name="subjectId"', '', String(subject.id),
      `--${boundary}`, 'Content-Disposition: form-data; name="category"', '', 'SLIDE',
      `--${boundary}`, 'Content-Disposition: form-data; name="file"; filename="aula.pdf"',
      'Content-Type: application/pdf', '', '%PDF-1.4 teste',
      `--${boundary}--`, ''
    ].join('\r\n');

    const res = await app.inject({
      method: 'POST',
      url: '/materiais',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        cookie: cookieHeader
      },
      payload: multipart
    });

    // Código HTTP 400 Bad Request
    assert.equal(res.statusCode, 400);
    assert.match(res.headers['content-type'], /text\/html/);

    // 1. Resumo de erro com role="alert" presente na tela
    assert.ok(res.payload.includes('role="alert"'), 'Deve conter elemento com role="alert"');
    assert.ok(res.payload.includes('id="modal-material-error"') || res.payload.includes('id="form-error-summary"'), 'Deve conter sumário de erro');
    assert.ok(res.payload.includes('Título e Disciplina são obrigatórios e não podem estar em branco.'), 'Deve conter texto explicativo do erro');

    // 2. Campo inválido marcado com aria-invalid e associado por aria-describedby (WCAG 3.3.1 e 3.3.3)
    assert.ok(res.payload.includes('aria-invalid="true"'), 'Campo com erro deve ter aria-invalid="true"');
    assert.ok(res.payload.includes('aria-describedby="err-titulo-material"'), 'Campo deve apontar para mensagem de erro por aria-describedby');
    assert.ok(res.payload.includes('id="err-titulo-material"'), 'Mensagem de erro deve ter id correspondente ao describedby');

    // 3. Modal permanece aberto e preserva valores previamente preenchidos
    assert.ok(res.payload.includes('Descrição explicativa preservada'), 'Deve preservar os valores já digitados');
  });

  await t.test('2. Envio de material sem Accept text/html continua respondendo JSON para chamadas de API', async () => {
    const { cookieHeader } = await loginUser(app, teacher.email);

    const boundary = `api${Date.now()}`;
    const multipart = [
      `--${boundary}`, 'Content-Disposition: form-data; name="title"', '', '   ',
      `--${boundary}`, 'Content-Disposition: form-data; name="subjectId"', '', String(subject.id),
      `--${boundary}`, 'Content-Disposition: form-data; name="file"; filename="aula.pdf"',
      'Content-Type: application/pdf', '', '%PDF-1.4 teste',
      `--${boundary}--`, ''
    ].join('\r\n');

    const res = await app.inject({
      method: 'POST',
      url: '/materiais',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'accept': 'application/json',
        cookie: cookieHeader
      },
      payload: multipart
    });

    assert.equal(res.statusCode, 400);
    const data = JSON.parse(res.payload);
    assert.equal(data.error, 'Título e Disciplina são obrigatórios e não podem estar em branco.');
  });

  await t.test('3. Cadastro de Disciplina com erro e Accept text/html devolve página com sumário de erro role="alert"', async () => {
    const { cookieHeader } = await loginUser(app, admin.email);

    const getPage = await app.inject({
      method: 'GET',
      url: '/academico/disciplinas',
      headers: { cookie: cookieHeader }
    });
    const csrfToken = getPage.payload.match(/name="_csrf"\s+value="([^"]+)"/)[1];

    const res = await app.inject({
      method: 'POST',
      url: '/academico/disciplinas',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'accept': 'text/html,application/xhtml+xml',
        cookie: cookieHeader
      },
      payload: `_csrf=${encodeURIComponent(csrfToken)}&departmentId=999999&code=&name=Disciplina+Invalida&workloadHours=60`
    });

    assert.equal(res.statusCode, 400);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.ok(res.payload.includes('role="alert"'));
    assert.ok(res.payload.includes('id="form-error-summary"'));
  });

  await t.test('4. Cadastro de Usuário com erro e Accept text/html devolve página com sumário de erro role="alert"', async () => {
    const { cookieHeader } = await loginUser(app, admin.email);

    const getPage = await app.inject({
      method: 'GET',
      url: '/usuarios',
      headers: { cookie: cookieHeader }
    });
    const csrfToken = getPage.payload.match(/name="_csrf"\s+value="([^"]+)"/)[1];

    const res = await app.inject({
      method: 'POST',
      url: '/usuarios',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'accept': 'text/html,application/xhtml+xml',
        cookie: cookieHeader
      },
      payload: `_csrf=${encodeURIComponent(csrfToken)}&name=Usuario+Sem+Email&email=email_invalido&roleId=1`
    });

    assert.equal(res.statusCode, 400);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.ok(res.payload.includes('role="alert"'));
    assert.ok(res.payload.includes('id="form-error-summary"'));
    assert.ok(res.payload.includes('Formato de e-mail inválido.'));
  });
});
