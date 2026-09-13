import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app.js';
import { authService } from '../../src/services/auth.service.js';

test('Navegação e Rotas Web da Sidebar', async () => {
  const app = await buildApp({ logger: false });

  // 1. Login como Admin
  const admin = await authService.authenticate('admin@acessilia.ufg.br', 'Temp@123456');

  // Testar as rotas da sidebar com injeção simulada
  app.addHook('preHandler', async (req) => {
    req.user = admin;
    req.session = { get: () => admin };
  });

  const rotas = ['/revisoes', '/usuarios', '/auditoria', '/materiais', '/academico/cursos'];

  for (const rota of rotas) {
    const res = await app.inject({ method: 'GET', url: rota });
    assert.equal(res.statusCode, 200, `Rota ${rota} deve responder 200 OK`);
  }

  await app.close();
});
