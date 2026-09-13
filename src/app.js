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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function buildApp(opts = {}) {
  const fastify = Fastify({
    logger: env.NODE_ENV !== 'test',
    trustProxy: true,
    ...opts
  });

  // 1. Headers de Seguranca
  await fastify.register(fastifyHelmet, {
    contentSecurityPolicy: false
  });

  // 2. Parse de Formularios HTML
  await fastify.register(fastifyFormbody);

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
  await fastify.register(webhookApiRoutes);
  await fastify.register(healthApiRoutes);
  await fastify.register(notificationsApiRoutes);

  return fastify;
}
