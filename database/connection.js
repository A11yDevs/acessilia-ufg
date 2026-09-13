import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { env } from '../src/config/env.js';

const dbPath = path.resolve(process.cwd(), env.DATABASE_PATH);
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export function createDbConnection(filePath = dbPath) {
  const db = new Database(filePath);
  
  // Pragmas essenciais de integridade e desempenho
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');

  return db;
}

export const db = createDbConnection();
