import fs from 'fs';
import path from 'path';
import { botAcessClient } from './client.js';
import { materialRepository } from '../../repositories/material.repository.js';
import { auditRepository } from '../../repositories/audit.repository.js';
import { parseAcessiliaMetadata } from '../../utils/meta-parser.js';

export const botAcessService = {
  // Dispara o processamento externo desacoplado
  async dispatchJob(jobId) {
    const job = materialRepository.findJobById(jobId);
    if (!job) throw new Error('Job não encontrado');

    const version = materialRepository.findVersionById(job.material_version_id);
    if (!version) throw new Error('Versão não encontrada');

    // 1. Resolver o arquivo físico e carregar o buffer real
    // storage_path é gravado como '/uploads/<arquivo>', relativo à raiz do projeto
    // (material.service.js). Como começa com '/', path.isAbsolute() o trata como
    // caminho absoluto do sistema; por isso a raiz do projeto é tentada primeiro.
    const storagePath = version.storage_path || '';
    const candidates = [
      path.resolve(process.cwd(), '.' + (storagePath.startsWith('/') ? storagePath : '/' + storagePath)),
      storagePath
    ];
    const diskPath = candidates.find(p => p && fs.existsSync(p) && fs.statSync(p).isFile());

    let fileBuffer = null;
    if (diskPath) {
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
        externalJobId: response.externalJobId,
        jobToken: response.jobToken
      });
      materialRepository.updateMaterialStatus(version.material_id, 'PROCESSANDO');
      return { success: true, externalJobId: response.externalJobId, jobToken: response.jobToken };
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
      const statusRes = await botAcessClient.checkJobStatus(activeJob.external_job_id, activeJob.job_token);
      if (statusRes.status === 'COMPLETED') {
        return await this.handleJobCompleted(activeJob.id, statusRes);
      } else if (statusRes.status === 'PROCESSING') {
        await this.updateJobProgress(activeJob.id, {
          progress: statusRes.progress,
          step: statusRes.currentStep
        });
        return { processing: true, progress: statusRes.progress, step: statusRes.currentStep };
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
  async handleJobCompleted(jobId, prefetchedResult = null) {
    const job = materialRepository.findJobById(jobId);
    if (!job || !job.external_job_id) throw new Error('Job inválido para sincronização');

    const result = prefetchedResult || await botAcessClient.checkJobStatus(job.external_job_id, job.job_token);

    if (result.status === 'COMPLETED') {
      const originalVersion = materialRepository.findVersionById(job.material_version_id);
      const nextVersionNumber = originalVersion.version_number + 1;

      // 1. Tenta baixar o arquivo processado pelo Core para salvar no disco local
      let storagePath = result.processedDocumentUrl;
      let htmlContent = null;
      let fileSizeBytes = 1024;

      const coreToken = botAcessClient.extractDownloadToken(result.downloadUrl || result.processedDocumentUrl);
      if (coreToken) {
        try {
          const fileRes = await botAcessClient.fetchProcessedFile(coreToken, 'html');
          if (fileRes.ok && fileRes.buffer) {
            htmlContent = fileRes.buffer.toString('utf8');
            fileSizeBytes = fileRes.buffer.length;
            const filename = `accessible_${job.external_job_id || Date.now()}.html`;
            const fullDiskPath = path.resolve(process.cwd(), 'uploads', filename);
            fs.writeFileSync(fullDiskPath, fileRes.buffer);
            storagePath = `/uploads/${filename}`;
          }
        } catch (_) {}
      } else if (result.processedDocumentUrl && result.processedDocumentUrl.startsWith('/uploads/')) {
        const diskPath = path.resolve(process.cwd(), '.' + result.processedDocumentUrl);
        if (fs.existsSync(diskPath)) {
          try {
            htmlContent = fs.readFileSync(diskPath, 'utf8');
            fileSizeBytes = fs.statSync(diskPath).size;
          } catch (_) {}
        }
      }

      // 2. Cria a nova versão gerada pela IA
      const newVersion = materialRepository.createVersion({
        materialId: originalVersion.material_id,
        versionNumber: nextVersionNumber,
        storageProvider: 'LOCAL_DISK',
        storageKey: `proc_${job.external_job_id}`,
        storagePath,
        originalFilename: `acessivel_${originalVersion.original_filename.replace(/\.[^.]+$/, '')}.html`,
        mimeType: 'text/html',
        fileSizeBytes,
        sha256Hash: `hash_ia_${Date.now()}`,
        versionType: 'PROCESSADO_BOT',
        uploadedByUserId: originalVersion.uploaded_by_user_id
      });

      materialRepository.updateProcessingJobStatus(job.id, 'COMPLETED');
      materialRepository.updateMaterialStatus(originalVersion.material_id, 'AGUARDANDO_REVISAO');

      // 3. Extrai alt-texts reais gerados pelo Core a partir dos metadados do HTML
      let extractedAlts = [];
      if (htmlContent) {
        try {
          const meta = parseAcessiliaMetadata(htmlContent);
          if (meta && Array.isArray(meta.imageDetails) && meta.imageDetails.length > 0) {
            extractedAlts = meta.imageDetails;
          }
        } catch (_) {}
      }

      if (extractedAlts.length > 0) {
        for (const img of extractedAlts) {
          materialRepository.createAltText({
            materialVersionId: newVersion.id,
            imageUrlOrPath: img.id || '/public/images/figura.png',
            aiSuggestedAlt: img.altText || 'Elemento visual acessibilizado pelo motor Acessilia.',
            status: 'PENDENTE'
          });
        }
      }

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
  },

  _pollerTimer: null,
  _isPolling: false,

  startBackgroundPoller(intervalMs = 5000) {
    if (this._pollerTimer) return;
    this._pollerTimer = setInterval(async () => {
      if (this._isPolling) return;
      this._isPolling = true;
      try {
        const activeJobs = materialRepository.listActiveJobs();
        for (const job of activeJobs) {
          if (!job.external_job_id) continue;
          try {
            const statusRes = await botAcessClient.checkJobStatus(job.external_job_id, job.job_token);
            if (statusRes.status === 'COMPLETED') {
              await this.handleJobCompleted(job.id, statusRes);
            } else if (statusRes.status === 'PROCESSING') {
              await this.updateJobProgress(job.id, {
                progress: statusRes.progress,
                step: statusRes.currentStep
              });
            } else if (statusRes.status === 'FAILED') {
              materialRepository.updateProcessingJobStatus(job.id, 'FAILED', {
                errorMessage: statusRes.error || 'Falha no processamento do motor Acessilia.'
              });
              materialRepository.updateMaterialStatus(job.material_id, 'FALHA_PROCESSAMENTO');
            }
          } catch (_) {}
        }
      } catch (_) {}
      finally {
        this._isPolling = false;
      }
    }, intervalMs);

    if (this._pollerTimer && this._pollerTimer.unref) {
      this._pollerTimer.unref();
    }
  },

  stopBackgroundPoller() {
    if (this._pollerTimer) {
      clearInterval(this._pollerTimer);
      this._pollerTimer = null;
    }
  }
};

