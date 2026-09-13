import { db } from '../../../database/connection.js';
import { auditRepository } from '../../repositories/audit.repository.js';

export async function dashboardWebRoutes(fastify, opts) {
  fastify.get('/dashboard', {
    preHandler: [fastify.requireAuth]
  }, async (request, reply) => {
    const user = request.user;
    const csrfToken = reply.generateCsrf();

    let stats = {};
    if (user.roleCode === 'ADMINISTRADOR') {
      const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
      const totalCourses = db.prepare('SELECT COUNT(*) as count FROM courses').get().count;
      const totalMaterials = db.prepare('SELECT COUNT(*) as count FROM materials').get().count;
      const approvedMaterials = db.prepare("SELECT COUNT(*) as count FROM materials WHERE current_status = 'APROVADO'").get().count;
      stats = { totalUsers, totalCourses, totalMaterials, approvedMaterials };
    } else if (user.roleCode === 'PROFESSOR') {
      const myMaterials = db.prepare('SELECT COUNT(*) as count FROM materials WHERE teacher_user_id = ?').get(user.id).count;
      const myApprovedMaterials = db.prepare("SELECT COUNT(*) as count FROM materials WHERE teacher_user_id = ? AND current_status = 'APROVADO'").get(user.id).count;
      const pendingJobs = db.prepare("SELECT COUNT(*) as count FROM materials WHERE teacher_user_id = ? AND current_status = 'AGUARDANDO_PROCESSAMENTO'").get(user.id).count;
      stats = { myMaterials, myApprovedMaterials, pendingJobs };
    } else if (user.roleCode === 'REVISOR') {
      const pendingReviews = db.prepare("SELECT COUNT(*) as count FROM materials WHERE current_status = 'AGUARDANDO_REVISAO'").get().count;
      const inProgressReviews = db.prepare("SELECT COUNT(*) as count FROM reviews WHERE reviewer_user_id = ? AND status = 'EM_ANDAMENTO'").get(user.id).count;
      stats = { pendingReviews, inProgressReviews };
    } else {
      // ALUNO
      const myRequests = db.prepare('SELECT COUNT(*) as count FROM accessibility_requests WHERE requester_user_id = ?').get(user.id).count;
      const availableMaterials = db.prepare("SELECT COUNT(*) as count FROM materials WHERE current_status = 'PUBLICADO' OR current_status = 'APROVADO'").get().count;
      stats = { myRequests, availableMaterials };
    }

    const recentLogs = user.roleCode === 'ADMINISTRADOR' ? auditRepository.getRecentLogs(8) : [];

    return reply.view('layouts/base.ejs', {
      title: 'Dashboard',
      headerTitle: 'Visão Geral do Sistema',
      currentPath: '/dashboard',
      csrfToken,
      user,
      body: await fastify.view('dashboard/index.ejs', {
        user,
        stats,
        recentLogs
      })
    });
  });

  fastify.get('/', async (request, reply) => {
    if (request.session.get('user')) {
      return reply.redirect('/dashboard');
    }
    return reply.redirect('/login');
  });
}
