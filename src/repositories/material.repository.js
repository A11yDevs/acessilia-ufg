import { db } from '../../database/connection.js';

export const materialRepository = {
  createMaterial({ subjectId, classId = null, teacherUserId, title, description = null, category }) {
    const stmt = db.prepare(`
      INSERT INTO materials (subject_id, class_id, teacher_user_id, title, description, category, current_status)
      VALUES (?, ?, ?, ?, ?, ?, 'ENVIADO')
    `);
    const info = stmt.run(subjectId, classId, teacherUserId, title.trim(), description, category);
    return this.findMaterialById(info.lastInsertRowid);
  },

  findMaterialById(id) {
    return db.prepare(`
      SELECT m.*,
             s.name as subject_name, s.code as subject_code,
             u.name as teacher_name, u.email as teacher_email,
             cl.code as class_code
      FROM materials m
      JOIN subjects s ON s.id = m.subject_id
      JOIN users u ON u.id = m.teacher_user_id
      LEFT JOIN classes cl ON cl.id = m.class_id
      WHERE m.id = ?
    `).get(id);
  },

  updateMaterialStatus(materialId, status) {
    const stmt = db.prepare(`
      UPDATE materials
      SET current_status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    return stmt.run(status, materialId);
  },

  // Versões de Materiais
  createVersion({ materialId, versionNumber, storageProvider = 'LOCAL_DISK', storageKey, storagePath, originalFilename, mimeType, fileSizeBytes, sha256Hash, versionType, uploadedByUserId }) {
    const stmt = db.prepare(`
      INSERT INTO material_versions (
        material_id, version_number, storage_provider, storage_key, storage_path,
        original_filename, mime_type, file_size_bytes, sha256_hash, version_type, uploaded_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      materialId, versionNumber, storageProvider, storageKey, storagePath,
      originalFilename, mimeType, fileSizeBytes, sha256Hash, versionType, uploadedByUserId
    );
    return this.findVersionById(info.lastInsertRowid);
  },

  findVersionById(id) {
    return db.prepare(`
      SELECT mv.*, u.name as uploader_name
      FROM material_versions mv
      JOIN users u ON u.id = mv.uploaded_by_user_id
      WHERE mv.id = ?
    `).get(id);
  },

  getLatestVersion(materialId) {
    return db.prepare(`
      SELECT * FROM material_versions
      WHERE material_id = ?
      ORDER BY version_number DESC
      LIMIT 1
    `).get(materialId);
  },

  getMaterialVersions(materialId) {
    return db.prepare(`
      SELECT mv.*, u.name as uploader_name
      FROM material_versions mv
      JOIN users u ON u.id = mv.uploaded_by_user_id
      WHERE mv.material_id = ?
      ORDER BY mv.version_number DESC
    `).all(materialId);
  },

  // Listagem com Escopo de Objeto
  listMaterialsForUser(user) {
    if (user.roleCode === 'ADMINISTRADOR' || user.roleCode === 'GESTOR_ACESSIBILIDADE') {
      return db.prepare(`
        SELECT m.*, s.name as subject_name, u.name as teacher_name
        FROM materials m
        JOIN subjects s ON s.id = m.subject_id
        JOIN users u ON u.id = m.teacher_user_id
        ORDER BY m.created_at DESC
      `).all();
    }

    if (user.roleCode === 'PROFESSOR') {
      return db.prepare(`
        SELECT m.*, s.name as subject_name, u.name as teacher_name
        FROM materials m
        JOIN subjects s ON s.id = m.subject_id
        JOIN users u ON u.id = m.teacher_user_id
        WHERE m.teacher_user_id = ?
        ORDER BY m.created_at DESC
      `).all(user.id);
    }

    if (user.roleCode === 'REVISOR') {
      return db.prepare(`
        SELECT m.*, s.name as subject_name, u.name as teacher_name
        FROM materials m
        JOIN subjects s ON s.id = m.subject_id
        JOIN users u ON u.id = m.teacher_user_id
        WHERE m.current_status IN ('AGUARDANDO_REVISAO', 'EM_REVISAO', 'CORRECAO_SOLICITADA', 'APROVADO')
        ORDER BY m.created_at DESC
      `).all();
    }

    // ALUNO: Apenas materiais aprovados/publicados das turmas onde está matriculado
    return db.prepare(`
      SELECT DISTINCT m.*, s.name as subject_name, u.name as teacher_name
      FROM materials m
      JOIN subjects s ON s.id = m.subject_id
      JOIN users u ON u.id = m.teacher_user_id
      JOIN class_students cs ON cs.class_id = m.class_id
      WHERE cs.student_user_id = ?
        AND cs.status = 'MATRICULADO'
        AND m.current_status IN ('APROVADO', 'PUBLICADO')
      ORDER BY m.created_at DESC
    `).all(user.id);
  },

  // Processing Jobs com Idempotência
  createProcessingJob({ idempotencyKey, materialVersionId, provider = 'bot-acess' }) {
    const stmt = db.prepare(`
      INSERT INTO processing_jobs (idempotency_key, material_version_id, provider, status)
      VALUES (?, ?, ?, 'PENDING')
      ON CONFLICT(idempotency_key) DO UPDATE SET
        updated_at = CURRENT_TIMESTAMP
    `);
    const info = stmt.run(idempotencyKey, materialVersionId, provider);
    return db.prepare('SELECT * FROM processing_jobs WHERE idempotency_key = ?').get(idempotencyKey);
  },

  updateProcessingJobStatus(jobId, status, { externalJobId = null, errorMessage = null } = {}) {
    const stmt = db.prepare(`
      UPDATE processing_jobs
      SET status = ?,
          external_job_id = COALESCE(?, external_job_id),
          error_message = COALESCE(?, error_message),
          started_at = CASE WHEN ? = 'PROCESSING' AND started_at IS NULL THEN CURRENT_TIMESTAMP ELSE started_at END,
          finished_at = CASE WHEN ? IN ('COMPLETED', 'FAILED', 'CANCELLED') THEN CURRENT_TIMESTAMP ELSE finished_at END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    return stmt.run(status, externalJobId, errorMessage, status, status, jobId);
  },

  findJobById(id) {
    return db.prepare('SELECT * FROM processing_jobs WHERE id = ?').get(id);
  },

  // Revisões
  createReview({ materialVersionId, reviewerUserId, notes = null }) {
    const stmt = db.prepare(`
      INSERT INTO reviews (material_version_id, reviewer_user_id, status, general_notes)
      VALUES (?, ?, 'EM_ANDAMENTO', ?)
    `);
    const info = stmt.run(materialVersionId, reviewerUserId, notes);
    return db.prepare('SELECT * FROM reviews WHERE id = ?').get(info.lastInsertRowid);
  },

  updateReviewStatus(reviewId, status) {
    const stmt = db.prepare(`
      UPDATE reviews
      SET status = ?,
          finished_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    return stmt.run(status, reviewId);
  },

  findReviewById(id) {
    return db.prepare('SELECT * FROM reviews WHERE id = ?').get(id);
  },

  addReviewComment({ reviewId, userId, comment, pageOrSection = null, severity = 'OBSERVACAO' }) {
    const stmt = db.prepare(`
      INSERT INTO review_comments (review_id, user_id, comment, page_or_section, severity)
      VALUES (?, ?, ?, ?, ?)
    `);
    const info = stmt.run(reviewId, userId, comment.trim(), pageOrSection, severity);
    return db.prepare('SELECT * FROM review_comments WHERE id = ?').get(info.lastInsertRowid);
  }
};
