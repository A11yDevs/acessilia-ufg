import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

process.env.NODE_ENV = 'test';

// Isola o banco de dados de testes para nunca gravar no banco de produção
const prodDb = path.resolve(process.cwd(), 'database/database.sqlite');
const testDb = path.resolve(process.cwd(), 'database/test.sqlite');

if (fs.existsSync(prodDb)) {
  try {
    // O banco roda em modo WAL: mudanças recentes (ex.: a última migração) ficam no
    // arquivo -wal até um checkpoint. Sem isso a cópia sai sem elas.
    const source = new Database(prodDb);
    source.pragma('wal_checkpoint(TRUNCATE)');
    source.close();
    for (const suffix of ['-wal', '-shm']) fs.rmSync(testDb + suffix, { force: true });
    fs.copyFileSync(prodDb, testDb);
  } catch (_) {}
}
process.env.DATABASE_PATH = 'database/test.sqlite';
