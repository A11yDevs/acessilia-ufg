import { db } from '../../../database/connection.js';
import { materialService } from '../../services/material.service.js';
import { materialRepository } from '../../repositories/material.repository.js';

export async function reviewsWebRoutes(fastify, opts) {
  // Listagem de Revisões e Materiais Aguardando Análise Humana
  fastify.get('/revisoes', {
    preHandler: [fastify.requirePermission('revisoes.visualizar')]
  }, async (request, reply) => {
    // Materiais aguardando revisão ou já em revisão
    const pendingMaterials = db.prepare(`
      SELECT m.*, s.name as subject_name, u.name as teacher_name,
             (SELECT id FROM material_versions mv WHERE mv.material_id = m.id ORDER BY version_number DESC LIMIT 1) as latest_version_id,
             (SELECT version_number FROM material_versions mv WHERE mv.material_id = m.id ORDER BY version_number DESC LIMIT 1) as latest_version_number,
             (SELECT id FROM reviews r WHERE r.material_version_id = (SELECT id FROM material_versions mv WHERE mv.material_id = m.id ORDER BY version_number DESC LIMIT 1) AND r.status = 'EM_ANDAMENTO' ORDER BY r.id DESC LIMIT 1) as active_review_id,
             (SELECT reviewer_user_id FROM reviews r WHERE r.material_version_id = (SELECT id FROM material_versions mv WHERE mv.material_id = m.id ORDER BY version_number DESC LIMIT 1) AND r.status = 'EM_ANDAMENTO' ORDER BY r.id DESC LIMIT 1) as active_reviewer_id
      FROM materials m
      JOIN subjects s ON s.id = m.subject_id
      JOIN users u ON u.id = m.teacher_user_id
      WHERE m.current_status IN ('AGUARDANDO_REVISAO', 'EM_REVISAO', 'CORRECAO_SOLICITADA')
      ORDER BY m.updated_at DESC
    `).all();

    // Histórico de revisões concluídas recentemente
    const recentReviews = db.prepare(`
      SELECT r.*, m.title as material_title, u.name as reviewer_name,
             mv.version_number
      FROM reviews r
      JOIN material_versions mv ON mv.id = r.material_version_id
      JOIN materials m ON m.id = mv.material_id
      JOIN users u ON u.id = r.reviewer_user_id
      ORDER BY r.created_at DESC
      LIMIT 10
    `).all();

    const csrfToken = reply.generateCsrf();

    return reply.view('layouts/base.ejs', {
      title: 'Revisões de Acessibilidade',
      headerTitle: 'Revisão Técnica de Materiais',
      currentPath: '/revisoes',
      csrfToken,
      user: request.user,
      body: await fastify.view('reviews/index.ejs', {
        pendingMaterials,
        recentReviews,
        user: request.user,
        csrfToken
      })
    });
  });

  // Tela de Análise Comparativa Lado a Lado (Diff Humano)
  fastify.get('/revisoes/:id/analise', {
    preHandler: [fastify.requirePermission('revisoes.avaliar')]
  }, async (request, reply) => {
    const reviewId = parseInt(request.params.id, 10);
    const review = materialRepository.findReviewById(reviewId);
    if (!review) return reply.status(404).send('Revisão não encontrada');

    const version = materialRepository.findVersionById(review.material_version_id);
    const material = materialRepository.findMaterialById(version.material_id);
    const allVersions = materialRepository.getMaterialVersions(material.id);

    const originalVersion = allVersions.find(v => v.version_type === 'ORIGINAL') || allVersions[allVersions.length - 1];
    const accessibleVersion = allVersions.find(v => v.version_type !== 'ORIGINAL') || version;

    const csrfToken = reply.generateCsrf();

    return reply.view('layouts/base.ejs', {
      title: `Revisão: ${material.title}`,
      headerTitle: 'Análise Técnica Comparativa',
      currentPath: '/revisoes',
      csrfToken,
      user: request.user,
      body: await fastify.view('reviews/compare.ejs', {
        material,
        review,
        originalVersion,
        accessibleVersion,
        user: request.user,
        csrfToken
      })
    });
  });

  // Concluir Revisão (Aprovar / Reprovar / Solicitar Correção)
  fastify.post('/revisoes/:id/concluir', {
    preHandler: [fastify.requirePermission('revisoes.aprovar'), fastify.csrfProtection]
  }, async (request, reply) => {
    const reviewId = parseInt(request.params.id, 10);
    const { status, notes } = request.body || {};

    try {
      await materialService.finishReview(reviewId, status, { notes }, request.user);
      return reply.redirect('/revisoes');
    } catch (err) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // Iniciar Revisão de uma Versão
  fastify.post('/revisoes/iniciar', {
    preHandler: [fastify.requirePermission('revisoes.avaliar'), fastify.csrfProtection]
  }, async (request, reply) => {
    const { materialVersionId } = request.body || {};
    try {
      await materialService.startReview(parseInt(materialVersionId, 10), request.user);
      return reply.redirect('/revisoes');
    } catch (err) {
      return reply.status(400).send({ error: err.message });
    }
  });
}
