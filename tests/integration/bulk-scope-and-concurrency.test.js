import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildApp } from '../../src/app.js';
import { academicService } from '../../src/services/academic.service.js';
import { materialService } from '../../src/services/material.service.js';
import { materialRepository } from '../../src/repositories/material.repository.js';
import { botAcessService } from '../../src/integrations/bot-acess/service.js';
import { botAcessClient } from '../../src/integrations/bot-acess/client.js';
import { resolveStoragePath } from '../../src/services/processed-document.service.js';

// Revisão do PR de 07/11: escopo das ações em lote, envio duplicado do mesmo job e
// conclusão repetida do mesmo job.
const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};

test('Ações em lote: escopo por material, envio único e conclusão idempotente', async (t) => {
  const admin = { id: 1, roleCode: 'ADMINISTRADOR', name: 'Administrador UFG' };
  const owner = { id: 2, roleCode: 'PROFESSOR', name: 'Prof. Carlos' };
  // Outro professor, com a mesma permissão "materiais.enviar" que a rota exige
  const otherTeacher = { id: 987654, roleCode: 'PROFESSOR', name: 'Outro Professor', permissions: ['materiais.enviar', 'materiais.visualizar'] };
  const suffix = Date.now();
  const created = [];
  t.after(() => created.forEach(f => f && fs.rmSync(f, { force: true })));

  const subject = await academicService.createSubject({
    departmentId: 1, code: `ESC-${suffix}`, name: 'Disciplina de Teste de Escopo', workloadHours: 60
  }, admin);

  async function newMaterial(label) {
    const result = await materialService.uploadMaterial({
      subjectId: subject.id, title: `Material ${label} ${suffix}`, category: 'APOSTILA',
      originalFilename: `${label}.pdf`, mimeType: 'application/pdf', fileSizeBytes: 9, fileBuffer: Buffer.from('%PDF-1.4 x')
    }, owner);
    created.push(resolveStoragePath(result.version.storage_path));
    return result;
  }

  async function failedMaterial(label) {
    const { material, version } = await newMaterial(label);
    const job = await materialService.requestProcessing(version.id, owner);
    materialRepository.updateProcessingJobStatus(job.id, 'FAILED', { errorMessage: 'falha simulada' });
    materialRepository.updateMaterialStatus(material.id, 'FALHA_PROCESSAMENTO');
    return { material, version };
  }

  const jobsOf = (versionId) => materialRepository.countProcessingJobsForVersion(versionId);

  await t.test('1. Professor não reprocessa nem aprova material de outro professor', async () => {
    const { material, version } = await failedMaterial('alheio');
    const calls = [];
    const original = botAcessClient.sendDocumentForProcessing;
    botAcessClient.sendDocumentForProcessing = async (args) => { calls.push(args); return original.call(botAcessClient, args); };
    try {
      for (const action of ['REPROCESS', 'APPROVE']) {
        await assert.rejects(
          materialService.executeBulkAction([material.id], action, otherTeacher),
          err => err.statusCode === 403
        );
      }
    } finally {
      botAcessClient.sendDocumentForProcessing = original;
    }
    assert.equal(calls.length, 0, 'nada foi enviado ao Core');
    assert.equal(jobsOf(version.id), 1, 'nenhum job novo');
    assert.equal(materialRepository.findMaterialById(material.id).current_status, 'FALHA_PROCESSAMENTO');

    // O dono continua podendo reprocessar o próprio material
    const res = await materialService.executeBulkAction([material.id], 'REPROCESS', owner);
    assert.equal(res.affected, 1);
  });

  await t.test('2. Pela rota: material alheio dá 403, mesmo com token CSRF válido', async () => {
    const { material, version } = await failedMaterial('rota');
    const app = await buildApp({ logger: false });
    t.after(() => app.close());
    app.addHook('onRequest', async (req) => {
      req.user = otherTeacher;
      req.session.set('user', otherTeacher);
    });

    const page = await app.inject({ method: 'GET', url: '/materiais' });
    const csrf = page.payload.match(/name="_csrf" value="([^"]+)"/)[1];
    const cookie = page.cookies.map(c => `${c.name}=${c.value}`).join('; ');
    const res = await app.inject({
      method: 'POST', url: '/materiais/bulk', headers: { cookie },
      payload: { materialIds: String(material.id), action: 'REPROCESS', _csrf: csrf }
    });
    assert.equal(res.statusCode, 403);
    assert.equal(jobsOf(version.id), 1);
  });

  await t.test('3. Duas chamadas simultâneas enviam o mesmo job ao Core uma vez só', async () => {
    const { version } = await newMaterial('concorrente');
    const job = await materialService.requestProcessing(version.id, owner);
    const gate = deferred();
    const calls = [];
    const original = botAcessClient.sendDocumentForProcessing;
    botAcessClient.sendDocumentForProcessing = async (args) => {
      calls.push(args.jobId);
      await gate.promise; // o Core demora a responder: as duas chamadas ficam no meio do envio
      return { success: true, externalJobId: `ext${calls.length}_${suffix}`, jobToken: 'tok' };
    };
    try {
      const both = Promise.all([botAcessService.dispatchJob(job.id), botAcessService.dispatchJob(job.id)]);
      await new Promise(r => setImmediate(r));
      gate.resolve();
      const [first, second] = await both;
      assert.deepEqual(calls, [job.id], 'um único envio para o job');
      assert.equal(first.success, true);
      assert.equal(second.alreadyDispatched, true);
    } finally {
      botAcessClient.sendDocumentForProcessing = original;
    }
    const stored = materialRepository.findJobById(job.id);
    assert.equal(stored.status, 'PROCESSING');
    assert.equal(stored.external_job_id, `ext1_${suffix}`);
  });

  await t.test('4. Concluir de novo o mesmo job não cria outra versão', async () => {
    const { material, version } = await newMaterial('repetido');
    const job = await materialService.requestProcessing(version.id, owner);
    materialRepository.updateProcessingJobStatus(job.id, 'PROCESSING', { externalJobId: `rep${suffix}` });
    const completed = { status: 'COMPLETED', processedDocumentUrl: `/uploads/inexistente_${suffix}.html`, downloadUrl: null };

    await botAcessService.handleJobCompleted(job.id, completed);
    materialRepository.updateMaterialStatus(material.id, 'EM_REVISAO');
    const again = await botAcessService.handleJobCompleted(job.id, completed);

    assert.equal(again, null);
    const numbers = materialRepository.getMaterialVersions(material.id).map(v => v.version_number);
    assert.deepEqual(numbers, [2, 1]);
    assert.equal(materialRepository.findMaterialById(material.id).current_status, 'EM_REVISAO', 'o status não volta para AGUARDANDO_REVISAO');
  });

  await t.test('5. Poller e sincronização vendo a mesma conclusão ao mesmo tempo criam uma versão só', async () => {
    const { material, version } = await newMaterial('simultaneo');
    const job = await materialService.requestProcessing(version.id, owner);
    materialRepository.updateProcessingJobStatus(job.id, 'PROCESSING', { externalJobId: `sim${suffix}` });
    const downloadUrl = `https://core.exemplo/download/sim${suffix}`;
    const completed = { status: 'COMPLETED', downloadUrl, processedDocumentUrl: downloadUrl };

    const gate = deferred();
    const original = botAcessClient.fetchProcessedFile;
    botAcessClient.fetchProcessedFile = async () => { await gate.promise; return { ok: false }; };
    try {
      const both = Promise.all([
        botAcessService.handleJobCompleted(job.id, completed),
        botAcessService.handleJobCompleted(job.id, completed)
      ]);
      await new Promise(r => setImmediate(r));
      gate.resolve();
      const results = await both;
      assert.equal(results.filter(Boolean).length, 1);
    } finally {
      botAcessClient.fetchProcessedFile = original;
    }
    const numbers = materialRepository.getMaterialVersions(material.id).map(v => v.version_number);
    assert.deepEqual(numbers, [2, 1]);
  });
});
