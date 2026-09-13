import { userRepository } from '../repositories/user.repository.js';
import { auditRepository } from '../repositories/audit.repository.js';
import { verifyPassword } from '../utils/password.js';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

export const authService = {
  async authenticate(email, password, { ipAddress = null, userAgent = null } = {}) {
    if (!email || !password) {
      throw new Error('Email e senha sao obrigatorios.');
    }

    const user = userRepository.findByEmail(email.trim());
    if (!user) {
      // Previne timing attacks com verificacao fake se necessario
      auditRepository.createLog({
        userId: null,
        action: 'LOGIN_FAILED_UNKNOWN_USER',
        resource: 'auth',
        ipAddress,
        userAgent,
        details: { attemptedEmail: email.trim() }
      });
      throw new Error('Credenciais invalidas.');
    }

    // Verificar se usuario esta bloqueado por status
    if (user.status !== 'ACTIVE') {
      auditRepository.createLog({
        userId: user.id,
        action: 'LOGIN_BLOCKED_STATUS',
        resource: 'auth',
        ipAddress,
        userAgent,
        details: { status: user.status }
      });
      throw new Error(`Sua conta esta com status "${user.status}". Procure o administrador.`);
    }

    // Verificar bloqueio temporario por forca bruta
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const waitMinutes = Math.ceil((new Date(user.locked_until) - new Date()) / (1000 * 60));
      auditRepository.createLog({
        userId: user.id,
        action: 'LOGIN_LOCKED_ATTEMPTS',
        resource: 'auth',
        ipAddress,
        userAgent,
        details: { lockedUntil: user.locked_until }
      });
      throw new Error(`Conta temporariamente bloqueada devido a tentativas excessivas. Tente novamente em ${waitMinutes} minutos.`);
    }

    // Validar senha com Argon2id
    const isPasswordValid = await verifyPassword(user.password_hash, password);

    if (!isPasswordValid) {
      const newAttempts = (user.failed_login_attempts || 0) + 1;
      let lockDateStr = null;

      if (newAttempts >= MAX_FAILED_ATTEMPTS) {
        const lockDate = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000);
        lockDateStr = lockDate.toISOString();
      }

      userRepository.incrementFailedAttempts(user.id, lockDateStr);

      auditRepository.createLog({
        userId: user.id,
        action: 'LOGIN_FAILED_PASSWORD',
        resource: 'auth',
        ipAddress,
        userAgent,
        details: { attempt: newAttempts, locked: Boolean(lockDateStr) }
      });

      if (lockDateStr) {
        throw new Error(`Limite de tentativas atingido. Conta bloqueada temporariamente por ${LOCKOUT_MINUTES} minutos.`);
      }

      throw new Error('Credenciais invalidas.');
    }

    // Sucesso no login
    userRepository.updateLoginSuccess(user.id);
    const permissions = userRepository.getUserPermissions(user.id);

    auditRepository.createLog({
      userId: user.id,
      action: 'LOGIN_SUCCESS',
      resource: 'auth',
      ipAddress,
      userAgent
    });

    return {
      id: user.id,
      name: user.name,
      socialName: user.social_name,
      email: user.email,
      registrationNumber: user.registration_number,
      roleCode: user.role_code,
      roleName: user.role_name,
      permissions
    };
  }
};
