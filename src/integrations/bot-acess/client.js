import { env } from '../../config/env.js';

/**
 * Cliente HTTP isolado e desacoplado para a API REST do Acessilia (motor de IA).
 * Compatível com o repositório oficial: https://github.com/A11yDevs/acessilia
 * 
 * Endpoints consumidos (/api/v1):
 * - POST /jobs : Envio de documento (task_id, position, message)
 * - GET /jobs/{task_id} : Consulta status (progresso, status, download_url)
 * - POST /jobs/{task_id}/cancel : Cancelamento de job
 * - GET /download/{token}/{format} : Download nos formatos txt, docx, pdf, pdf_ua, html, mp3
 * - GET /health : Status de saúde do motor e modelos
 */
// O Core limita requisições por IP (backend/api/routes: 5/min em POST /jobs,
// 20/min em GET /download) e responde 429 sem Retry-After. Como todo o Gestor sai
// do mesmo IP, a cota é dividida entre todos os usuários.
export const CORE_RATE_LIMIT_MESSAGE = 'O Acessilia Core recebeu muitos envios ao mesmo tempo; tente reprocessar em 1 minuto.';
export const CORE_DOWNLOAD_RATE_LIMIT_MESSAGE = 'O Acessilia Core recebeu muitos pedidos de download ao mesmo tempo; tente novamente em 1 minuto.';

export class BotAcessClient {
  constructor(baseUrl = env.BOT_ACESS_API_URL, apiKey = env.BOT_ACESS_API_KEY) {
    this.baseUrl = (baseUrl || 'http://localhost:8000').replace(/\/$/, '');
    this.apiKey = apiKey;
    // Esperas entre novas tentativas após 429 (curtas: a requisição do usuário fica aguardando)
    this.rateLimitRetryDelaysMs = [2000, 5000];
    this.maxRetryAfterMs = 10000;
  }

  /**
   * Faz a requisição e, se o Core responder 429, tenta de novo após uma espera curta
   * (Retry-After, se vier, limitado a maxRetryAfterMs). Devolve a última resposta (ou null).
   * makeRequest é uma função porque o corpo (FormData) e o AbortSignal não podem ser reaproveitados.
   */
  async _fetchWithRateLimitRetry(makeRequest) {
    let response = await makeRequest();
    for (const delayMs of this.rateLimitRetryDelaysMs) {
      if (!response || response.status !== 429) break;
      const retryAfterSec = Number(response.headers.get('retry-after'));
      const waitMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0
        ? Math.min(retryAfterSec * 1000, this.maxRetryAfterMs)
        : delayMs;
      await new Promise(resolve => setTimeout(resolve, waitMs));
      response = await makeRequest();
    }
    return response;
  }

  /**
   * Envia documento para a fila do motor Acessilia (/api/v1/jobs)
   * Suporta Buffer, Blob ou Stream direto.
   */
  async sendDocumentForProcessing({ jobId, fileUrl, fileBuffer, filename = 'documento.pdf', mimeType = 'application/pdf', customPrompt = '', mode = 'normal' }) {
    if (process.env.NODE_ENV === 'test') {
      return {
        success: true,
        externalJobId: `ext_acessilia_${jobId || Date.now()}_${Math.floor(Math.random() * 1000)}`,
        position: 1,
        status: 'QUEUED',
        message: 'Documento enfileirado no motor Acessilia (modo desacoplado de teste)'
      };
    }

    if (!fileBuffer || fileBuffer.length === 0) {
      return {
        success: false,
        error: 'Arquivo vazio ou não encontrado no disco para envio ao Acessilia Core.'
      };
    }

    try {
      const buildFormData = () => {
        const formData = new FormData();
        const blob = new Blob([fileBuffer], { type: mimeType });
        // O FastAPI do Core espera 'document_file' (backend/api/routes/jobs.py)
        formData.append('document_file', blob, filename);
        // Mantém fallback 'file' para máxima compatibilidade retroativa
        formData.append('file', blob, filename);
        formData.append('source', 'gestor');
        formData.append('mode', mode);
        if (customPrompt) {
          formData.append('custom_prompt', customPrompt);
        }
        return formData;
      };

      const response = await this._fetchWithRateLimitRetry(() => fetch(`${this.baseUrl}/api/v1/jobs`, {
        method: 'POST',
        headers: this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {},
        body: buildFormData(),
        signal: AbortSignal.timeout(10000)
      }).catch(() => null));

      // Limite de envios por minuto do Core: não é indisponibilidade
      if (response && response.status === 429) {
        return {
          success: false,
          rateLimited: true,
          error: CORE_RATE_LIMIT_MESSAGE
        };
      }

      if (response && response.ok) {
        const data = await response.json();
        return {
          success: true,
          externalJobId: data.task_id,
          jobToken: data.job_token || null,
          position: data.position,
          status: 'QUEUED',
          message: data.message || 'Documento enfileirado no Acessilia'
        };
      }

      return {
        success: false,
        error: 'Motor Acessilia Core indisponível ou inacessível no momento.'
      };
    } catch (err) {
      return {
        success: false,
        error: err.message
      };
    }
  }

