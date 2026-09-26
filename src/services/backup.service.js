import path from 'path';
import fs from 'fs';
import { db } from '../../database/connection.js';

export const backupService = {
  async performBackup(targetDir = './database/backups') {
    const resolvedDir = path.resolve(process.cwd(), targetDir);
    if (!fs.existsSync(resolvedDir)) {
      fs.mkdirSync(resolvedDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFileName = `backup_bot_acess_${timestamp}.sqlite`;
    const backupFilePath = path.join(resolvedDir, backupFileName);

    // Online Backup API nativa do better-sqlite3 (cópia a quente e atômica)
    await db.backup(backupFilePath);
    const stats = fs.statSync(backupFilePath);

    // Rotação automática de backups mantendo os últimos mais recentes
    this.cleanupOldBackups(resolvedDir, 10);

    return {
      fileName: backupFileName,
      filePath: backupFilePath,
      sizeBytes: stats.size,
      createdAt: new Date().toISOString()
    };
  },

  /**
   * Remove backups antigos excedentes ao limite especificado para preservar espaço em disco
   */
  cleanupOldBackups(targetDir = './database/backups', maxKeep = 10) {
    try {
      const resolvedDir = path.resolve(process.cwd(), targetDir);
      if (!fs.existsSync(resolvedDir)) return [];

      const files = fs.readdirSync(resolvedDir)
        .filter(f => f.startsWith('backup_bot_acess_') && f.endsWith('.sqlite'))
        .map(f => ({
          name: f,
          fullPath: path.join(resolvedDir, f),
          time: fs.statSync(path.join(resolvedDir, f)).mtimeMs
        }))
        .sort((a, b) => b.time - a.time); // Do mais recente para o mais antigo

      const deleted = [];
      if (files.length > maxKeep) {
        const toDelete = files.slice(maxKeep);
        for (const file of toDelete) {
          try {
            fs.unlinkSync(file.fullPath);
            deleted.push(file.name);
          } catch (_) {}
        }
      }
      return deleted;
    } catch (_) {
      return [];
    }
  }
};

