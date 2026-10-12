import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app.js';
import { materialService } from '../../src/services/material.service.js';
import { materialRepository } from '../../src/repositories/material.repository.js';

// Aviso do Core (webhook): repetição, status desconhecido e falha técnica.
test('Webhook do Core: idempotência, validação de status e falha técnica', async (t) => {
  const app = await buildApp({ logger: false });
  t.after(() => app.close());
  const teacherActor = { id: 2, roleCode: 'PROFESSOR' };

  async function materialWithJob(label) {
    const { material, version } = await materialService.uploadMaterial({
      subjectId: 1,
      title: `Material para webhook (${label})`,
      category: 'SLIDE',
      originalFilename: 'aula_webhook.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 9,
      fileBuffer: Buffer.from('PDF_DUMMY')
    }, teacherActor);
    const job = await materialService.requestProcessing(version.id, teacherActor);
    const externalJobId = `ext_hook_${label}_${Date.now()}`;
    materialRepository.updateProcessingJobStatus(job.id, 'PROCESSING', { externalJobId });
    return { material, externalJobId };
  }

  const post = (payload) => app.inject({ method: 'POST', url: '/api/v1/webhooks/bot-acess', payload });

  await t.test('1. Aviso de conclusão repetido não cria outra versão nem devolve erro', async () => {
    const { material, externalJobId } = await materialWithJob('repetido');

    const first = await post({ externalJobId, status: 'COMPLETED' });
    assert.equal(first.statusCode, 200);
    const second = await post({ externalJobId, status: 'COMPLETED' });
    assert.equal(second.statusCode, 200);
    assert.equal(second.json().success, true);

    assert.equal(materialRepository.getMaterialVersions(material.id).length, 2);
    assert.equal(materialRepository.findMaterialById(material.id).current_status, 'AGUARDANDO_REVISAO');
  });

  await t.test('2. Falha tardia não desfaz um job já concluído', async () => {
    const { material, externalJobId } = await materialWithJob('tardio');
    await post({ externalJobId, status: 'COMPLETED' });
    const late = await post({ externalJobId, status: 'FAILED', errorMessage: 'aviso atrasado' });

    assert.equal(late.statusCode, 200);
    assert.equal(materialRepository.findMaterialById(material.id).current_status, 'AGUARDANDO_REVISAO');
  });

  await t.test('3. Status desconhecido é recusado sem alterar o material', async () => {
    const { material, externalJobId } = await materialWithJob('desconhecido');
    const before = materialRepository.findMaterialById(material.id).current_status;

    const res = await post({ externalJobId, status: 'BANANA' });
    assert.equal(res.statusCode, 400);
    assert.equal(materialRepository.findMaterialById(material.id).current_status, before);
  });

  await t.test('4. Falha do Core vira FALHA_PROCESSAMENTO, não correção do professor', async () => {
    const { material, externalJobId } = await materialWithJob('falha');

    const res = await post({ externalJobId, status: 'FAILED', errorMessage: 'timeout no modelo' });
    assert.equal(res.statusCode, 200);
    assert.equal(materialRepository.findMaterialById(material.id).current_status, 'FALHA_PROCESSAMENTO');
  });
});
