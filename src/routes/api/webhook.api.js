import { materialRepository } from '../../repositories/material.repository.js';
import { auditRepository } from '../../repositories/audit.repository.js';

export async function webhookApiRoutes(fastify, opts) {
  // Webhook assíncrono chamado pelo bot-acess ao concluir ou falhar um job
  fastify.post('/api/v1/webhooks/bot-acess', async (request, reply) => {
    const { externalJobId, status, processedDocumentUrl, errorMessage, signature } = request.body || {};

    if (!externalJobId || !status) {
      return reply.status(400).send({ error: 'externalJobId e status são obrigatórios' });
    }
    if (!['COMPLETED', 'FAILED'].includes(status)) {
      return reply.status(400).send({ error: `Status desconhecido (${status}). Permitidos: COMPLETED, FAILED.` });
    }

    // Localizar o job pelo externalJobId
    const job = fastify.db ? fastify.db.prepare('SELECT * FROM processing_jobs WHERE external_job_id = ?').get(externalJobId)
      : (await import('../../../database/connection.js')).db.prepare('SELECT * FROM processing_jobs WHERE external_job_id = ?').get(externalJobId);

    if (!job) {
      return reply.status(404).send({ error: 'Job externo não localizado' });
    }

    const version = materialRepository.findVersionById(job.material_version_id);

    // Idempotência: o job pode já ter sido concluído pela sincronização ativa
    // (consulta ao Core) ou por um aviso anterior. Repetir não cria outra versão
    // nem desfaz o que já foi concluído.
    if (job.status === 'COMPLETED') {
      return reply.send({ success: true, message: 'Job já concluído anteriormente; nenhuma alteração feita.' });
    }

    if (status === 'COMPLETED') {
      const nextVersionNumber = version.version_number + 1;
      const newVersion = materialRepository.createVersion({
        materialId: version.material_id,
        versionNumber: nextVersionNumber,
        storageProvider: 'LOCAL_DISK',
        storageKey: `proc_${externalJobId}`,
        storagePath: processedDocumentUrl || `/uploads/accessible_${externalJobId}.html`,
        originalFilename: `acessivel_${version.original_filename}`,
        mimeType: 'text/html',
        fileSizeBytes: 2048,
        sha256Hash: `hash_webhook_${Date.now()}`,
        versionType: 'PROCESSADO_BOT',
        uploadedByUserId: version.uploaded_by_user_id
      });

      materialRepository.updateProcessingJobStatus(job.id, 'COMPLETED');
      materialRepository.updateMaterialStatus(version.material_id, 'AGUARDANDO_REVISAO');

      auditRepository.createLog({
        userId: null,
        action: 'WEBHOOK_BOT_ACESS_COMPLETED',
        resource: 'processing_jobs',
        resourceId: job.id,
        details: { externalJobId, newVersionId: newVersion.id }
      });

      return reply.send({ success: true, message: 'Material processado e pronto para revisão humana', versionId: newVersion.id });
    } else {
      materialRepository.updateProcessingJobStatus(job.id, 'FAILED', { errorMessage });
      // Falha técnica do motor não é correção a cargo do professor
      materialRepository.updateMaterialStatus(version.material_id, 'FALHA_PROCESSAMENTO');

      auditRepository.createLog({
        userId: null,
        action: 'WEBHOOK_BOT_ACESS_FAILED',
        resource: 'processing_jobs',
        resourceId: job.id,
        details: { externalJobId, errorMessage }
      });

      return reply.send({ success: true, message: 'Falha de processamento registrada' });
    }
  });
}
