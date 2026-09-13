import { authService } from '../../services/auth.service.js';

export async function authWebRoutes(fastify, opts) {
  // Tela de Login
  fastify.get('/login', async (request, reply) => {
    if (request.session.get('user')) {
      return reply.redirect('/dashboard');
    }

    const csrfToken = reply.generateCsrf();
    return reply.view('auth/login.ejs', {
      csrfToken,
      errorMessage: null,
      previousEmail: ''
    });
  });

  // Processamento do Login
  fastify.post('/login', {
    preHandler: fastify.csrfProtection
  }, async (request, reply) => {
    const { email, password } = request.body || {};
    const ipAddress = request.ip;
    const userAgent = request.headers['user-agent'];

    try {
      const user = await authService.authenticate(email, password, { ipAddress, userAgent });
      request.session.set('user', user);
      return reply.redirect('/dashboard');
    } catch (err) {
      const csrfToken = reply.generateCsrf();
      return reply.status(400).view('auth/login.ejs', {
        csrfToken,
        errorMessage: err.message,
        previousEmail: email || ''
      });
    }
  });

  // Logout
  fastify.post('/logout', {
    preHandler: [fastify.requireAuth, fastify.csrfProtection]
  }, async (request, reply) => {
    await request.session.destroy();
    return reply.redirect('/login');
  });
}
