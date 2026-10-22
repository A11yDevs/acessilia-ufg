import Fastify from 'fastify';
import path from 'path';
import { fileURLToPath } from 'url';

import fastifyCookie from '@fastify/cookie';
import fastifySession from '@fastify/session';
import fastifyView from '@fastify/view';
import fastifyStatic from '@fastify/static';
import fastifyFormbody from '@fastify/formbody';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyCsrf from '@fastify/csrf-protection';
import fastifyMultipart from '@fastify/multipart';
import ejs from 'ejs';

import { env } from './config/env.js';
import { SQLiteSessionStore } from './plugins/session-store.js';
import authPlugin from './plugins/auth.plugin.js';
import { authWebRoutes } from './routes/web/auth.routes.js';
import { dashboardWebRoutes } from './routes/web/dashboard.routes.js';
import { academicWebRoutes } from './routes/web/academic.routes.js';
import { materialsWebRoutes } from './routes/web/materials.routes.js';
import { reviewsWebRoutes } from './routes/web/reviews.routes.js';
import { usersWebRoutes } from './routes/web/users.routes.js';
import { auditWebRoutes } from './routes/web/audit.routes.js';
import { webhookApiRoutes } from './routes/api/webhook.api.js';
import { healthApiRoutes } from './routes/api/health.api.js';
import { notificationsApiRoutes } from './routes/api/notifications.api.js';
import { requestsWebRoutes } from './routes/web/requests.routes.js';
import { reportsWebRoutes } from './routes/web/reports.routes.js';
import { monitoringWebRoutes } from './routes/web/monitoring.routes.js';
import { preferencesApiRoutes } from './routes/api/preferences.api.js';
import { certificateWebRoutes } from './routes/web/certificate.routes.js';
import { ttsApiRoutes } from './routes/api/tts.api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function buildApp(opts = {}) {
  const fastify = Fastify({
    logger: env.NODE_ENV !== 'test',
    trustProxy: true,
    rewriteUrl: (req) => {
      // Normaliza URLs caso o proxy reverso Apache envie /gestor/ no início ou no meio
      if (req.url === '/gestor') {
        return '/';
      }
      if (req.url && req.url.startsWith('/gestor/')) {
        return req.url.slice(7);
      }
      if (req.url && req.url.includes('/gestor/')) {
        return req.url.replace(/\/gestor\//g, '/');
      }
      return req.url;
    },
    ...opts
  });

  // 1. Headers de Seguranca
  await fastify.register(fastifyHelmet, {
    contentSecurityPolicy: false
  });

  // 2. Parse de Formularios HTML e Multipart (Stream)
  await fastify.register(fastifyFormbody);
  await fastify.register(fastifyMultipart, {
    limits: {
      fileSize: 50 * 1024 * 1024 // 50MB
    },
    attachFieldsToBody: false // Permite consumo via stream nativo (req.file() ou req.parts())
  });

  // 3. Arquivos Estaticos
  await fastify.register(fastifyStatic, {
    root: path.resolve(__dirname, '../public'),
    prefix: '/public/'
  });

  // 4. Cookies e Sessoes Persistentes em SQLite
  await fastify.register(fastifyCookie, {
    secret: env.COOKIE_SECRET
  });

  // Determina se o cookie deve ter a flag secure
  // Em produção com HTTPS direto ou atrás de reverse proxy (Nginx/Traefik com X-Forwarded-Proto)
  const isCookieSecure = process.env.COOKIE_SECURE === 'true'
    ? true
    : (process.env.COOKIE_SECURE === 'false' ? false : 'auto');

  await fastify.register(fastifySession, {
    secret: env.SESSION_SECRET,
    cookie: {
      secure: isCookieSecure,
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000
    },
    store: new SQLiteSessionStore(),
    saveUninitialized: true
  });

  // 5. Protecao CSRF
  await fastify.register(fastifyCsrf, {
    sessionPlugin: '@fastify/session',
    getToken: (req) => req.body?._csrf || req.headers['csrf-token'] || req.headers['x-csrf-token']
  });

  // 6. Rate Limiting
  await fastify.register(fastifyRateLimit, {
    max: 100,
    timeWindow: '1 minute'
  });

  // 7. Renderizacao SSR Acessivel com EJS
  await fastify.register(fastifyView, {
    engine: {
      ejs
    },
    root: path.resolve(__dirname, 'views')
  });

  // 8. Plugins Customizados de RBAC e Autenticacao
  await fastify.register(authPlugin);

  // 9. Registro de Rotas Web e API Webhook
  await fastify.register(authWebRoutes);
  await fastify.register(dashboardWebRoutes);
  await fastify.register(academicWebRoutes);
  await fastify.register(materialsWebRoutes);
  await fastify.register(reviewsWebRoutes);
  await fastify.register(usersWebRoutes);
  await fastify.register(auditWebRoutes);
  await fastify.register(requestsWebRoutes);
  await fastify.register(reportsWebRoutes);
  await fastify.register(monitoringWebRoutes);
  await fastify.register(webhookApiRoutes);
  await fastify.register(healthApiRoutes);
  await fastify.register(notificationsApiRoutes);
  await fastify.register(preferencesApiRoutes);
  await fastify.register(certificateWebRoutes);
  await fastify.register(ttsApiRoutes);

  // 10. Tratamento Amigavel e Acessivel para 404 (Pagina Nao Encontrada)
  fastify.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/') || request.headers.accept?.includes('application/json')) {
      return reply.status(404).send({ error: 'Recurso nao encontrado', statusCode: 404 });
    }
    const user = request.session?.get('user') || null;
    return reply.status(404).view('auth/not-found.ejs', {
      title: 'Pagina Nao Encontrada',
      user,
      url: request.raw?.url || request.url
    });
  });

  return fastify;
}
