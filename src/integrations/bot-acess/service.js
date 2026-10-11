import fs from 'fs';
import path from 'path';
import { botAcessClient } from './client.js';
import { materialRepository } from '../../repositories/material.repository.js';
import { auditRepository } from '../../repositories/audit.repository.js';

export const botAcessService = {
  // Dispara o processamento externo desacoplado
  async dispatchJob(jobId) {
    const job = materialRepository.findJobById(jobId);
    if (!job) throw new Error('Job não encontrado');

    const version = materialRepository.findVersionById(job.material_version_id);
    if (!version) throw new Error('Versão não encontrada');

    // 1. Resolver o arquivo físico e carregar o buffer real
    const diskPath = path.isAbsolute(version.storage_path)
      ? version.storage_path
      : path.resolve(process.cwd(), '.' + version.storage_path);

    let fileBuffer = null;
    if (fs.existsSync(diskPath)) {
      fileBuffer = fs.readFileSync(diskPath);
    }

    // 2. Enviar para API do bot-acess (Acessilia)
    const response = await botAcessClient.sendDocumentForProcessing({
      jobId: job.id,
      fileBuffer,
      fileUrl: version.storage_path,
      filename: version.original_filename,
      mimeType: version.mime_type
    });

    if (response.success) {
      materialRepository.updateProcessingJobStatus(job.id, 'PROCESSING', {
        externalJobId: response.externalJobId
      });
      materialRepository.updateMaterialStatus(version.material_id, 'PROCESSANDO');
      return { success: true, externalJobId: response.externalJobId };
    } else {
      materialRepository.updateProcessingJobStatus(job.id, 'FAILED', {
        errorMessage: response.error
      });
      materialRepository.updateMaterialStatus(version.material_id, 'FALHA_PROCESSAMENTO');
      return { success: false, error: response.error };
    }
  },

  // Sincroniza ativamente o status de um material em processamento
  async syncActiveJobForMaterial(materialId) {
    const activeJob = materialRepository.findActiveJobForMaterial(materialId);
    if (!activeJob || !activeJob.external_job_id) return null;

    try {
      const statusRes = await botAcessClient.checkJobStatus(activeJob.external_job_id);
      if (statusRes.status === 'COMPLETED') {
        return await this.handleJobCompleted(activeJob.id);
      } else if (statusRes.status === 'FAILED') {
        materialRepository.updateProcessingJobStatus(activeJob.id, 'FAILED', {
          errorMessage: statusRes.error || 'Falha no processamento do motor Acessilia.'
        });
        materialRepository.updateMaterialStatus(materialId, 'FALHA_PROCESSAMENTO');
        return { failed: true, error: statusRes.error };
      }
    } catch (_) {}
    return null;
  },

  // Notifica progresso em tempo real da tarefa (SSE)
  async updateJobProgress(jobId, { progress, step }) {
    const job = materialRepository.findJobById(jobId);
    if (!job) return;
    const version = materialRepository.findVersionById(job.material_version_id);
    if (!version) return;

    try {
      const { notificationEvents } = await import('../../routes/api/notifications.api.js');
      notificationEvents.emit('notify', {
        type: 'PROCESSING_PROGRESS',
        materialId: version.material_id,
        jobId: job.id,
        progress: typeof progress === 'number' ? Math.round(progress * 100) : null,
        currentStep: step || 'Processando no motor Acessilia...',
        status: 'PROCESSANDO'
      });
    } catch (_) {}
  },

  // Sincroniza resultado final gerando a versão PROCESSADO_BOT
  async handleJobCompleted(jobId) {
    const job = materialRepository.findJobById(jobId);
    if (!job || !job.external_job_id) throw new Error('Job inválido para sincronização');

    const result = await botAcessClient.checkJobStatus(job.external_job_id);

    if (result.status === 'COMPLETED') {
      const originalVersion = materialRepository.findVersionById(job.material_version_id);
      const nextVersionNumber = originalVersion.version_number + 1;

      // Cria a nova versão gerada pela IA
      const newVersion = materialRepository.createVersion({
        materialId: originalVersion.material_id,
        versionNumber: nextVersionNumber,
        storageProvider: 'LOCAL_DISK',
        storageKey: `proc_${job.external_job_id}`,
        storagePath: result.processedDocumentUrl,
        originalFilename: `acessivel_${originalVersion.original_filename}`,
        mimeType: 'text/html',
        fileSizeBytes: 1024,
        sha256Hash: `hash_ia_${Date.now()}`,
        versionType: 'PROCESSADO_BOT',
        uploadedByUserId: originalVersion.uploaded_by_user_id
      });

      materialRepository.updateProcessingJobStatus(job.id, 'COMPLETED');
      materialRepository.updateMaterialStatus(originalVersion.material_id, 'AGUARDANDO_REVISAO');

      // Popula exemplos de alt-text sugeridos pela IA para validação do professor/revisor
      materialRepository.createAltText({
        materialVersionId: newVersion.id,
        imageUrlOrPath: '/public/images/sample_slide_fig1.png',
        aiSuggestedAlt: 'Gráfico de barras ilustrando a distribuição de memória RAM por processo no sistema operacional.',
        status: 'PENDENTE'
      });

      // Emite SSE para atualizar instantaneamente qualquer usuário com a lista aberta
      try {
        const { notificationEvents } = await import('../../routes/api/notifications.api.js');
        notificationEvents.emit('notify', {
          type: 'MATERIAL_UPDATED',
          materialId: originalVersion.material_id,
          status: 'AGUARDANDO_REVISAO',
          progress: 100,
          currentStep: 'Processamento concluído com sucesso',
          title: 'Material Processado',
          message: 'Processamento de IA concluído com sucesso. Aguardando revisão humana.'
        });
      } catch (_) {}

      return newVersion;
    }
  }
};

