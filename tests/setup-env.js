import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

process.env.NODE_ENV = 'test';

// Isola o banco de dados de testes para nunca gravar no banco de produção.
// O node:test roda cada arquivo de teste em um processo próprio e em paralelo, e todos
// executam este setup: por isso cada processo recebe a sua cópia, em vez de todos
// sobrescreverem o mesmo arquivo enquanto outros já o usam.
const prodDb = path.resolve(process.cwd(), 'database/database.sqlite');

// Diretório exclusivo do processo, criado com permissão 0700: a cópia tem os dados e os
// hashes de senha do banco local e não pode ficar legível para outros usuários em um /tmp
// compartilhado. O SQLite cria a cópia e os -wal/-shm dentro dele.
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acessilia-gestor-test-'));
const testDb = path.join(testDir, 'test.sqlite');

const removeTestDir = () => {
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch (_) {}
};
// Apaga a cópia (com -wal/-shm) ao fim do processo
process.on('exit', removeTestDir);

if (fs.existsSync(prodDb)) {
  let source;
  try {
    // VACUUM INTO gera um snapshot consistente, já incluindo o que está no -wal
    // (ex.: a última migração). A conexão é somente leitura: sem ela, fechar a última
    // conexão faria o checkpoint automático do WAL e alteraria o banco de origem.
    source = new Database(prodDb, { fileMustExist: true, readonly: true });
    source.prepare('VACUUM INTO ?').run(testDb);
  } catch (err) {
    removeTestDir();
    // Sem a cópia, os testes rodariam num banco vazio com erros difíceis de entender:
    // melhor interromper aqui com a causa.
    throw new Error(`[TEST] Falha ao copiar o banco base ${prodDb} para ${testDb}: ${err.message}`, { cause: err });
  } finally {
    source?.close();
  }
}

process.env.DATABASE_PATH = testDb;
