import { db } from '../../../database/connection.js';

export async function auditWebRoutes(fastify, opts) {
  fastify.get('/auditoria', {
    preHandler: [fastify.requirePermission('auditoria.visualizar')]
  }, async (request, reply) => {
    const logs = db.prepare(`
      SELECT a.*, u.name as user_name, u.email as user_email
      FROM audit_logs a
      LEFT JOIN users u ON u.id = a.user_id
      ORDER BY a.created_at DESC
      LIMIT 100
    `).all();

    const csrfToken = reply.generateCsrf();

    return reply.view('layouts/base.ejs', {
      title: 'Logs de Auditoria e Segurança',
      headerTitle: 'Trilha de Auditoria Institucional',
      currentPath: '/auditoria',
      csrfToken,
      user: request.user,
      body: await fastify.view('audit/index.ejs', {
        logs,
        user: request.user
      })
    });
  });
}
