import { db } from '../../../database/connection.js';
import { auditRepository } from '../../repositories/audit.repository.js';
import { notificationEvents } from '../api/notifications.api.js';

export async function requestsWebRoutes(fastify, opts) {
  // Listagem de Solicitações
  fastify.get('/solicitacoes', {
    preHandler: [fastify.requireAuth]
  }, async (request, reply) => {
    const user = request.user;
    let requestsList = [];

    if (user.roleCode === 'ALUNO') {
      requestsList = db.prepare(`
        SELECT ar.*, m.title as material_title, s.name as subject_name
        FROM accessibility_requests ar
        JOIN materials m ON m.id = ar.material_id
        JOIN subjects s ON s.id = m.subject_id
        WHERE ar.requester_user_id = ?
        ORDER BY ar.created_at DESC
      `).all(user.id);
    } else {
      // Professores, Revisores e Administradores veem as solicitações pendentes
      requestsList = db.prepare(`
        SELECT ar.*, m.title as material_title, s.name as subject_name, u.name as requester_name
        FROM accessibility_requests ar
        JOIN materials m ON m.id = ar.material_id
        JOIN subjects s ON s.id = m.subject_id
        JOIN users u ON u.id = ar.requester_user_id
        ORDER BY ar.created_at DESC
      `).all();
    }

    // Lista de materiais disponíveis para solicitar acessibilidade
    const availableMaterials = db.prepare('SELECT id, title FROM materials ORDER BY title ASC').all();
    const csrfToken = reply.generateCsrf();

    return reply.view('layouts/base.ejs', {
      title: 'Solicitações de Acessibilidade',
      headerTitle: 'Demandas e Solicitações de Acessibilidade',
      currentPath: '/solicitacoes',
      csrfToken,
      user,
      body: await fastify.view('requests/index.ejs', {
        requestsList,
        availableMaterials,
        user,
        csrfToken
      })
    });
  });

  // Criar Solicitação de Acessibilidade
  fastify.post('/solicitacoes', {
    preHandler: [fastify.requireAuth, fastify.csrfProtection]
  }, async (request, reply) => {
    const { materialId, priority, specificNotes } = request.body || {};

    if (!materialId) {
      return reply.status(400).send({ error: 'Material é obrigatório' });
    }

    const stmt = db.prepare(`
      INSERT INTO accessibility_requests (material_id, requester_user_id, priority, status, specific_notes)
      VALUES (?, ?, ?, 'SOLICITADA', ?)
    `);
    const info = stmt.run(parseInt(materialId, 10), request.user.id, priority || 'NORMAL', specificNotes || null);

    auditRepository.createLog({
      userId: request.user.id,
      action: 'CRIAR_SOLICITACAO_ACESSIBILIDADE',
      resource: 'accessibility_requests',
      resourceId: info.lastInsertRowid,
      details: { materialId, priority }
    });

    // Disparar notificação em tempo real para revisores e docentes
    notificationEvents.emit('notify', {
      type: 'NOVA_SOLICITACAO',
      title: 'Nova Solicitação de Acessibilidade',
      message: `Uma nova demanda foi registrada com prioridade ${priority || 'NORMAL'}.`,
      targetUrl: '/solicitacoes'
    });

    return reply.redirect('/solicitacoes');
  });

  // Atualizar Status da Solicitação
  fastify.post('/solicitacoes/:id/status', {
    preHandler: [fastify.requirePermission('solicitacoes.gerenciar'), fastify.csrfProtection]
  }, async (request, reply) => {
    const requestId = parseInt(request.params.id, 10);
    const { status } = request.body || {};

    db.prepare(`
      UPDATE accessibility_requests
      SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, requestId);

    const reqData = db.prepare('SELECT requester_user_id FROM accessibility_requests WHERE id = ?').get(requestId);
    if (reqData) {
      notificationEvents.emit('notify', {
        userId: reqData.requester_user_id,
        type: 'STATUS_SOLICITACAO',
        title: 'Status de Solicitação Atualizado',
        message: `Sua solicitação de acessibilidade foi alterada para "${status}".`,
        targetUrl: '/solicitacoes'
      });
    }

    return reply.redirect('/solicitacoes');
  });
}
