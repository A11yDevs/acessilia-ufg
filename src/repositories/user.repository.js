import { db } from '../../database/connection.js';

export const userRepository = {
  findByEmail(email) {
    const stmt = db.prepare(`
      SELECT u.*, r.code as role_code, r.name as role_name
      FROM users u
      LEFT JOIN user_roles ur ON ur.user_id = u.id AND ur.is_primary = 1
      LEFT JOIN roles r ON r.id = ur.role_id
      WHERE LOWER(u.email) = LOWER(?)
    `);
    return stmt.get(email);
  },

  findById(id) {
    const stmt = db.prepare(`
      SELECT u.id, u.name, u.social_name, u.email, u.registration_number,
             u.phone, u.status, u.failed_login_attempts, u.locked_until,
             u.last_login_at, u.created_at, u.updated_at,
             r.code as role_code, r.name as role_name
      FROM users u
      LEFT JOIN user_roles ur ON ur.user_id = u.id AND ur.is_primary = 1
      LEFT JOIN roles r ON r.id = ur.role_id
      WHERE u.id = ?
    `);
    return stmt.get(id);
  },

  getUserPermissions(userId) {
    const stmt = db.prepare(`
      SELECT DISTINCT p.code
      FROM permissions p
      JOIN role_permissions rp ON rp.permission_id = p.id
      JOIN user_roles ur ON ur.role_id = rp.role_id
      WHERE ur.user_id = ?
    `);
    const rows = stmt.all(userId);
    return rows.map(r => r.code);
  },

  updateLoginSuccess(userId) {
    const stmt = db.prepare(`
      UPDATE users
      SET failed_login_attempts = 0,
          locked_until = NULL,
          last_login_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    return stmt.run(userId);
  },

  incrementFailedAttempts(userId, lockUntil = null) {
    const stmt = db.prepare(`
      UPDATE users
      SET failed_login_attempts = failed_login_attempts + 1,
          locked_until = COALESCE(?, locked_until),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    return stmt.run(lockUntil, userId);
  },

  countActiveAdmins() {
    const stmt = db.prepare(`
      SELECT COUNT(DISTINCT u.id) as total
      FROM users u
      JOIN user_roles ur ON ur.user_id = u.id
      JOIN roles r ON r.id = ur.role_id
      WHERE r.code = 'ADMINISTRADOR' AND u.status = 'ACTIVE'
    `);
    const result = stmt.get();
    return result ? result.total : 0;
  }
};
