import { piperTtsService } from '../../services/piper-tts.service.js';
import { materialRepository } from '../../repositories/material.repository.js';
import { loadProcessedHtml } from '../../services/processed-document.service.js';

async function getMaterialHtml(material, processedVersion) {
  let htmlContent = processedVersion ? (await loadProcessedHtml(processedVersion)) || '' : '';

  if (!htmlContent) {
    htmlContent = `<h1>${material.title}</h1><p>${material.description || 'Material acadêmico disponibilizado na plataforma.'}</p>`;
  }

  return htmlContent;
}

export async function ttsApiRoutes(fastify, opts) {
  /**
   * Retorna os chunks semânticos de áudio de um material
   */
  const chunksHandler = async (request, reply) => {
    const materialId = parseInt(request.params.id, 10);
    const material = materialRepository.findMaterialById(materialId);
    if (!material) {
      return reply.status(404).send({ error: 'Material não encontrado.' });
    }

    const versions = materialRepository.getMaterialVersions(materialId);
    const processedVersion = versions.find(v => v.version_type === 'PROCESSADO_BOT');

    const htmlContent = await getMaterialHtml(material, processedVersion);
    const chunks = piperTtsService.createChunksFromHtml(htmlContent);
    const voices = piperTtsService.getAvailableVoices();

    return reply.send({
      materialId,
      totalChunks: chunks.length,
      chunks,
      voices
    });
  };

  fastify.get('/api/v1/materials/:id/tts/chunks', {
    preHandler: [fastify.requirePermission('materiais.visualizar')]
  }, chunksHandler);

  // Rotas de compatibilidade para variações inseridas por proxies reversos
  fastify.get('/api/v1/materials/:id/gestor/tts/chunks', {
    preHandler: [fastify.requirePermission('materiais.visualizar')]
  }, chunksHandler);
  fastify.get('/api/gestor/v1/gestor/materials/gestor/:id/gestor/tts/gestor/chunks', {
    preHandler: [fastify.requirePermission('materiais.visualizar')]
  }, chunksHandler);
  fastify.get('/gestor/api/v1/materials/:id/tts/chunks', {
    preHandler: [fastify.requirePermission('materiais.visualizar')]
  }, chunksHandler);

  /**
   * Sintetiza e entrega o áudio WAV de um chunk específico
   */
  const audioHandler = async (request, reply) => {
    const materialId = parseInt(request.params.id, 10);
    const chunkIndex = parseInt(request.query.chunkIndex || '0', 10);
    const voice = request.query.voice || 'pt_BR-cadu-medium';
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
      const htmlContent = await getMaterialHtml(material, processedVersion);

      const chunks = piperTtsService.createChunksFromHtml(htmlContent);
      if (!chunks[chunkIndex]) {
        return reply.status(404).send({ error: `Chunk index ${chunkIndex} não encontrado.` });
      }
      textToSpeak = chunks[chunkIndex].text;
    }

    try {
      const audioBuffer = await piperTtsService.synthesizeChunk(textToSpeak, { voice, rate });

      // Se solicitado especificamente áudio binário bruto (ex: download direto)
      if (request.query.format === 'raw') {
        reply.header('Content-Type', 'audio/wav');
        reply.header('Cache-Control', 'public, max-age=86400');
        return reply.send(audioBuffer);
      }

      // Entrega como JSON Base64: 100% imune a mod_substitute do Apache (evita corrupção de PCM/chiadas)
      const base64Audio = `data:audio/wav;base64,${audioBuffer.toString('base64')}`;
      return reply.send({
        format: 'wav',
        audio: base64Audio
      });
    } catch (err) {
      request.log.error(err, '[TTS] Falha ao sintetizar áudio');
      return reply.status(502).send({ error: `Falha na síntese de voz: ${err.message}` });
    }
  };

  fastify.get('/api/v1/materials/:id/tts/audio', {
    preHandler: [fastify.requirePermission('materiais.visualizar')]
  }, audioHandler);

  // Rotas de compatibilidade para variações inseridas por proxies reversos
  fastify.get('/api/v1/materials/:id/gestor/tts/audio', {
    preHandler: [fastify.requirePermission('materiais.visualizar')]
  }, audioHandler);
  fastify.get('/api/gestor/v1/gestor/materials/gestor/:id/gestor/tts/gestor/audio', {
    preHandler: [fastify.requirePermission('materiais.visualizar')]
  }, audioHandler);
  fastify.get('/gestor/api/v1/materials/:id/tts/audio', {
    preHandler: [fastify.requirePermission('materiais.visualizar')]
  }, audioHandler);

  /**
   * Endpoint genérico para sintetizar qualquer texto/audiodescrição sob demanda
   */
  const synthesizeHandler = async (request, reply) => {
    const { text, voice = 'pt_BR-cadu-medium', rate = 1.0 } = request.body || {};
    if (!text || typeof text !== 'string') {
      return reply.status(400).send({ error: 'Texto para síntese é obrigatório.' });
    }

    try {
      const audioBuffer = await piperTtsService.synthesizeChunk(text, { voice, rate });
      const base64Audio = `data:audio/wav;base64,${audioBuffer.toString('base64')}`;
      return reply.send({
        format: 'wav',
        audio: base64Audio
      });
    } catch (err) {
      request.log.error(err, '[TTS] Falha na síntese sob demanda');
      return reply.status(502).send({ error: `Falha na síntese de voz: ${err.message}` });
    }
  };

  fastify.post('/api/v1/tts/synthesize', {
    preHandler: [fastify.requirePermission('materiais.visualizar')]
  }, synthesizeHandler);

  fastify.post('/api/v1/gestor/tts/synthesize', {
    preHandler: [fastify.requirePermission('materiais.visualizar')]
  }, synthesizeHandler);

  fastify.post('/gestor/api/v1/tts/synthesize', {
    preHandler: [fastify.requirePermission('materiais.visualizar')]
  }, synthesizeHandler);

  fastify.post('/api/gestor/v1/gestor/tts/gestor/synthesize', {
    preHandler: [fastify.requirePermission('materiais.visualizar')]
  }, synthesizeHandler);
}
