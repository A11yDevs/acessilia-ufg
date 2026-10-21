import { userRepository } from '../../repositories/user.repository.js';

export async function preferencesApiRoutes(fastify, opts) {
  const savePreferencesHandler = async (request, reply) => {
    const { contrastMode, fontSize, dyslexiaFont, preferredDownloadFormat } = request.body || {};
    userRepository.saveUiPreferences(request.user.id, {
      contrastMode,
      fontSize,
      dyslexiaFont,
      preferredDownloadFormat
    });
    return reply.send({ success: true });
  };

  const getPreferencesHandler = async (request, reply) => {
    const prefs = userRepository.getUiPreferences(request.user.id);
    return reply.send(prefs);
  };

  fastify.post('/api/v1/usuarios/preferencias', {
    preHandler: [fastify.requireAuth]
  }, savePreferencesHandler);

  fastify.post('/gestor/api/v1/usuarios/preferencias', {
    preHandler: [fastify.requireAuth]
  }, savePreferencesHandler);

  fastify.get('/api/v1/usuarios/preferencias', {
    preHandler: [fastify.requireAuth]
  }, getPreferencesHandler);

  fastify.get('/gestor/api/v1/usuarios/preferencias', {
    preHandler: [fastify.requireAuth]
  }, getPreferencesHandler);
}
