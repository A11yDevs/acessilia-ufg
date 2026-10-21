import fs from 'node:fs';
import path from 'node:path';

process.env.NODE_ENV = 'test';

// Isola o banco de dados de testes para nunca gravar no banco de produção
const prodDb = path.resolve(process.cwd(), 'database/database.sqlite');
const testDb = path.resolve(process.cwd(), 'database/test.sqlite');

if (fs.existsSync(prodDb)) {
  try {
    fs.copyFileSync(prodDb, testDb);
  } catch (_) {}
}
process.env.DATABASE_PATH = 'database/test.sqlite';
