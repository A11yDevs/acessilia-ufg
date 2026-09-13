import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app.js';
import { authService } from '../../src/services/auth.service.js';
import { userRepository } from '../../src/repositories/user.repository.js';

test('Testes de Autenticacao, Argon2id e RBAC da Fase 1', async (t) => {
  const app = await buildApp({ logger: false });

  await t.test('1. Rota de login deve renderizar formulario acessivel com input e token CSRF', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/login'
    });

    assert.equal(res.statusCode, 200);
    assert.match(res.payload, /name="email"/);
    assert.match(res.payload, /name="password"/);
    assert.match(res.payload, /name="_csrf"/);
    assert.match(res.payload, /Pular para o formul/);
  });

  await t.test('2. Nao autenticado tentando acessar /dashboard deve ser redirecionado para /login', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/dashboard'
    });

    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.location, '/login');
  });

  await t.test('3. Autenticacao bem sucedida de Admin com Argon2id', async () => {
    const user = await authService.authenticate('admin@acessilia.ufg.br', 'Temp@123456');
    assert.ok(user);
    assert.equal(user.email, 'admin@acessilia.ufg.br');
    assert.equal(user.roleCode, 'ADMINISTRADOR');
  });

  await t.test('4. Falha na autenticacao com senha incorreta', async () => {
    await assert.rejects(
      async () => {
        await authService.authenticate('admin@acessilia.ufg.br', 'SenhaTotalmenteInvalida');
      },
      {
        message: 'Credenciais invalidas.'
      }
    );
  });

  await t.test('5. Protecao do Ultimo Administrador: contagem de administradores ativos', async () => {
    const activeAdmins = userRepository.countActiveAdmins();
    assert.ok(activeAdmins >= 1, 'Deve existir ao menos 1 administrador ativo');
  });

  await app.close();
});
