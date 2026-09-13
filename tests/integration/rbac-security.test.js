import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app.js';
import { authService } from '../../src/services/auth.service.js';
import { db } from '../../database/connection.js';

test('Testes de Seguranca Negativos e Escopo RBAC', async (t) => {
  const app = await buildApp({ logger: false });

  // Rota de teste protegida por permissao especifica
  app.get('/test-admin-only', {
    preHandler: [app.requirePermission('usuarios.criar')]
  }, async (req, reply) => {
    return { ok: true };
  });

  await t.test('1. Acesso nao autenticado em rota protegida redireciona para login', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/test-admin-only'
    });

    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.location, '/login');
  });

  await t.test('2. Tentativas sucessivas erradas resultam em bloqueio temporario (Brute-force protection)', async () => {
    // Resetar tentativas para o usuario de teste antes de testar
    db.prepare('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE email = ?')
      .run('carlos.professor@acessilia.ufg.br');

    for (let i = 0; i < 4; i++) {
      try {
        await authService.authenticate('carlos.professor@acessilia.ufg.br', 'senha_errada');
      } catch (e) {
        assert.equal(e.message, 'Credenciais invalidas.');
      }
    }

    // 5a tentativa deve ativar o bloqueio de forca bruta
    await assert.rejects(
      async () => {
        await authService.authenticate('carlos.professor@acessilia.ufg.br', 'senha_errada');
      },
      (err) => {
        return err.message.includes('bloqueada temporariamente');
      }
    );

    // Restaurar usuario apos o teste
    db.prepare('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE email = ?')
      .run('carlos.professor@acessilia.ufg.br');
  });

  await app.close();
});
