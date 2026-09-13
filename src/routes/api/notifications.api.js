import { EventEmitter } from 'events';

class NotificationEmitter extends EventEmitter {}
export const notificationEvents = new NotificationEmitter();

export async function notificationsApiRoutes(fastify, opts) {
  // Endpoint Server-Sent Events (SSE) em tempo real
  fastify.get('/api/v1/notifications/stream', {
    preHandler: [fastify.requireAuth]
  }, (request, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    reply.raw.write(`data: ${JSON.stringify({ type: 'CONNECTED', message: 'Canal de notificações conectado' })}\n\n`);

    const onNotification = (data) => {
      // Filtrar se a notificação é para o usuário logado ou global
      if (!data.userId || data.userId === request.user.id) {
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      }
    };

    notificationEvents.on('notify', onNotification);

    request.raw.on('close', () => {
      notificationEvents.removeListener('notify', onNotification);
    });
  });
}
