import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from './connection.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function runMigrations() {
  console.log('[MIGRATE] Iniciando execucao de migracoes SQLite...');

  // Tabela de controle de migracoes
  db.exec(`
    CREATE TABLE IF NOT EXISTS _schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL UNIQUE,
      executed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const migrationsDir = path.resolve(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

  const executed = new Set(
    db.prepare('SELECT filename FROM _schema_migrations').all().map(r => r.filename)
  );

  let runCount = 0;
  for (const file of files) {
    if (!executed.has(file)) {
      console.log(`[MIGRATE] Executando migracao: ${file}`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

      // Executa de forma atomica
      const runTx = db.transaction(() => {
        db.exec(sql);
        db.prepare('INSERT INTO _schema_migrations (filename) VALUES (?)').run(file);
      });

      runTx();
      runCount++;
      console.log(`[MIGRATE] Migracao ${file} executada com sucesso.`);
    }
  }

  if (runCount === 0) {
    console.log('[MIGRATE] Nenhuma nova migracao pendente.');
  } else {
    console.log(`[MIGRATE] Total de ${runCount} migracao(oes) executada(s).`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    runMigrations();
    process.exit(0);
  } catch (error) {
    console.error('[MIGRATE ERROR] Falha ao executar migracoes:', error);
    process.exit(1);
  }
}
