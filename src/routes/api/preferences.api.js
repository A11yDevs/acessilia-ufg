import { userRepository } from '../../repositories/user.repository.js';

export async function preferencesApiRoutes(fastify, opts) {
  fastify.post('/api/v1/usuarios/preferencias', {
    preHandler: [fastify.requireAuth]
  }, async (request, reply) => {
    const { contrastMode, fontSize, dyslexiaFont, preferredDownloadFormat } = request.body || {};
    userRepository.saveUiPreferences(request.user.id, {
      contrastMode,
      fontSize,
      dyslexiaFont,
      preferredDownloadFormat
    });
    return reply.send({ success: true });
  });

  fastify.get('/api/v1/usuarios/preferencias', {
    preHandler: [fastify.requireAuth]
  }, async (request, reply) => {
    const prefs = userRepository.getUiPreferences(request.user.id);
    return reply.send(prefs);
  });
}
