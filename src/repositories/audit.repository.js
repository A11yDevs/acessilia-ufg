import { db } from '../../database/connection.js';

export const auditRepository = {
  createLog({ userId, action, resource, resourceId = null, ipAddress = null, userAgent = null, details = null }) {
    const stmt = db.prepare(`
      INSERT INTO audit_logs (user_id, action, resource, resource_id, ip_address, user_agent, details_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const detailsJson = details ? JSON.stringify(details) : null;
    return stmt.run(userId, action, resource, resourceId ? String(resourceId) : null, ipAddress, userAgent, detailsJson);
  },

  getRecentLogs(limit = 10) {
    const stmt = db.prepare(`
      SELECT a.*, u.name as user_name, u.email as user_email
      FROM audit_logs a
      LEFT JOIN users u ON u.id = a.user_id
      ORDER BY a.created_at DESC
      LIMIT ?
    `);
    return stmt.all(limit);
  }
};
