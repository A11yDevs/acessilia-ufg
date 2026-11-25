import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.env.NODE_ENV = 'test';

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acessilia-gestor-test-'));
const testDbPath = path.join(testDir, 'test.sqlite');

const removeTestDir = () => {
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch (_) {}
};
process.on('exit', removeTestDir);

const db = new Database(testDbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.pragma('synchronous = NORMAL');

const migrationsDir = path.resolve(__dirname, '../database/migrations');
const migrationFiles = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

db.exec(`
  CREATE TABLE IF NOT EXISTS _schema_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL UNIQUE,
    executed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

for (const file of migrationFiles) {
  const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
  const runTx = db.transaction(() => {
    db.exec(sql);
    db.prepare('INSERT INTO _schema_migrations (filename) VALUES (?)').run(file);
  });
  runTx();
}

const { hashPassword } = await import('../src/utils/password.js');

const roles = [
  { code: 'ADMINISTRADOR', name: 'Administrador do Sistema', description: 'Gestao total do painel e parametros globais', is_system: 1 },
  { code: 'GESTOR_ACESSIBILIDADE', name: 'Gestor de Acessibilidade', description: 'Supervisao de materiais, fluxos de revisao e estatisticas', is_system: 1 },
  { code: 'COORDENADOR', name: 'Coordenador de Curso', description: 'Gestao de matrizes curriculares, turmas e professores', is_system: 1 },
  { code: 'PROFESSOR', name: 'Professor', description: 'Envio de materiais e gestao das suas turmas e disciplinas', is_system: 1 },
  { code: 'REVISOR', name: 'Revisor de Acessibilidade', description: 'Revisao humana, correcoes tecnicas e aprovacao de materiais', is_system: 1 },
  { code: 'MONITOR', name: 'Monitor Academico', description: 'Apoio a turmas e envio assistido de materiais', is_system: 1 },
  { code: 'ALUNO', name: 'Estudante', description: 'Acesso a materiais acessiveis da sua turma e solicitacoes de acessibilidade', is_system: 1 }
];

const insertRoleStmt = db.prepare(`
  INSERT OR IGNORE INTO roles (code, name, description, is_system) VALUES (?, ?, ?, ?)
`);
for (const r of roles) {
  insertRoleStmt.run(r.code, r.name, r.description, r.is_system);
}

const permissions = [
  { code: 'instituicoes.gerenciar', name: 'Gerenciar Instituicoes', module: 'institucional' },
  { code: 'campuses.gerenciar', name: 'Gerenciar Campi', module: 'institucional' },
  { code: 'departamentos.gerenciar', name: 'Gerenciar Departamentos', module: 'institucional' },
  { code: 'cursos.visualizar', name: 'Visualizar Cursos', module: 'academico' },
  { code: 'cursos.gerenciar', name: 'Gerenciar Cursos', module: 'academico' },
  { code: 'disciplinas.visualizar', name: 'Visualizar Disciplinas', module: 'academico' },
  { code: 'disciplinas.gerenciar', name: 'Gerenciar Disciplinas', module: 'academico' },
  { code: 'turmas.visualizar', name: 'Visualizar Turmas', module: 'academico' },
  { code: 'turmas.gerenciar', name: 'Gerenciar Turmas', module: 'academico' },
  { code: 'usuarios.visualizar', name: 'Visualizar Usuarios', module: 'usuarios' },
  { code: 'usuarios.criar', name: 'Criar Usuarios', module: 'usuarios' },
  { code: 'usuarios.editar', name: 'Editar Usuarios', module: 'usuarios' },
  { code: 'usuarios.desativar', name: 'Desativar Usuarios', module: 'usuarios' },
  { code: 'preferencias_acessibilidade.visualizar', name: 'Visualizar Preferencias de Acessibilidade', module: 'acessibilidade' },
  { code: 'preferencias_acessibilidade.editar', name: 'Editar Preferencias de Acessibilidade', module: 'acessibilidade' },
  { code: 'materiais.visualizar', name: 'Visualizar Materiais', module: 'materiais' },
  { code: 'materiais.baixar', name: 'Baixar Materiais', module: 'materiais' },
  { code: 'materiais.enviar', name: 'Enviar Novos Materiais', module: 'materiais' },
  { code: 'materiais.editar', name: 'Editar Materiais', module: 'materiais' },
  { code: 'materiais.excluir', name: 'Excluir Materiais', module: 'materiais' },
  { code: 'processing_jobs.gerenciar', name: 'Gerenciar Jobs de Processamento', module: 'jobs' },
  { code: 'revisoes.visualizar', name: 'Visualizar Revisoes', module: 'revisoes' },
  { code: 'revisoes.avaliar', name: 'Avaliar e Revisar Materiais', module: 'revisoes' },
  { code: 'revisoes.aprovar', name: 'Aprovar ou Reprovar Materiais', module: 'revisoes' },
  { code: 'solicitacoes.criar', name: 'Criar Solicitacao de Acessibilidade', module: 'solicitacoes' },
  { code: 'solicitacoes.gerenciar', name: 'Gerenciar Solicitacoes de Acessibilidade', module: 'solicitacoes' },
  { code: 'auditoria.visualizar', name: 'Visualizar Logs de Auditoria', module: 'auditoria' },
  { code: 'configuracoes.gerenciar', name: 'Gerenciar Configuracoes do Sistema', module: 'configuracoes' }
];

const insertPermStmt = db.prepare(`
  INSERT OR IGNORE INTO permissions (code, name, description, module) VALUES (?, ?, ?, ?)
`);
for (const p of permissions) {
  insertPermStmt.run(p.code, p.name, p.description || null, p.module);
}

const allRoles = db.prepare('SELECT id, code FROM roles').all();
const allPerms = db.prepare('SELECT id, code FROM permissions').all();
const roleMap = Object.fromEntries(allRoles.map(r => [r.code, r.id]));
const permMap = Object.fromEntries(allPerms.map(p => [p.code, p.id]));

const linkRolePerm = (roleCode, permCodes) => {
  const roleId = roleMap[roleCode];
  const stmt = db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)');
  for (const code of permCodes) {
    if (permMap[code]) {
      stmt.run(roleId, permMap[code]);
    }
  }
};

linkRolePerm('ADMINISTRADOR', Object.keys(permMap));
linkRolePerm('GESTOR_ACESSIBILIDADE', [
  'cursos.visualizar', 'disciplinas.visualizar', 'turmas.visualizar',
  'usuarios.visualizar', 'preferencias_acessibilidade.visualizar',
  'materiais.visualizar', 'materiais.baixar', 'materiais.enviar', 'materiais.editar',
  'processing_jobs.gerenciar', 'revisoes.visualizar', 'revisoes.avaliar', 'revisoes.aprovar',
  'solicitacoes.criar', 'solicitacoes.gerenciar', 'auditoria.visualizar'
]);
linkRolePerm('PROFESSOR', [
  'cursos.visualizar', 'disciplinas.visualizar', 'turmas.visualizar',
  'materiais.visualizar', 'materiais.baixar', 'materiais.enviar', 'materiais.editar',
  'revisoes.visualizar', 'solicitacoes.gerenciar'
]);
linkRolePerm('REVISOR', [
  'cursos.visualizar', 'disciplinas.visualizar', 'turmas.visualizar',
  'preferencias_acessibilidade.visualizar',
  'materiais.visualizar', 'materiais.baixar',
  'processing_jobs.gerenciar', 'revisoes.visualizar', 'revisoes.avaliar', 'revisoes.aprovar',
  'solicitacoes.gerenciar'
]);
linkRolePerm('ALUNO', [
  'cursos.visualizar', 'disciplinas.visualizar', 'turmas.visualizar',
  'preferencias_acessibilidade.visualizar', 'preferencias_acessibilidade.editar',
  'materiais.visualizar', 'materiais.baixar',
  'solicitacoes.criar'
]);

db.prepare(`
  INSERT OR IGNORE INTO institutions (id, code, name, trade_name, cnpj, status)
  VALUES (1, 'UFG', 'Universidade Federal de Goias', 'UFG', '01.567.601/0001-43', 'ACTIVE')
`).run();

db.prepare(`
  INSERT OR IGNORE INTO campuses (id, institution_id, code, name, city, state, status)
  VALUES (1, 1, 'SAMAMBAIA', 'Campus Samambaia', 'Goiania', 'GO', 'ACTIVE')
`).run();

db.prepare(`
  INSERT OR IGNORE INTO departments (id, campus_id, code, name, status)
  VALUES (1, 1, 'INF', 'Instituto de Informatica', 'ACTIVE')
`).run();

db.prepare(`
  INSERT OR IGNORE INTO academic_periods (id, institution_id, code, start_date, end_date, is_active)
  VALUES (1, 1, '2026.1', '2026-02-01', '2026-06-30', 1)
`).run();

db.prepare(`
  INSERT OR IGNORE INTO courses (id, department_id, code, name, modality, duration_semesters, status)
  VALUES (1, 1, 'BCC', 'Bacharelado em Ciencia da Computacao', 'PRESENCIAL', 8, 'ACTIVE')
`).run();

db.prepare(`
  INSERT OR IGNORE INTO subjects (id, department_id, code, name, description, workload_hours, status)
  VALUES (1, 1, 'INF001', 'Introducao a Computacao', 'Disciplina basica de computacao', 60, 'ACTIVE')
`).run();

db.prepare(`
  INSERT OR IGNORE INTO course_subjects (id, course_id, subject_id, recommended_semester, is_mandatory)
  VALUES (1, 1, 1, 1, 1)
`).run();

const devPasswordHash = await hashPassword('Temp@123456');

const devUsers = [
  { id: 1, name: 'Administrador Central', email: 'admin@acessilia.ufg.br', reg: 'ADM-001', role: 'ADMINISTRADOR' },
  { id: 2, name: 'Prof. Carlos Eduardo Mendonca', email: 'carlos.professor@acessilia.ufg.br', reg: 'DOC-1020', role: 'PROFESSOR' },
  { id: 3, name: 'Ana Beatriz Souza (Revisora)', email: 'ana.revisora@acessilia.ufg.br', reg: 'REV-3040', role: 'REVISOR' },
  { id: 4, name: 'Lucas Gabriel Silveira (Estudante)', email: 'lucas.aluno@acessilia.ufg.br', reg: 'ALU-202601', role: 'ALUNO' },
  { id: 5, name: 'Maria da Silva (Gestora)', email: 'maria.gestora@acessilia.ufg.br', reg: 'GES-001', role: 'GESTOR_ACESSIBILIDADE' }
];

const insertUserStmt = db.prepare(`
  INSERT OR IGNORE INTO users (id, name, email, registration_number, password_hash, status)
  VALUES (?, ?, ?, ?, ?, 'ACTIVE')
`);

const linkUserRoleStmt = db.prepare(`
  INSERT OR IGNORE INTO user_roles (user_id, role_id, is_primary)
  VALUES (?, ?, 1)
`);

for (const u of devUsers) {
  insertUserStmt.run(u.id, u.name, u.email, u.reg, devPasswordHash);
  const roleId = roleMap[u.role];
  if (roleId) {
    linkUserRoleStmt.run(u.id, roleId);
  }
}

db.prepare(`
  INSERT OR IGNORE INTO teachers_profile (user_id, department_id, academic_title, office_location)
  VALUES (2, 1, 'Doutor', 'Sala 205')
`).run();

db.prepare(`
  INSERT OR IGNORE INTO students_profile (user_id, course_id, entry_period_id, current_semester)
  VALUES (4, 1, 1, 1)
`).run();

const insertMaterialStmt = db.prepare(`
  INSERT INTO materials (id, subject_id, class_id, teacher_user_id, title, description, category, current_status, publish_at, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

insertMaterialStmt.run(
  9,
  1,
  null,
  2,
  'O que faz o Brasil, Brasil?',
  'Ensaio de antropologia social brasileira.',
  'LIVRO',
  'APROVADO',
  null,
  new Date().toISOString(),
  new Date().toISOString()
);

const materialId = 9;

const versionData = {
  material_id: materialId,
  version_number: 1,
  storage_provider: 'LOCAL_DISK',
  storage_key: 'test/material_v1.pdf',
  storage_path: '/tmp/test/material_v1.pdf',
  original_filename: 'material_v1.pdf',
  mime_type: 'application/pdf',
  file_size_bytes: 1024,
  sha256_hash: 'a'.repeat(64),
  version_type: 'ORIGINAL',
  uploaded_by_user_id: 2,
  created_at: new Date().toISOString()
};

const insertVersionStmt = db.prepare(`
  INSERT INTO material_versions (material_id, version_number, storage_provider, storage_key, storage_path, original_filename, mime_type, file_size_bytes, sha256_hash, version_type, uploaded_by_user_id, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
insertVersionStmt.run(
  versionData.material_id,
  versionData.version_number,
  versionData.storage_provider,
  versionData.storage_key,
  versionData.storage_path,
  versionData.original_filename,
  versionData.mime_type,
  versionData.file_size_bytes,
  versionData.sha256_hash,
  versionData.version_type,
  versionData.uploaded_by_user_id,
  versionData.created_at
);

const processedVersionData = {
  material_id: materialId,
  version_number: 2,
  storage_provider: 'LOCAL_DISK',
  storage_key: 'test/material_v2.html',
  storage_path: '/tmp/test/material_v2.html',
  original_filename: 'material_v2.html',
  mime_type: 'text/html',
  file_size_bytes: 2048,
  sha256_hash: 'b'.repeat(64),
  version_type: 'PROCESSADO_BOT',
  uploaded_by_user_id: 2,
  created_at: new Date().toISOString()
};
insertVersionStmt.run(
  processedVersionData.material_id,
  processedVersionData.version_number,
  processedVersionData.storage_provider,
  processedVersionData.storage_key,
  processedVersionData.storage_path,
  processedVersionData.original_filename,
  processedVersionData.mime_type,
  processedVersionData.file_size_bytes,
  processedVersionData.sha256_hash,
  processedVersionData.version_type,
  processedVersionData.uploaded_by_user_id,
  processedVersionData.created_at
);

const classData = {
  course_id: 1,
  subject_id: 1,
  academic_period_id: 1,
  code: 'T-TEST-EXISTING',
  location: 'Lab 101',
  schedule_description: 'Segunda e Quarta 10:00',
  status: 'ACTIVE',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
};

const insertClassStmt = db.prepare(`
  INSERT INTO classes (course_id, subject_id, academic_period_id, code, location, schedule_description, status, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const classResult = insertClassStmt.run(
  classData.course_id,
  classData.subject_id,
  classData.academic_period_id,
  classData.code,
  classData.location,
  classData.schedule_description,
  classData.status,
  classData.created_at,
  classData.updated_at
);
const classId = classResult.lastInsertRowid;

db.prepare(`
  INSERT OR IGNORE INTO class_teachers (class_id, teacher_user_id, role_in_class)
  VALUES (?, 2, 'TITULAR')
`).run(classId);

db.prepare(`
  INSERT OR IGNORE INTO class_students (class_id, student_user_id, status)
  VALUES (?, 4, 'MATRICULADO')
`).run(classId);

db.prepare(`
  INSERT OR IGNORE INTO system_settings (key, value, description)
  VALUES ('site_name', 'ACESSILIA GESTOR', 'Nome do site')
`).run();

db.prepare(`
  INSERT OR IGNORE INTO system_settings (key, value, description)
  VALUES ('max_upload_size_mb', '50', 'Tamanho maximo de upload em MB')
`).run();

process.env.DATABASE_PATH = testDbPath;

export { db, testDbPath };