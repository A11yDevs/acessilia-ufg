import fp from 'fastify-plugin';

async function authPlugin(fastify, opts) {
  // Decorador para verificar autenticacao ativa
  fastify.decorate('requireAuth', async (request, reply) => {
    const user = request.session?.get('user');
    if (!user) {
      if (request.url.startsWith('/api/')) {
        return reply.status(401).send({ error: 'Nao autenticado' });
      }
      return reply.redirect('/login');
    }
    request.user = user;
  });

  // Decorador para verificar permissao RBAC granular
  fastify.decorate('requirePermission', (permissionCode) => {
    return async (request, reply) => {
      const user = request.session?.get('user');
      if (!user) {
        if (request.url.startsWith('/api/')) {
          return reply.status(401).send({ error: 'Nao autenticado' });
        }
        return reply.redirect('/login');
      }

      request.user = user;
      const userPerms = user.permissions || [];

      // Administrador tem bypass total
      if (user.roleCode === 'ADMINISTRADOR' || userPerms.includes(permissionCode)) {
        return;
      }

      if (request.url.startsWith('/api/')) {
        return reply.status(403).send({ error: 'Acesso negado: permissao insuficiente' });
      }
      return reply.status(403).view('auth/forbidden.ejs', {
        title: 'Acesso Proibido',
        requiredPermission: permissionCode,
        user
      });
    };
  });
}

export default fp(authPlugin);
