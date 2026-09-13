import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app.js';

test('Fluxo completo de Login e Logout', async () => {
  const app = await buildApp({ logger: false });

  // 1. GET /login
  const getRes = await app.inject({ method: 'GET', url: '/login' });
  const csrfToken = getRes.payload.match(/name="_csrf" value="([^"]+)"/)[1];
  const cookieHeader = getRes.cookies.map(c => `${c.name}=${c.value}`).join('; ');

  // 2. POST /login
  const postLogin = await app.inject({
    method: 'POST',
    url: '/login',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'cookie': cookieHeader
    },
    payload: `email=admin%40acessilia.ufg.br&password=Temp%40123456&_csrf=${encodeURIComponent(csrfToken)}`
  });

  assert.equal(postLogin.statusCode, 302);
  const authCookie = postLogin.cookies.map(c => `${c.name}=${c.value}`).join('; ');

  // 3. GET /dashboard autenticado para pegar o novo CSRF token
  const dashRes = await app.inject({
    method: 'GET',
    url: '/dashboard',
    headers: { 'cookie': authCookie }
  });
  assert.equal(dashRes.statusCode, 200);
  const logoutCsrf = dashRes.payload.match(/name="_csrf" value="([^"]+)"/)[1];

  // 4. POST /logout
  const postLogout = await app.inject({
    method: 'POST',
    url: '/logout',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'cookie': authCookie
    },
    payload: `_csrf=${encodeURIComponent(logoutCsrf)}`
  });

  assert.equal(postLogout.statusCode, 302);
  assert.equal(postLogout.headers.location, '/login');

  await app.close();
});
