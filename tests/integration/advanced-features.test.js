import test from 'node:test';
import assert from 'node:assert/strict';
import { backupService } from '../../src/services/backup.service.js';
import { buildApp } from '../../src/app.js';
import { materialService } from '../../src/services/material.service.js';
import { materialRepository } from '../../src/repositories/material.repository.js';

test('Melhorias Avançadas: Backup do SQLite, Webhook do bot-acess e Barra de A11y', async (t) => {
  const app = await buildApp({ logger: false });

  await t.test('1. Backup a Quente do SQLite via Online Backup API', async () => {
    const backup = await backupService.performBackup('./database/backups');
    assert.ok(backup.fileName);
    assert.ok(backup.sizeBytes > 0);
    assert.match(backup.fileName, /^backup_bot_acess_/);
  });

  await t.test('2. Webhook API do bot-acess atualiza job e cria versão processada v2', async () => {
    // 1. Criar material de teste
    const teacherActor = { id: 2, roleCode: 'PROFESSOR' };
    const { material, version } = await materialService.uploadMaterial({
      subjectId: 1,
      title: 'Material para Teste de Webhook',
      category: 'SLIDE',
      originalFilename: 'aula_webhook.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 2048,
      fileBuffer: Buffer.from('PDF_DUMMY')
    }, teacherActor);

    // 2. Criar job pendente com external_job_id
    const job = await materialService.requestProcessing(version.id, teacherActor);
    const mockExternalId = `ext_hook_${Date.now()}`;
    materialRepository.updateProcessingJobStatus(job.id, 'PROCESSING', { externalJobId: mockExternalId });

    // 3. Simular requisição do bot-acess para o Webhook do painel
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/bot-acess',
      payload: {
        externalJobId: mockExternalId,
        status: 'COMPLETED',
        processedDocumentUrl: `/uploads/accessible_${mockExternalId}.html`
      }
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.success, true);
    assert.ok(body.versionId);

    // Verifica se o material avançou para AGUARDANDO_REVISAO
    const updatedMaterial = materialRepository.findMaterialById(material.id);
    assert.equal(updatedMaterial.current_status, 'AGUARDANDO_REVISAO');
  });

  await app.close();
});