  /**
   * Envia multipart direto para o Core a partir de stream/buffer de upload
   */
  async streamDocumentToCore(filePart, customPrompt = '', mode = 'normal') {
    try {
      const formData = new FormData();
      const buffer = await filePart.toBuffer();
      const blob = new Blob([buffer], { type: filePart.mimetype || 'application/pdf' });
      formData.append('document_file', blob, filePart.filename || 'documento.pdf');
      formData.append('file', blob, filePart.filename || 'documento.pdf');
      formData.append('source', 'gestor');
      formData.append('mode', mode);
      if (customPrompt) {
        formData.append('custom_prompt', customPrompt);
      }

      const response = await fetch(`${this.baseUrl}/api/v1/jobs`, {
        method: 'POST',
        headers: this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {},
        body: formData,
        signal: AbortSignal.timeout(10000)
      }).catch(() => null);

      if (response && response.ok) {
        const data = await response.json();
        return {
          success: true,
          externalJobId: data.task_id,
          jobToken: data.job_token || null,
          position: data.position,
          fileBuffer: buffer,
          filename: filePart.filename,
          mimeType: filePart.mimetype
        };
      }

      return {
        success: false,
        error: 'Motor Acessilia Core indisponível para streaming multipart no momento.'
      };
    } catch (err) {
      return {
        success: false,
        error: err.message
      };
    }
  }

