import { db } from '../../../database/connection.js';
import { hashPassword } from '../../utils/password.js';
import { auditRepository } from '../../repositories/audit.repository.js';

export async function usersWebRoutes(fastify, opts) {
  // Listagem de Usuários
  fastify.get('/usuarios', {
    preHandler: [fastify.requirePermission('usuarios.visualizar')]
  }, async (request, reply) => {
    const users = db.prepare(`
      SELECT u.*, r.name as role_name, r.code as role_code, r.id as role_id
      FROM users u
      LEFT JOIN user_roles ur ON ur.user_id = u.id AND ur.is_primary = 1
      LEFT JOIN roles r ON r.id = ur.role_id
      ORDER BY u.name ASC
    `).all();

    const roles = db.prepare('SELECT * FROM roles ORDER BY name ASC').all();
    const csrfToken = reply.generateCsrf();

    return reply.view('layouts/base.ejs', {
      title: 'Gestão de Usuários',
      headerTitle: 'Usuários do Sistema',
      currentPath: '/usuarios',
      csrfToken,
      user: request.user,
      body: await fastify.view('users/index.ejs', {
        users,
        roles,
        user: request.user,
        csrfToken
      })
    });
  });

  // Cadastro de Novo Usuário
  fastify.post('/usuarios', {
    preHandler: [fastify.requirePermission('usuarios.criar'), fastify.csrfProtection]
  }, async (request, reply) => {
    const { name, email, registrationNumber, roleId, password } = request.body || {};

    try {
      if (!name || !name.trim()) {
        throw new Error('O nome do usuário é obrigatório e não pode conter apenas espaços.');
      }
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        throw new Error('Formato de e-mail inválido.');
      }
      if (!roleId) {
        throw new Error('A função do usuário é obrigatória.');
      }
      const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.trim().toLowerCase());
      if (existing) {
        throw new Error('Já existe um usuário cadastrado com este e-mail.');
      }

      const role = db.prepare('SELECT id FROM roles WHERE id = ?').get(parseInt(roleId, 10));
      if (!role) {
        throw new Error('A função selecionada é inválida ou inexistente.');
      }

      const defaultPassword = password || 'Temp@123456';
      const passwordHash = await hashPassword(defaultPassword);

      let newUserId;
      const createUserTx = db.transaction(() => {
        const insertStmt = db.prepare(`
          INSERT INTO users (name, email, registration_number, password_hash, status)
          VALUES (?, ?, ?, ?, 'ACTIVE')
        `);
        const info = insertStmt.run(name.trim(), email.trim().toLowerCase(), registrationNumber ? registrationNumber.trim() : null, passwordHash);
        newUserId = info.lastInsertRowid;

        db.prepare(`
          INSERT INTO user_roles (user_id, role_id, is_primary)
          VALUES (?, ?, 1)
        `).run(newUserId, parseInt(roleId, 10));
      });

      createUserTx();

      auditRepository.createLog({
        userId: request.user.id,
        action: 'CRIAR_USUARIO',
        resource: 'users',
        resourceId: newUserId,
        details: { email, roleId }
      });

      return reply.redirect('/usuarios');
    } catch (err) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // Desativar / Reativar Usuário
  fastify.post('/usuarios/:id/status', {
    preHandler: [fastify.requirePermission('usuarios.desativar'), fastify.csrfProtection]
  }, async (request, reply) => {
    const targetUserId = parseInt(request.params.id, 10);
    const targetUser = db.prepare(`
      SELECT u.*, r.code as role_code
      FROM users u
      LEFT JOIN user_roles ur ON ur.user_id = u.id AND ur.is_primary = 1
      LEFT JOIN roles r ON r.id = ur.role_id
      WHERE u.id = ?
    `).get(targetUserId);

    if (!targetUser) return reply.status(404).send('Usuário não encontrado');

    // Proteção do último administrador
    if (targetUser.role_code === 'ADMINISTRADOR' && targetUser.status === 'ACTIVE') {
      const activeAdmins = db.prepare(`
        SELECT COUNT(DISTINCT u.id) as total
        FROM users u
        JOIN user_roles ur ON ur.user_id = u.id
        JOIN roles r ON r.id = ur.role_id
        WHERE r.code = 'ADMINISTRADOR' AND u.status = 'ACTIVE'
      `).get().total;

      if (activeAdmins <= 1) {
        return reply.status(400).send({ error: 'Operação impedida: O sistema não pode ficar sem nenhum administrador ativo.' });
      }
    }

    const newStatus = targetUser.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    db.prepare('UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newStatus, targetUserId);

    auditRepository.createLog({
      userId: request.user.id,
      action: newStatus === 'ACTIVE' ? 'REATIVAR_USUARIO' : 'DESATIVAR_USUARIO',
      resource: 'users',
      resourceId: targetUserId,
      details: { previousStatus: targetUser.status, newStatus }
    });

    return reply.redirect('/usuarios');
  });

  // Edição de Usuário e Redefinição de Senha
  fastify.post('/usuarios/:id', {
    preHandler: [fastify.requirePermission('usuarios.editar'), fastify.csrfProtection]
  }, async (request, reply) => {
    const targetUserId = parseInt(request.params.id, 10);
    const { name, email, registrationNumber, roleId, password } = request.body || {};

    try {
      const targetUser = db.prepare('SELECT * FROM users WHERE id = ?').get(targetUserId);
      if (!targetUser) return reply.status(404).send('Usuário não encontrado');

      if (!name || !name.trim()) {
        throw new Error('O nome do usuário é obrigatório.');
      }
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        throw new Error('Formato de e-mail inválido.');
      }

      // Verifica unicidade de e-mail em outro usuário
      const duplicateEmail = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email.trim().toLowerCase(), targetUserId);
      if (duplicateEmail) {
        throw new Error('Já existe outro usuário cadastrado com este e-mail.');
      }

      const role = roleId ? db.prepare('SELECT id FROM roles WHERE id = ?').get(parseInt(roleId, 10)) : null;

      let pwdHash = null;
      if (password && password.trim()) {
        pwdHash = await hashPassword(password.trim());
      }

      db.transaction(() => {
        if (pwdHash) {
          // Atualiza dados e redefinição de senha
          db.prepare(`
            UPDATE users
            SET name = ?, email = ?, registration_number = ?, password_hash = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(name.trim(), email.trim().toLowerCase(), registrationNumber ? registrationNumber.trim() : null, pwdHash, targetUserId);
        } else {
          // Apenas atualiza dados
          db.prepare(`
            UPDATE users
            SET name = ?, email = ?, registration_number = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(name.trim(), email.trim().toLowerCase(), registrationNumber ? registrationNumber.trim() : null, targetUserId);
        }

        if (role) {
          db.prepare(`
            UPDATE user_roles
            SET role_id = ?
            WHERE user_id = ? AND is_primary = 1
          `).run(role.id, targetUserId);
        }
      })();

      auditRepository.createLog({
        userId: request.user.id,
        action: 'EDITAR_USUARIO',
        resource: 'users',
        resourceId: targetUserId,
        details: { name: name.trim(), email: email.trim().toLowerCase(), roleId, passwordReset: Boolean(password && password.trim()) }
      });

      return reply.redirect('/usuarios');
    } catch (err) {
      return reply.status(400).send({ error: err.message });
    }
  });
}
