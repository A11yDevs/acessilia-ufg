import { botAcessClient } from './client.js';
import { materialRepository } from '../../repositories/material.repository.js';
import { auditRepository } from '../../repositories/audit.repository.js';

export const botAcessService = {
  // Dispara o processamento externo desacoplado
  async dispatchJob(jobId) {
    const job = materialRepository.findJobById(jobId);
    if (!job) throw new Error('Job não encontrado');

    const version = materialRepository.findVersionById(job.material_version_id);

    // 1. Enviar para API do bot-acess (Acessilia)
    const response = await botAcessClient.sendDocumentForProcessing({
      jobId: job.id,
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
      return { success: false, error: response.error };
    }
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

      return newVersion;
    }
  }
};