  /**
   * Consulta status de processamento do job no Acessilia (/api/v1/jobs/{task_id})
   */
  async checkJobStatus(externalJobId, jobToken = null) {
    if (!externalJobId) {
      return {
        externalJobId: null,
        status: 'FAILED',
        error: 'Identificador de tarefa (externalJobId) não fornecido.'
      };
    }

    // Apenas em execução explícita da suíte de testes unitários/integração
    if (process.env.NODE_ENV === 'test') {
      return {
        externalJobId,
        status: 'COMPLETED',
        progress: 1.0,
        currentStep: 'Processamento concluído com sucesso (ambiente de teste)',
        processedDocumentUrl: `/uploads/accessible_${externalJobId}.html`,
        confidenceScore: 0.98
      };
    }

    try {
      const headers = {};
      if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;
      if (jobToken) headers['X-Job-Token'] = jobToken;

      const response = await fetch(`${this.baseUrl}/api/v1/jobs/${externalJobId}`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(4000)
      }).catch(() => null);

      if (response && response.ok) {
        const data = await response.json();
        // O Core responde em minúsculas: queued, processing, done, error, cancelled
        // (backend/api/worker.py). A comparação ignora maiúsculas/minúsculas.
        const coreStatus = String(data.status || '').toLowerCase();
        const isDone = coreStatus === 'done' || coreStatus === 'completed';
        const isFailed = ['error', 'failed', 'cancelled', 'canceled'].includes(coreStatus);
        return {
          externalJobId,
          status: isDone ? 'COMPLETED' : (isFailed ? 'FAILED' : 'PROCESSING'),
          error: isFailed ? ((data.erros || []).join('; ') || `Processamento encerrado no Core com status "${coreStatus}".`) : undefined,
          progress: data.progresso || 0,
          currentStep: data.etapa_atual || '',
          downloadUrl: data.download_url,
          processedDocumentUrl: data.download_url || `/uploads/accessible_${externalJobId}.html`,
          errors: data.erros || []
        };
      }

      // Core fora do ar ou resposta inesperada: não é falha do processamento.
      // O material continua em processamento e a consulta é refeita depois.
      return {
        externalJobId,
        status: 'UNAVAILABLE',
        error: 'Não foi possível obter o status da tarefa no motor Acessilia.'
      };
    } catch (err) {
      return {
        externalJobId,
        status: 'UNAVAILABLE',
        error: err.message
      };
    }
  }

  /**
   * Cancela uma tarefa em andamento no Acessilia (/api/v1/jobs/{task_id}/cancel)
   */
  async cancelJob(externalJobId, jobToken = null) {
    try {
      const headers = {};
      if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;
      if (jobToken) headers['X-Job-Token'] = jobToken;

      const response = await fetch(`${this.baseUrl}/api/v1/jobs/${externalJobId}/cancel`, {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(3000)
      }).catch(() => null);

      if (response && response.ok) {
        return await response.json();
      }
      return { task_id: externalJobId, status: 'CANCELLED' };
    } catch (err) {
      return { task_id: externalJobId, status: 'ERROR', error: err.message };
    }
  }

  /**
   * Consulta a saúde da API do Acessilia (/api/v1/health)
   */
  async checkHealth() {
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000)
      }).catch(() => null);

      if (response && response.ok) {
        const data = await response.json();
        return { online: true, ...data };
      }
      return { online: false, message: 'Motor Acessilia inacessível' };
    } catch (err) {
      return { online: false, error: err.message };
    }
  }

  /**
   * Constrói URL direta para download de um formato acessível (/api/v1/download/{token}/{format})
   * Formatos suportados: 'txt', 'docx', 'pdf', 'pdf_ua', 'html', 'mp3', 'zip'
   */
  getDownloadUrl(token, format = 'html') {
    return `${this.baseUrl}/api/v1/download/${token}/${format}`;
  }

  /**
   * Extrai o token de download da URL devolvida pelo Core em download_url
   * (ex.: https://core/download/<token> ou /api/v1/download/<token>/html).
   */
  extractDownloadToken(downloadUrl) {
    if (typeof downloadUrl !== 'string') return null;
    const match = downloadUrl.match(/\/download\/([A-Za-z0-9._~-]+)/);
    return match ? match[1] : null;
  }

  /**
   * Baixa do Core o arquivo processado em um formato (GET /api/v1/download/{token}/{format}).
   */
  async fetchProcessedFile(token, format = 'html') {
    try {
      const response = await this._fetchWithRateLimitRetry(() => fetch(this.getDownloadUrl(token, format), {
        method: 'GET',
        headers: this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {},
        signal: AbortSignal.timeout(30000)
      }).catch(() => null));

      if (!response) return { ok: false, status: 0 };
      if (response.status === 429) {
        return { ok: false, status: 429, rateLimited: true, error: CORE_DOWNLOAD_RATE_LIMIT_MESSAGE };
      }
      if (!response.ok) return { ok: false, status: response.status };

      return {
        ok: true,
        status: response.status,
        buffer: Buffer.from(await response.arrayBuffer()),
        contentType: response.headers.get('content-type') || 'application/octet-stream'
      };
    } catch (err) {
      return { ok: false, status: 0, error: err.message };
    }
  }
}

export const botAcessClient = new BotAcessClient();

