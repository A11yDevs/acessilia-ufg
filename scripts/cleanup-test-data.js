import { db } from './database/connection.js';

console.log('[CLEANUP] Iniciando limpeza de dados de teste do banco de dados...');

const cleanupTx = db.transaction(() => {
  // 1. Limpar avaliações, jobs e alt-texts de materiais de teste (manter apenas material ID 9)
  const testVersionIds = db.prepare('SELECT id FROM material_versions WHERE material_id != 9').all().map(r => r.id);
  
  if (testVersionIds.length > 0) {
    const placeholders = testVersionIds.map(() => '?').join(',');
    
    // Remove alt texts
    db.prepare(`DELETE FROM material_alt_texts WHERE material_version_id IN (${placeholders})`).run(...testVersionIds);
    
    // Remove reviews e seus comentários
    const testReviewIds = db.prepare(`SELECT id FROM reviews WHERE material_version_id IN (${placeholders})`).all(...testVersionIds).map(r => r.id);
    if (testReviewIds.length > 0) {
      const reviewPlaceholders = testReviewIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM review_comments WHERE review_id IN (${reviewPlaceholders})`).run(...testReviewIds);
      db.prepare(`DELETE FROM reviews WHERE id IN (${reviewPlaceholders})`).run(...testReviewIds);
    }
    
    // Remove processing jobs e versões
    db.prepare(`DELETE FROM processing_jobs WHERE material_version_id IN (${placeholders})`).run(...testVersionIds);
    db.prepare(`DELETE FROM material_versions WHERE id IN (${placeholders})`).run(...testVersionIds);
  }

  // Remove feedbacks e solicitações de materiais de teste
  db.prepare('DELETE FROM material_feedbacks WHERE material_id != 9').run();
  db.prepare('DELETE FROM accessibility_requests WHERE material_id != 9').run();

  // Deletar os materiais de teste
  const deletedMats = db.prepare('DELETE FROM materials WHERE id != 9').run();
  console.log(`[CLEANUP] Materiais de teste removidos: ${deletedMats.changes}. Material ID 9 preservado.`);

  // 2. Limpar turmas, cursos e disciplinas de teste (gerados pelo runner de testes)
  const testClassIds = db.prepare("SELECT id FROM classes WHERE code LIKE 'TURMA-CERT-%'").all().map(r => r.id);
  if (testClassIds.length > 0) {
    const classPlaceholders = testClassIds.map(() => '?').join(',');
    db.prepare(`DELETE FROM class_teachers WHERE class_id IN (${classPlaceholders})`).run(...testClassIds);
    db.prepare(`DELETE FROM class_students WHERE class_id IN (${classPlaceholders})`).run(...testClassIds);
    db.prepare(`DELETE FROM classes WHERE id IN (${classPlaceholders})`).run(...testClassIds);
  }

  db.prepare("DELETE FROM course_subjects WHERE course_id IN (SELECT id FROM courses WHERE code LIKE 'CERT-%') OR subject_id IN (SELECT id FROM subjects WHERE code LIKE 'DISC-CERT-%')").run();
  db.prepare("DELETE FROM subjects WHERE code LIKE 'DISC-CERT-%'").run();
  db.prepare("DELETE FROM courses WHERE code LIKE 'CERT-%'").run();

  // 3. Normalizar Curso e Disciplina Institucionais Oficiais da UFG
  db.prepare(`
    UPDATE courses 
    SET code = 'ES', name = 'Engenharia de Software', modality = 'PRESENCIAL', duration_semesters = 8, status = 'ACTIVE'
    WHERE id = 1
  `).run();

  db.prepare(`
    UPDATE subjects 
    SET code = 'INF01', name = 'Acessibilidade Digital', workload_hours = 64, status = 'ACTIVE', description = 'Fundamentos de Acessibilidade Digital e Design Universal na Web (WCAG 2.2 e LBI).'
    WHERE id = 1
  `).run();

  // Vincular Disciplina 1 ao Curso 1
  db.prepare(`
    INSERT OR IGNORE INTO course_subjects (course_id, subject_id, recommended_semester, is_mandatory)
    VALUES (1, 1, 1, 1)
  `).run();

  // 4. Criar Turma Oficial de Produção
  const existingClass = db.prepare("SELECT id FROM classes WHERE code = 'TURMA-ES-2026-1'").get();
  let classId = existingClass ? existingClass.id : null;

  if (!classId) {
    const resClass = db.prepare(`
      INSERT INTO classes (course_id, subject_id, academic_period_id, code, location, schedule_description, status)
      VALUES (1, 1, 1, 'TURMA-ES-2026-1', 'INF - Laboratório 104', 'Segundas e Quartas, 08:00 - 10:00', 'ACTIVE')
    `).run();
    classId = resClass.lastInsertRowid;
  }

  // Vincular Professor Titular (Carlos Eduardo Mendonca - ID 2)
  db.prepare(`
    INSERT OR IGNORE INTO class_teachers (class_id, teacher_user_id, role_in_class)
    VALUES (?, 2, 'TITULAR')
  `).run(classId);

  // Matricular Estudante (Lucas Gabriel Silveira - ID 4)
  db.prepare(`
    INSERT OR IGNORE INTO class_students (class_id, student_user_id, status)
    VALUES (?, 4, 'MATRICULADO')
  `).run(classId);

  // Vincular Material 9 à Turma Oficial de Produção
  db.prepare(`
    UPDATE materials 
    SET class_id = ?, subject_id = 1, current_status = 'APROVADO'
    WHERE id = 9
  `).run(classId);

  // Garantir que a revisão humana do Material 9 esteja devidamente homologada como APROVADA
  const review9 = db.prepare('SELECT id FROM reviews WHERE material_version_id = 10').get();
  if (review9) {
    db.prepare(`
      UPDATE reviews 
      SET status = 'APROVADO', general_notes = 'Material homologado com conformidade integral WCAG 2.2 Nível AAA pelo Núcleo de Acessibilidade.', finished_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(review9.id);
  } else {
    db.prepare(`
      INSERT INTO reviews (material_version_id, reviewer_user_id, status, general_notes, created_at, finished_at)
      VALUES (10, 3, 'APROVADO', 'Material homologado com conformidade integral WCAG 2.2 Nível AAA pelo Núcleo de Acessibilidade.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run();
  }

  console.log('[CLEANUP] Base de produção normalizada com sucesso!');
});

cleanupTx();
