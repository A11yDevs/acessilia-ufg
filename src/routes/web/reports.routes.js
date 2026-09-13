import { db } from '../../../database/connection.js';

export async function reportsWebRoutes(fastify, opts) {
  // Exportar Auditoria em CSV
  fastify.get('/relatorios/auditoria.csv', {
    preHandler: [fastify.requirePermission('auditoria.visualizar')]
  }, async (request, reply) => {
    const logs = db.prepare(`
      SELECT a.id, a.created_at, u.name as user_name, u.email as user_email,
             a.action, a.resource, a.resource_id, a.ip_address, a.details_json
      FROM audit_logs a
      LEFT JOIN users u ON u.id = a.user_id
      ORDER BY a.created_at DESC
    `).all();

    let csv = 'ID,Data/Hora,Usuario,Email,Acao,Recurso,ID_Recurso,IP,Detalhes\n';
    for (const log of logs) {
      const details = (log.details_json || '').replace(/"/g, '""');
      csv += `${log.id},"${log.created_at}","${log.user_name || 'Sistema'}","${log.user_email || ''}","${log.action}","${log.resource}","${log.resource_id || ''}","${log.ip_address || ''}","${details}"\n`;
    }

    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', 'attachment; filename="relatorio_auditoria.csv"');
    return reply.send(csv);
  });

  // Exportar Métricas de Materiais e Acessibilidade em CSV
  fastify.get('/relatorios/materiais.csv', {
    preHandler: [fastify.requirePermission('materiais.visualizar')]
  }, async (request, reply) => {
    const materials = db.prepare(`
      SELECT m.id, m.created_at, m.title, s.name as subject_name, u.name as teacher_name,
             m.category, m.current_status,
             (SELECT COUNT(*) FROM material_versions mv WHERE mv.material_id = m.id) as total_versions
      FROM materials m
      JOIN subjects s ON s.id = m.subject_id
      JOIN users u ON u.id = m.teacher_user_id
      ORDER BY m.created_at DESC
    `).all();

    let csv = 'ID,Data_Cadastro,Titulo,Disciplina,Docente,Categoria,Status,Total_Versoes\n';
    for (const m of materials) {
      csv += `${m.id},"${m.created_at}","${m.title.replace(/"/g, '""')}","${m.subject_name}","${m.teacher_name}","${m.category}","${m.current_status}",${m.total_versions}\n`;
    }

    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', 'attachment; filename="relatorio_acessibilidade_materiais.csv"');
    return reply.send(csv);
  });
}
