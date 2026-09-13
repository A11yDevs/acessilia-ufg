import { fileURLToPath } from 'url';
import { db } from './connection.js';
import { hashPassword } from '../src/utils/password.js';

export async function runSeeds() {
  console.log('[SEED] Populando banco de dados para ambiente de desenvolvimento...');

  // 1. Papeis do Sistema (Roles)
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

  // 2. Permissoes Granulares
  const permissions = [
    // Institucional
    { code: 'instituicoes.gerenciar', name: 'Gerenciar Instituicoes', module: 'institucional' },
    { code: 'campuses.gerenciar', name: 'Gerenciar Campi', module: 'institucional' },
    { code: 'departamentos.gerenciar', name: 'Gerenciar Departamentos', module: 'institucional' },
    // Academico
    { code: 'cursos.visualizar', name: 'Visualizar Cursos', module: 'academico' },
    { code: 'cursos.gerenciar', name: 'Gerenciar Cursos', module: 'academico' },
    { code: 'disciplinas.visualizar', name: 'Visualizar Disciplinas', module: 'academico' },
    { code: 'disciplinas.gerenciar', name: 'Gerenciar Disciplinas', module: 'academico' },
    { code: 'turmas.visualizar', name: 'Visualizar Turmas', module: 'academico' },
    { code: 'turmas.gerenciar', name: 'Gerenciar Turmas', module: 'academico' },
    // Usuarios & RBAC
    { code: 'usuarios.visualizar', name: 'Visualizar Usuarios', module: 'usuarios' },
    { code: 'usuarios.criar', name: 'Criar Usuarios', module: 'usuarios' },
    { code: 'usuarios.editar', name: 'Editar Usuarios', module: 'usuarios' },
    { code: 'usuarios.desativar', name: 'Desativar Usuarios', module: 'usuarios' },
    // Preferencias de Acessibilidade (Sensivel / Auditado)
    { code: 'preferencias_acessibilidade.visualizar', name: 'Visualizar Preferencias de Acessibilidade', module: 'acessibilidade' },
    { code: 'preferencias_acessibilidade.editar', name: 'Editar Preferencias de Acessibilidade', module: 'acessibilidade' },
    // Materiais
    { code: 'materiais.visualizar', name: 'Visualizar Materiais', module: 'materiais' },
    { code: 'materiais.baixar', name: 'Baixar Materiais', module: 'materiais' },
    { code: 'materiais.enviar', name: 'Enviar Novos Materiais', module: 'materiais' },
    { code: 'materiais.editar', name: 'Editar Materiais', module: 'materiais' },
    { code: 'materiais.excluir', name: 'Excluir Materiais', module: 'materiais' },
    // Jobs & Integracao bot-acess
    { code: 'processing_jobs.gerenciar', name: 'Gerenciar Jobs de Processamento', module: 'jobs' },
    // Revisoes
    { code: 'revisoes.visualizar', name: 'Visualizar Revisoes', module: 'revisoes' },
    { code: 'revisoes.avaliar', name: 'Avaliar e Revisar Materiais', module: 'revisoes' },
    { code: 'revisoes.aprovar', name: 'Aprovar ou Reprovar Materiais', module: 'revisoes' },
    // Solicitacoes
    { code: 'solicitacoes.criar', name: 'Criar Solicitacao de Acessibilidade', module: 'solicitacoes' },
    { code: 'solicitacoes.gerenciar', name: 'Gerenciar Solicitacoes de Acessibilidade', module: 'solicitacoes' },
    // Auditoria & Configuracoes
    { code: 'auditoria.visualizar', name: 'Visualizar Logs de Auditoria', module: 'auditoria' },
    { code: 'configuracoes.gerenciar', name: 'Gerenciar Configuracoes do Sistema', module: 'configuracoes' }
  ];

  const insertPermStmt = db.prepare(`
    INSERT OR IGNORE INTO permissions (code, name, description, module) VALUES (?, ?, ?, ?)
  `);
  for (const p of permissions) {
    insertPermStmt.run(p.code, p.name, p.description || null, p.module);
  }

  // 3. Mapear Permissoes aos Papeis (Role-Permissions)
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

  // Administrador tem todas as permissoes
  linkRolePerm('ADMINISTRADOR', Object.keys(permMap));

  // Gestor de Acessibilidade
  linkRolePerm('GESTOR_ACESSIBILIDADE', [
    'cursos.visualizar', 'disciplinas.visualizar', 'turmas.visualizar',
    'usuarios.visualizar', 'preferencias_acessibilidade.visualizar',
    'materiais.visualizar', 'materiais.baixar', 'materiais.enviar', 'materiais.editar',
    'processing_jobs.gerenciar', 'revisoes.visualizar', 'revisoes.avaliar', 'revisoes.aprovar',
    'solicitacoes.criar', 'solicitacoes.gerenciar', 'auditoria.visualizar'
  ]);

  // Professor
  linkRolePerm('PROFESSOR', [
    'cursos.visualizar', 'disciplinas.visualizar', 'turmas.visualizar',
    'materiais.visualizar', 'materiais.baixar', 'materiais.enviar', 'materiais.editar',
    'revisoes.visualizar', 'solicitacoes.gerenciar'
  ]);

  // Revisor de Acessibilidade
  linkRolePerm('REVISOR', [
    'cursos.visualizar', 'disciplinas.visualizar', 'turmas.visualizar',
    'preferencias_acessibilidade.visualizar',
    'materiais.visualizar', 'materiais.baixar',
    'processing_jobs.gerenciar', 'revisoes.visualizar', 'revisoes.avaliar', 'revisoes.aprovar',
    'solicitacoes.gerenciar'
  ]);

  // Aluno
  linkRolePerm('ALUNO', [
    'cursos.visualizar', 'disciplinas.visualizar', 'turmas.visualizar',
    'preferencias_acessibilidade.visualizar', 'preferencias_acessibilidade.editar',
    'materiais.visualizar', 'materiais.baixar',
    'solicitacoes.criar'
  ]);

  // 4. Criar Instituicao, Campus e Departamento padrao
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

  // 5. Usuarios de Teste Iniciais (Credenciais de Dev temporarias)
  // Senha padrao para desenvolvimento: Temp@123456
  const devPasswordHash = await hashPassword('Temp@123456');

  const devUsers = [
    {
      name: 'Administrador Central',
      email: 'admin@acessilia.ufg.br',
      reg: 'ADM-001',
      role: 'ADMINISTRADOR'
    },
    {
      name: 'Prof. Carlos Eduardo Mendonca',
      email: 'carlos.professor@acessilia.ufg.br',
      reg: 'DOC-1020',
      role: 'PROFESSOR'
    },
    {
      name: 'Ana Beatriz Souza (Revisora)',
      email: 'ana.revisora@acessilia.ufg.br',
      reg: 'REV-3040',
      role: 'REVISOR'
    },
    {
      name: 'Lucas Gabriel Silveira (Estudante)',
      email: 'lucas.aluno@acessilia.ufg.br',
      reg: 'ALU-202601',
      role: 'ALUNO'
    }
  ];

  const insertUserStmt = db.prepare(`
    INSERT OR IGNORE INTO users (name, email, registration_number, password_hash, status)
    VALUES (?, ?, ?, ?, 'ACTIVE')
  `);

  const linkUserRoleStmt = db.prepare(`
    INSERT OR IGNORE INTO user_roles (user_id, role_id, is_primary)
    VALUES (?, ?, 1)
  `);

  for (const u of devUsers) {
    insertUserStmt.run(u.name, u.email, u.reg, devPasswordHash);
    const user = db.prepare('SELECT id FROM users WHERE email = ?').get(u.email);
    const roleId = roleMap[u.role];
    if (user && roleId) {
      linkUserRoleStmt.run(user.id, roleId);
    }
  }

  console.log('[SEED] Dados base e usuarios temporarios criados com sucesso.');
  console.log('[SEED] Credenciais de teste: Senha para todos: "Temp@123456"');
}

try {
  await runSeeds();
  process.exit(0);
} catch (err) {
  console.error('[SEED ERROR] Erro ao executar seeds:', err);
  process.exit(1);
}
