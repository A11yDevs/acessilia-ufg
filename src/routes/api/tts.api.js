import path from 'node:path';
import fs from 'node:fs';
import { edgeTtsService } from '../../services/edge-tts.service.js';
import { materialRepository } from '../../repositories/material.repository.js';
import { botAcessClient } from '../../integrations/bot-acess/client.js';

export async function ttsApiRoutes(fastify, opts) {
  /**
   * Retorna os chunks semânticos de áudio de um material
   */
  fastify.get('/api/v1/materials/:id/tts/chunks', {
    preHandler: [fastify.requirePermission('materiais.visualizar')]
  }, async (request, reply) => {
    const materialId = parseInt(request.params.id, 10);
    const material = materialRepository.findMaterialById(materialId);
    if (!material) {
      return reply.status(404).send({ error: 'Material não encontrado.' });
    }

    const versions = materialRepository.getMaterialVersions(materialId);
    const processedVersion = versions.find(v => v.version_type === 'PROCESSADO_BOT');

    let htmlContent = '';

    // 1. Tenta carregar do disco local
    if (processedVersion && processedVersion.storage_path) {
      const diskPath = path.isAbsolute(processedVersion.storage_path)
        ? processedVersion.storage_path
        : path.resolve(process.cwd(), '.' + processedVersion.storage_path);
      if (fs.existsSync(diskPath)) {
        try {
          htmlContent = fs.readFileSync(diskPath, 'utf8');
        } catch (_) {}
      }
    }

    // 2. Se não estiver no disco, tenta buscar do Core via token
    if (!htmlContent && processedVersion) {
      const coreToken = botAcessClient.extractDownloadToken(processedVersion.storage_path);
      if (coreToken) {
        try {
          const res = await botAcessClient.fetchProcessedFile(coreToken, 'html');
          if (res.ok && res.buffer) {
            htmlContent = res.buffer.toString('utf8');
            // Salva no disco local para próximos acessos
            const savePath = path.resolve(process.cwd(), `uploads/accessible_${processedVersion.id}.html`);
            try { fs.writeFileSync(savePath, htmlContent); } catch (_) {}
          }
        } catch (_) {}
      }
    }

    // 3. Fallback: se não tiver versão processada, usa título e descrição
    if (!htmlContent) {
      htmlContent = `<h1>${material.title}</h1><p>${material.description || 'Material acadêmico disponibilizado na plataforma.'}</p>`;
    }

    const chunks = edgeTtsService.createChunksFromHtml(htmlContent);
    const voices = edgeTtsService.getAvailableVoices();

    return reply.send({
      materialId,
      totalChunks: chunks.length,
      chunks,
      voices
    });
  });

  /**
   * Sintetiza e entrega o áudio MP3 de um chunk específico
   */
  fastify.get('/api/v1/materials/:id/tts/audio', {
    preHandler: [fastify.requirePermission('materiais.visualizar')]
  }, async (request, reply) => {
    const materialId = parseInt(request.params.id, 10);
    const chunkIndex = parseInt(request.query.chunkIndex || '0', 10);
    const voice = request.query.voice || 'pt-BR-FranciscaNeural';
    const rate = parseFloat(request.query.rate || '1.0');

    const material = materialRepository.findMaterialById(materialId);
    if (!material) {
      return reply.status(404).send({ error: 'Material não encontrado.' });
    }

    // Busca o texto do chunk
    let textToSpeak = request.query.text;

    if (!textToSpeak) {
      const versions = materialRepository.getMaterialVersions(materialId);
      const processedVersion = versions.find(v => v.version_type === 'PROCESSADO_BOT');
      let htmlContent = '';

      if (processedVersion && processedVersion.storage_path) {
        const diskPath = path.isAbsolute(processedVersion.storage_path)
          ? processedVersion.storage_path
          : path.resolve(process.cwd(), '.' + processedVersion.storage_path);
        if (fs.existsSync(diskPath)) {
          htmlContent = fs.readFileSync(diskPath, 'utf8');
        }
      }

      if (!htmlContent) {
        htmlContent = `<h1>${material.title}</h1><p>${material.description || ''}</p>`;
      }

      const chunks = edgeTtsService.createChunksFromHtml(htmlContent);
      if (!chunks[chunkIndex]) {
        return reply.status(404).send({ error: `Chunk index ${chunkIndex} não encontrado.` });
      }
      textToSpeak = chunks[chunkIndex].text;
    }

    try {
      const audioBuffer = await edgeTtsService.synthesizeChunk(textToSpeak, { voice, rate });
      reply.header('Content-Type', 'audio/mpeg');
      reply.header('Cache-Control', 'public, max-age=86400');
      return reply.send(audioBuffer);
    } catch (err) {
      request.log.error(err, '[TTS] Falha ao sintetizar áudio');
      return reply.status(502).send({ error: `Falha na síntese de voz: ${err.message}` });
    }
  });

  /**
   * Endpoint genérico para sintetizar qualquer texto/audiodescrição sob demanda
   */
  fastify.post('/api/v1/tts/synthesize', {
    preHandler: [fastify.requirePermission('materiais.visualizar')]
  }, async (request, reply) => {
    const { text, voice = 'pt-BR-FranciscaNeural', rate = 1.0 } = request.body || {};
    if (!text || typeof text !== 'string') {
      return reply.status(400).send({ error: 'Texto para síntese é obrigatório.' });
    }

    try {
      const audioBuffer = await edgeTtsService.synthesizeChunk(text, { voice, rate });
      reply.header('Content-Type', 'audio/mpeg');
      return reply.send(audioBuffer);
    } catch (err) {
      request.log.error(err, '[TTS] Falha na síntese sob demanda');
      return reply.status(502).send({ error: `Falha na síntese de voz: ${err.message}` });
    }
  });
}
