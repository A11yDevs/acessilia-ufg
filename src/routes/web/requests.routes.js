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

    // Lista de materiais disponíveis para solicitar acessibilidade (respeita escopo do aluno - B10)
    let availableMaterials = [];
    if (user.roleCode === 'ALUNO') {
      availableMaterials = db.prepare(`
        SELECT DISTINCT m.id, m.title
        FROM materials m
        JOIN class_students cs ON cs.class_id = m.class_id
        WHERE cs.student_user_id = ? AND cs.status = 'MATRICULADO'
        ORDER BY m.title ASC
      `).all(user.id);
    } else {
      availableMaterials = db.prepare('SELECT id, title FROM materials ORDER BY title ASC').all();
    }
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
      return reply.status(400).send({ error: 'Material é obrigatório.' });
    }

    const matId = parseInt(materialId, 10);
    if (isNaN(matId)) {
      return reply.status(400).send({ error: 'Identificador de material inválido.' });
    }

    const mat = db.prepare('SELECT id FROM materials WHERE id = ?').get(matId);
    if (!mat) {
      return reply.status(404).send({ error: 'Material selecionado não foi encontrado.' });
    }

    const validPriorities = ['BAIXA', 'NORMAL', 'ALTA', 'URGENTE'];
    const p = (priority || 'NORMAL').toUpperCase();
    if (!validPriorities.includes(p)) {
      return reply.status(400).send({ error: `Prioridade inválida (${priority}). Permitidas: ${validPriorities.join(', ')}.` });
    }

    // Previne solicitações idênticas em andamento (B3)
    const existingReq = db.prepare(`
      SELECT id FROM accessibility_requests
      WHERE material_id = ? AND requester_user_id = ? AND status IN ('SOLICITADA', 'EM_ATENDIMENTO', 'PROCESSANDO', 'EM_REVISAO')
    `).get(matId, request.user.id);
    if (existingReq) {
      return reply.redirect('/solicitacoes');
    }

    const stmt = db.prepare(`
      INSERT INTO accessibility_requests (material_id, requester_user_id, priority, status, specific_notes)
      VALUES (?, ?, ?, 'SOLICITADA', ?)
    `);
    const info = stmt.run(matId, request.user.id, p, specificNotes || null);

    auditRepository.createLog({
      userId: request.user.id,
      action: 'CRIAR_SOLICITACAO_ACESSIBILIDADE',
      resource: 'accessibility_requests',
      resourceId: info.lastInsertRowid,
      details: { materialId: matId, priority: p }
    });

    // Disparar notificação em tempo real para revisores e docentes
    notificationEvents.emit('notify', {
      type: 'NOVA_SOLICITACAO',
      title: 'Nova Solicitação de Acessibilidade',
      message: `Uma nova demanda foi registrada com prioridade ${p}.`,
      targetUrl: '/solicitacoes'
    });

    return reply.redirect('/solicitacoes');
  });

  // Atualizar Status da Solicitação
  fastify.post('/solicitacoes/:id/status', {
    preHandler: [fastify.requirePermission('solicitacoes.gerenciar'), fastify.csrfProtection]
  }, async (request, reply) => {
    const requestId = parseInt(request.params.id, 10);
    if (isNaN(requestId)) {
      return reply.status(400).send({ error: 'ID de solicitação inválido.' });
    }

    const reqData = db.prepare('SELECT * FROM accessibility_requests WHERE id = ?').get(requestId);
    if (!reqData) {
      return reply.status(404).send({ error: 'Solicitação não encontrada.' });
    }

    const { status } = request.body || {};
    const validStatuses = ['SOLICITADA', 'EM_ATENDIMENTO', 'PROCESSANDO', 'EM_REVISAO', 'CONCLUIDA', 'CANCELADA'];
    if (!status || !validStatuses.includes(status.toUpperCase())) {
      return reply.status(400).send({ error: `Status inválido ou vazio. Permitidos: ${validStatuses.join(', ')}.` });
    }

    const normStatus = status.toUpperCase();
    db.prepare(`
      UPDATE accessibility_requests
      SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(normStatus, requestId);

    notificationEvents.emit('notify', {
      userId: reqData.requester_user_id,
      type: 'STATUS_SOLICITACAO',
      title: 'Status de Solicitação Atualizado',
      message: `Sua solicitação de acessibilidade foi alterada para "${normStatus}".`,
      targetUrl: '/solicitacoes'
    });

    return reply.redirect('/solicitacoes');
  });
}
