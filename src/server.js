import { buildApp } from './app.js';
import { env } from './config/env.js';

async function startServer() {
  try {
    const app = await buildApp();
    await app.listen({ port: env.PORT, host: env.HOST });
    console.log(`[ACESSILIA GESTOR] Servidor ativo em http://${env.HOST}:${env.PORT}`);
  } catch (err) {
    console.error('[SERVER ERROR] Falha ao iniciar aplicacao:', err);
    process.exit(1);
  }
}

startServer();
