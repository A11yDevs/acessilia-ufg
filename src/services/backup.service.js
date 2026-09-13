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

    return {
      fileName: backupFileName,
      filePath: backupFilePath,
      sizeBytes: stats.size,
      createdAt: new Date().toISOString()
    };
  }
};
