import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// O setup roda em processos filhos com um banco base sintético, para não depender do banco local.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const setupUrl = pathToFileURL(path.join(repoRoot, 'tests', 'setup-env.js')).href;
const repoPackage = path.join(repoRoot, 'package.json');

const runNode = (cwd, args) => spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });
const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// Abre o banco com o better-sqlite3 do projeto a partir de um processo filho (código CommonJS do -e).
const withDb = (body) => `
  const Database = require('node:module').createRequire(${JSON.stringify(repoPackage)})('better-sqlite3');
  ${body}`;

describe('tests/setup-env.js: cópia isolada do banco base', () => {
  let workDir;
  let sourceDb;

  before(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-env-test-'));
    fs.mkdirSync(path.join(workDir, 'database'));
    sourceDb = path.join(workDir, 'database', 'database.sqlite');
    // Grava uma linha confirmada só no -wal e morre sem fechar a conexão (sem checkpoint),
    // como um servidor de desenvolvimento interrompido.
    const writer = runNode(workDir, ['-e', withDb(`
      const db = new Database(${JSON.stringify(sourceDb)});
      db.pragma('journal_mode = WAL');
      db.pragma('wal_autocheckpoint = 0');
      db.exec("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('so-no-wal')");
      process.kill(process.pid, 'SIGKILL');
    `)]);
    // No Windows, SIGKILL encerra via TerminateProcess com status 1; em POSIX, status é null e signal é SIGKILL.
    assert.ok(writer.status === null || writer.status === 1, writer.stderr);
    assert.ok(fs.existsSync(`${sourceDb}-wal`), 'o -wal pendente deve existir antes do setup');
  });

  after(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  test('snapshot traz o que está no -wal sem alterar o banco de origem', () => {
    const sourceHash = sha256(sourceDb);
    const walHash = sha256(`${sourceDb}-wal`);

    const child = runNode(workDir, ['--import', setupUrl, '-e', withDb(`
      const db = new Database(process.env.DATABASE_PATH, { readonly: true });
      const row = db.prepare('SELECT v FROM t').get();
      const integrity = db.pragma('integrity_check', { simple: true });
      db.close();
      const dir = require('node:path').dirname(process.env.DATABASE_PATH);
      console.log(JSON.stringify({ path: process.env.DATABASE_PATH, row, integrity,
        dirMode: require('node:fs').statSync(dir).mode & 0o777 }));
    `)]);
    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout.trim());

    assert.deepEqual(result.row, { v: 'so-no-wal' });
    assert.equal(result.integrity, 'ok');
    assert.equal(sha256(sourceDb), sourceHash, 'o arquivo de origem não pode mudar');
    assert.ok(fs.existsSync(`${sourceDb}-wal`), 'o -wal da origem não pode ser removido');
    assert.equal(sha256(`${sourceDb}-wal`), walHash);
    if (process.platform !== 'win32') {
      assert.equal(result.dirMode, 0o700, 'a cópia fica em diretório privado');
    }
    assert.equal(fs.existsSync(path.dirname(result.path)), false, 'a cópia é apagada no fim do processo');
  });

  test('cada processo recebe a sua própria cópia', () => {
    const paths = [1, 2].map(() => {
      const child = runNode(workDir, ['--import', setupUrl, '-e', 'console.log(process.env.DATABASE_PATH)']);
      assert.equal(child.status, 0, child.stderr);
      return child.stdout.trim();
    });
    assert.notEqual(paths[0], paths[1]);
  });

  test('falha ao copiar o banco base interrompe o processo em vez de seguir com banco vazio', () => {
    const brokenDir = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-env-broken-'));
    try {
      fs.mkdirSync(path.join(brokenDir, 'database'));
      fs.writeFileSync(path.join(brokenDir, 'database', 'database.sqlite'), 'isto não é um banco SQLite');

      const child = runNode(brokenDir, ['--import', setupUrl, '-e', 'console.log("seguiu")']);

      assert.notEqual(child.status, 0);
      assert.doesNotMatch(child.stdout, /seguiu/);
      assert.match(child.stderr, /Falha ao copiar o banco base/);
    } finally {
      fs.rmSync(brokenDir, { recursive: true, force: true });
    }
  });
});
