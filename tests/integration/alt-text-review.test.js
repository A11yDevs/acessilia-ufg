import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app.js';
import { materialService } from '../../src/services/material.service.js';
import { materialRepository } from '../../src/repositories/material.repository.js';
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

  return { cookieHeader: sessionCookieHeader, postLogin };
}

async function fetchPageCsrf(app, url, cookieHeader) {
  const res = await app.inject({
    method: 'GET',
    url,
    headers: { cookie: cookieHeader }
  });
  const match = res.payload.match(/name="_csrf"\s+value="([^"]+)"/);
  return {
    csrfToken: match ? match[1] : null,
    statusCode: res.statusCode,
    cookies: res.cookies
  };
}

test('Revisão Humana de Textos Alternativos (Issue #6)', async (t) => {
  const app = await buildApp({ logger: false });
  t.after(() => app.close());

  const admin = await authService.authenticate('admin@acessilia.ufg.br', 'Temp@123456');
  const teacher = await authService.authenticate('carlos.professor@acessilia.ufg.br', 'Temp@123456');
  const student = await authService.authenticate('lucas.aluno@acessilia.ufg.br', 'Temp@123456');

  const suffix = Date.now();
  const subject = await academicService.createSubject({
    departmentId: 1,
    code: `ALT-${suffix}`,
    name: 'Disciplina de Teste Alt-Text',
    workloadHours: 60
  }, admin);

  const { material, version } = await materialService.uploadMaterial({
    subjectId: subject.id,
    title: `Material com Figuras ${suffix}`,
    category: 'SLIDE',
    originalFilename: 'aula_figuras.pdf',
    mimeType: 'application/pdf',
    fileSizeBytes: 2048,
    fileBuffer: Buffer.from('%PDF-1.4 mock')
  }, teacher);

  const alt = materialRepository.createAltText({
    materialVersionId: version.id,
    imageUrlOrPath: '/public/images/figura_teste.png',
    aiSuggestedAlt: 'Gráfico sugerido por IA'
  });

  await t.test('1. materialRepository.findAltTextById existe e retorna alt text com material_id', () => {
    const found = materialRepository.findAltTextById(alt.id);
    assert.ok(found, 'Texto alternativo deve ser encontrado');
    assert.equal(found.id, alt.id);
    assert.equal(found.material_id, material.id);
    assert.equal(found.ai_suggested_alt, 'Gráfico sugerido por IA');
    assert.equal(found.status, 'PENDENTE');

    const notFound = materialRepository.findAltTextById(999999);
    assert.equal(notFound, undefined);
  });

  await t.test('2. Rota POST exige autenticação e token CSRF', async () => {
    // 2.1 Sem auth -> 302 para login
    const resNoAuth = await app.inject({
      method: 'POST',
      url: `/materiais/${material.id}/alt-texts/${alt.id}`,
      payload: {
        humanReviewedAlt: 'Tentativa sem auth'
      }
    });
    assert.equal(resNoAuth.statusCode, 302);
    assert.match(resNoAuth.headers.location, /\/login/);

    // 2.2 Autenticado, mas sem token CSRF -> 403 Forbidden
    const { cookieHeader } = await loginUser(app, teacher.email);
    const resNoCsrf = await app.inject({
      method: 'POST',
      url: `/materiais/${material.id}/alt-texts/${alt.id}`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: cookieHeader
      },
      payload: `humanReviewedAlt=Sem+CSRF&status=APROVADO`
    });
    assert.equal(resNoCsrf.statusCode, 403);
  });

  await t.test('3. Usuário sem permissão (ALUNO) recebe 403 Forbidden', async () => {
    const { cookieHeader } = await loginUser(app, student.email);
    const { csrfToken } = await fetchPageCsrf(app, `/materiais/${material.id}`, cookieHeader);
    assert.ok(csrfToken, 'Token CSRF deve ser obtido na página');

    const resStudent = await app.inject({
      method: 'POST',
      url: `/materiais/${material.id}/alt-texts/${alt.id}`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: cookieHeader
      },
      payload: `_csrf=${encodeURIComponent(csrfToken)}&humanReviewedAlt=Tentativa+de+aluno&status=APROVADO`
    });
    assert.equal(resStudent.statusCode, 403);
  });

  await t.test('4. Retorna 404 se o altId não pertence ao materialId da rota', async () => {
    const { cookieHeader } = await loginUser(app, admin.email);
    const { csrfToken } = await fetchPageCsrf(app, `/materiais/${material.id}`, cookieHeader);
    assert.ok(csrfToken, 'Token CSRF deve ser obtido na página');

    const resMismatch = await app.inject({
      method: 'POST',
      url: `/materiais/999999/alt-texts/${alt.id}`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: cookieHeader
      },
      payload: `_csrf=${encodeURIComponent(csrfToken)}&humanReviewedAlt=Mismatch&status=APROVADO`
    });
    assert.equal(resMismatch.statusCode, 404);
  });

  await t.test('5. Docente responsável revisa e aprova com sucesso', async () => {
    const { cookieHeader } = await loginUser(app, teacher.email);
    const { csrfToken } = await fetchPageCsrf(app, `/materiais/${material.id}`, cookieHeader);
    assert.ok(csrfToken, 'Token CSRF deve ser obtido na página');

    const reviewedText = 'Gráfico de dispersão demonstrando correlação positiva entre estudo e desempenho.';
    const resReview = await app.inject({
      method: 'POST',
      url: `/materiais/${material.id}/alt-texts/${alt.id}`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: cookieHeader
      },
      payload: `_csrf=${encodeURIComponent(csrfToken)}&humanReviewedAlt=${encodeURIComponent(reviewedText)}&status=APROVADO`
    });

    assert.equal(resReview.statusCode, 302);
    assert.match(resReview.headers.location, new RegExp(`/materiais/${material.id}#sec-alt-review`));

    const updated = materialRepository.findAltTextById(alt.id);
    assert.equal(updated.human_reviewed_alt, reviewedText);
    assert.equal(updated.status, 'APROVADO');
    assert.equal(updated.reviewed_by_user_id, teacher.id);
  });
});
