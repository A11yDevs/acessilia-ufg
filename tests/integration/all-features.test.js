import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app.js';
import { authService } from '../../src/services/auth.service.js';

test('Testes das Novas Funcionalidades: Healthcheck, Relatórios CSV, Solicitações e SSE', async (t) => {
  const app = await buildApp({ logger: false });

  const admin = await authService.authenticate('admin@acessilia.ufg.br', 'Temp@123456');
  app.addHook('preHandler', async (req) => {
    req.user = admin;
    req.session = { get: () => admin };
  });

  await t.test('1. Endpoint de Health Check (/healthz)', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.status, 'OK');
    assert.equal(body.database.status, 'healthy');
    assert.ok(body.uptimeSeconds >= 0);
  });

  await t.test('2. Exportação de Relatório de Auditoria em CSV (/relatorios/auditoria.csv)', async () => {
    const res = await app.inject({ method: 'GET', url: '/relatorios/auditoria.csv' });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'], /text\/csv/);
    assert.equal(res.payload.startsWith('\uFEFF'), true, 'CSV deve conter UTF-8 BOM para compatibilidade com Excel');
    assert.match(res.payload, /ID,Data\/Hora,Usuario,Email,Acao/);
  });

  await t.test('3. Exportação de Relatório de Materiais em CSV (/relatorios/materiais.csv)', async () => {
    const res = await app.inject({ method: 'GET', url: '/relatorios/materiais.csv' });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'], /text\/csv/);
    assert.equal(res.payload.startsWith('\uFEFF'), true, 'CSV deve conter UTF-8 BOM para compatibilidade com Excel');
    assert.match(res.payload, /ID,Data_Cadastro,Titulo,Disciplina/);
  });

  await t.test('4. Rota Web de Solicitações (/solicitacoes)', async () => {
    const res = await app.inject({ method: 'GET', url: '/solicitacoes' });
    assert.equal(res.statusCode, 200);
    assert.match(res.payload, /Solicitações de Acessibilidade/);
  });

  await app.close();
});
