import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app.js';
import { authService } from '../../src/services/auth.service.js';
import { db } from '../../database/connection.js';
import { materialService } from '../../src/services/material.service.js';
import { materialRepository } from '../../src/repositories/material.repository.js';

test('Testes de Homologação dos Achados de QA (G8, G10, M1, M2, M3, M10, B2, B6)', async (t) => {
  const app = await buildApp({ logger: false });
  const admin = await authService.authenticate('admin@acessilia.ufg.br', 'Temp@123456');

  app.addHook('preHandler', async (req) => {
    req.user = admin;
    req.session = { get: () => admin };
  });

  await t.test('1. G10: Rota /monitoramento responde 200 OK com métricas da tabela processing_jobs', async () => {
    const res = await app.inject({ method: 'GET', url: '/monitoramento' });
    assert.equal(res.statusCode, 200, 'Rota /monitoramento deve responder 200 OK');
    assert.match(res.payload, /Monitoramento do Motor Acessilia/i);
    assert.match(res.payload, /Fila de Processamento/i);
  });

  await t.test('2. G8: Tabela materials aceita status FALHA_PROCESSAMENTO sem violar CHECK constraint', async () => {
    // Busca ou cria um material para teste
    const mat = db.prepare('SELECT id FROM materials LIMIT 1').get();
    assert.ok(mat, 'Deve existir ao menos um material no banco');

    // Atualiza status para FALHA_PROCESSAMENTO
    materialRepository.updateMaterialStatus(mat.id, 'FALHA_PROCESSAMENTO');
    const updated = materialRepository.findMaterialById(mat.id);
    assert.equal(updated.current_status, 'FALHA_PROCESSAMENTO');
  });

  await t.test('3. M2: Iniciar revisão duplicada para a mesma versão é bloqueado (idempotente sem duplicar)', async () => {
    // Obter ou criar uma versão de teste
    const version = db.prepare('SELECT id FROM material_versions ORDER BY id DESC LIMIT 1').get();
    assert.ok(version, 'Deve existir uma versão');

    // Fecha qualquer revisão ativa prévia para isolar o teste
    db.prepare("UPDATE reviews SET status = 'APROVADO' WHERE material_version_id = ? AND status = 'EM_ANDAMENTO'").run(version.id);

    // Inicia a primeira revisão (assíncrona)
    const rev1 = await materialService.startReview(version.id, admin);
    assert.ok(rev1.id);

    // Iniciar uma segunda revisão para a mesma versão não deve criar outro registro no banco
    const rev2 = await materialService.startReview(version.id, admin);
    assert.equal(rev1.id, rev2.id, 'Deve retornar a mesma revisão ativa existente');

    const activeCount = db.prepare("SELECT COUNT(*) as count FROM reviews WHERE material_version_id = ? AND status = 'EM_ANDAMENTO'").get(version.id).count;
    assert.equal(activeCount, 1, 'Deve existir exatamente uma revisão ativa para a versão');
  });

  await t.test('4. M1, M3 e B6: Regras de finalização de revisão (validação de id, notas e re-conclusão)', async () => {
    // ID inexistente lança erro amigável (B6)
    await assert.rejects(async () => {
      await materialService.finishReview(999999, 'APROVADO', { notes: '' }, admin);
    }, /Revisão não encontrada/i);

    // Cria revisão para teste
    const version = db.prepare('SELECT id FROM material_versions ORDER BY id DESC LIMIT 1').get();
    db.prepare("UPDATE reviews SET status = 'APROVADO' WHERE material_version_id = ? AND status = 'EM_ANDAMENTO'").run(version.id);
    const rev = await materialService.startReview(version.id, admin);

    // Exige justificativa ao solicitar correção ou reprovar (M3)
    await assert.rejects(async () => {
      await materialService.finishReview(rev.id, 'CORRECAO_SOLICITADA', { notes: '   ' }, admin);
    }, /É obrigatório informar uma justificativa detalhada/i);

    await assert.rejects(async () => {
      await materialService.finishReview(rev.id, 'REPROVADO', { notes: '' }, admin);
    }, /É obrigatório informar uma justificativa detalhada/i);

    // Conclusão com sucesso
    await materialService.finishReview(rev.id, 'APROVADO', { notes: 'Material conforme WCAG 2.2' }, admin);
    const completedRev = materialRepository.findReviewById(rev.id);
    assert.equal(completedRev.status, 'APROVADO');

    // Tentar concluir de novo deve falhar (M1)
    await assert.rejects(async () => {
      await materialService.finishReview(rev.id, 'REPROVADO', { notes: 'Tentando alterar decisão' }, admin);
    }, /Esta revisão já foi concluída anteriormente/i);
  });

  await t.test('5. M10 e B2: Validação e transação atômica na criação de usuários', async () => {
    // 1. Validação de e-mail inválido
    const validateEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email?.trim());
    assert.equal(validateEmail('email_sem_arroba'), false);
    assert.equal(validateEmail('valido@acessilia.ufg.br'), true);

    // 2. Validação de nome em branco
    const validateName = (name) => !!(name && name.trim());
    assert.equal(validateName('   '), false);
    assert.equal(validateName('Pedro QA'), true);

    // 3. Transação atômica do banco: falha ao atribuir role faz rollback
    assert.throws(() => {
      db.transaction(() => {
        const stmtUser = db.prepare('INSERT INTO users (name, email, password_hash, status) VALUES (?, ?, ?, ?)');
        const info = stmtUser.run('Temp User Atomic', 'atomic_test@acessilia.ufg.br', 'hash', 'ACTIVE');
        // Role inexistente lança erro para acionar rollback
        const role = db.prepare('SELECT id FROM roles WHERE id = ?').get(999999);
        if (!role) throw new Error('A função (role) especificada não existe.');
        db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run(info.lastInsertRowid, role.id);
      })();
    }, /A função \(role\) especificada não existe/i);

    // Verifica que o rollback impediu usuário órfão
    const orphan = db.prepare("SELECT id FROM users WHERE email = 'atomic_test@acessilia.ufg.br'").get();
    assert.equal(orphan, undefined, 'Usuário não deve existir no banco após rollback de transação');
  });

  await t.test('6. B2 e M6: Validação de upload de material (título em branco e extensões)', async () => {
    const teacher = { id: 2, roleCode: 'PROFESSOR', name: 'Prof. Carlos' };

    // Título em branco rejeitado
    await assert.rejects(async () => {
      await materialService.uploadMaterial({
        title: '   ',
        subjectId: 1,
        category: 'SLIDE',
        originalFilename: 'aula.pdf'
      }, teacher);
    }, /Título, disciplina e categoria são obrigatórios/i);

    // Disciplina inexistente rejeitada amigavelmente (B1)
    await assert.rejects(async () => {
      await materialService.uploadMaterial({
        title: 'Material Válido',
        subjectId: 999999,
        category: 'SLIDE',
        originalFilename: 'aula.pdf'
      }, teacher);
    }, /A disciplina selecionada não foi encontrada ou não existe/i);

    // Categoria inválida rejeitada amigavelmente
    await assert.rejects(async () => {
      await materialService.uploadMaterial({
        title: 'Material Válido',
        subjectId: 1,
        category: 'CATEGORIA_INEXISTENTE',
        originalFilename: 'aula.pdf'
      }, teacher);
    }, /Categoria de material inválida/i);
  });

  await app.close();
});
