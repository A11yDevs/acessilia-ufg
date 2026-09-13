import fs from 'fs';
import path from 'path';
import { db } from '../../../database/connection.js';
import { env } from '../../config/env.js';

export async function healthApiRoutes(fastify, opts) {
  fastify.get('/healthz', async (request, reply) => {
    let dbStatus = 'healthy';
    let dbError = null;

    try {
      db.prepare('SELECT 1').get();
    } catch (err) {
      dbStatus = 'unhealthy';
      dbError = err.message;
    }

    const dbPath = path.resolve(process.cwd(), env.DATABASE_PATH);
    let dbSizeBytes = 0;
    if (fs.existsSync(dbPath)) {
      dbSizeBytes = fs.statSync(dbPath).size;
    }

    const botAcessHealth = await (await import('../../integrations/bot-acess/client.js')).botAcessClient.checkHealth();

    const status = dbStatus === 'healthy' ? 200 : 503;
    return reply.status(status).send({
      status: dbStatus === 'healthy' ? 'OK' : 'DEGRADED',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      database: {
        status: dbStatus,
        sizeBytes: dbSizeBytes,
        error: dbError
      },
      acessiliaEngine: {
        configuredUrl: env.BOT_ACESS_API_URL,
        status: botAcessHealth.online ? 'CONNECTED' : 'OFFLINE',
        details: botAcessHealth
      }
    });
  });
}
