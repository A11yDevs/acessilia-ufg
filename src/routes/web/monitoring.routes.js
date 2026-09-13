import { botAcessClient } from '../../integrations/bot-acess/client.js';
import { db } from '../../../database/connection.js';
import { backupService } from '../../services/backup.service.js';
import fs from 'fs';
import path from 'path';

export async function monitoringWebRoutes(fastify) {
  fastify.get('/monitoramento', {
    preHandler: [fastify.requirePermission('auditoria.visualizar')]
  }, async (req, reply) => {
    const engineHealth = await botAcessClient.checkHealth();

    const totalMaterials = db.prepare('SELECT COUNT(*) as count FROM materials').get()?.count || 0;
    const totalConversions = db.prepare('SELECT COUNT(*) as count FROM conversion_jobs').get()?.count || 0;
    const queuedJobs = db.prepare("SELECT COUNT(*) as count FROM conversion_jobs WHERE status = 'QUEUED'").get()?.count || 0;
    const processingJobs = db.prepare("SELECT COUNT(*) as count FROM conversion_jobs WHERE status = 'PROCESSING'").get()?.count || 0;
    const failedJobs = db.prepare("SELECT COUNT(*) as count FROM conversion_jobs WHERE status = 'FAILED'").get()?.count || 0;
    const completedJobs = db.prepare("SELECT COUNT(*) as count FROM conversion_jobs WHERE status = 'COMPLETED'").get()?.count || 0;

    let dbSizeBytes = 0;
    try {
      const dbPath = path.resolve(process.cwd(), './database/database.sqlite');
      if (fs.existsSync(dbPath)) {
        dbSizeBytes = fs.statSync(dbPath).size;
      }
    } catch (_) {}

    let backups = [];
    try {
      const backupDir = path.resolve(process.cwd(), './database/backups');
      if (fs.existsSync(backupDir)) {
        backups = fs.readdirSync(backupDir)
          .filter(f => f.endsWith('.sqlite'))
          .map(f => {
            const stat = fs.statSync(path.join(backupDir, f));
            return {
              name: f,
              size: (stat.size / (1024 * 1024)).toFixed(2) + ' MB',
              created: stat.mtime
            };
          })
          .sort((a, b) => b.created - a.created)
          .slice(0, 5);
      }
    } catch (_) {}

    return reply.view('layouts/base.ejs', {
      title: 'Monitoramento do Motor Acessilia',
      headerTitle: 'Monitoramento do Motor Acessilia',
      currentPath: '/monitoramento',
      csrfToken: reply.generateCsrf(),
      user: req.user,
      body: await fastify.view('monitoring/index.ejs', {
        user: req.user,
        engineHealth,
        engineUrl: botAcessClient.baseUrl,
        stats: {
          totalMaterials,
          totalConversions,
          queuedJobs,
          processingJobs,
          failedJobs,
          completedJobs,
          dbSizeMb: (dbSizeBytes / (1024 * 1024)).toFixed(2)
        },
        backups,
        csrfToken: reply.generateCsrf()
      })
    });
  });

  fastify.post('/monitoramento/backup', {
    preHandler: [fastify.requirePermission('auditoria.visualizar')]
  }, async (req, reply) => {
    try {
      const backup = await backupService.performBackup();
      req.session.set('flash', { success: 'Backup a quente criado com sucesso: ' + backup.fileName });
    } catch (err) {
      req.session.set('flash', { error: 'Erro ao realizar backup: ' + err.message });
    }
    return reply.redirect('/monitoramento');
  });
}
