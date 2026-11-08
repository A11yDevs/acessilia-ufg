import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

process.env.NODE_ENV = 'test';

// Isola o banco de dados de testes para nunca gravar no banco de produção.
// O node:test roda cada arquivo de teste em um processo próprio e em paralelo, e todos
// executam este setup: por isso cada processo recebe a sua cópia (sufixo = pid), em vez
// de todos sobrescreverem o mesmo arquivo enquanto outros já o usam.
const prodDb = path.resolve(process.cwd(), 'database/database.sqlite');
const testDb = path.join(os.tmpdir(), `acessilia-gestor-test-${process.pid}.sqlite`);
const testFiles = ['', '-wal', '-shm'].map((suffix) => testDb + suffix);

const removeTestFiles = () => {
  for (const file of testFiles) {
    try { fs.rmSync(file, { force: true }); } catch (_) {}
  }
};
// Descarta sobra de um processo antigo com o mesmo pid (VACUUM INTO exige destino vazio)
removeTestFiles();

if (fs.existsSync(prodDb)) {
  try {
    // VACUUM INTO gera um snapshot consistente, já incluindo o que está no -wal
    // (ex.: a última migração), sem checkpoint nem escrita no banco de origem.
    const source = new Database(prodDb, { fileMustExist: true });
    source.prepare('VACUUM INTO ?').run(testDb);
    source.close();
  } catch (err) {
    console.warn(`[TEST] Falha ao copiar o banco base para ${testDb}: ${err.message}`);
  }
}

// Apaga a cópia (com -wal/-shm) ao fim do processo
process.on('exit', removeTestFiles);

process.env.DATABASE_PATH = testDb;
