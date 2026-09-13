import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app.js';

test('Fluxo completo de Login HTTP com CSRF e Cookies', async () => {
  const app = await buildApp({ logger: false });

  // 1. GET /login para obter o cookie de sessao e o token CSRF
  const getRes = await app.inject({
    method: 'GET',
    url: '/login'
  });

  assert.equal(getRes.statusCode, 200);

  // Extrair cookie de sessao
  const cookies = getRes.cookies;
  assert.ok(cookies.length > 0, 'Deve retornar cookie de sessao no GET /login');

  // Extrair token CSRF do HTML renderizado
  const match = getRes.payload.match(/name="_csrf" value="([^"]+)"/);
  assert.ok(match, 'Token CSRF deve estar presente no input oculto do formulario');
  const csrfToken = match[1];

  // Montar header Cookie
  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

  // 2. POST /login com as credenciais, o cookie recebido e o _csrf
  const postRes = await app.inject({
    method: 'POST',
    url: '/login',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'cookie': cookieHeader
    },
    payload: `email=admin%40acessilia.ufg.br&password=Temp%40123456&_csrf=${encodeURIComponent(csrfToken)}`
  });

  // Deve autenticar com sucesso e redirecionar para /dashboard (302)
  assert.equal(postRes.statusCode, 302);
  assert.equal(postRes.headers.location, '/dashboard');

  await app.close();
});
