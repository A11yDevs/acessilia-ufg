import { db } from '../../database/connection.js';

export const materialRepository = {
  createMaterial({ subjectId, classId = null, teacherUserId, title, description = null, category, publishAt = null }) {
    const stmt = db.prepare(`
      INSERT INTO materials (subject_id, class_id, teacher_user_id, title, description, category, current_status, publish_at)
      VALUES (?, ?, ?, ?, ?, ?, 'ENVIADO', ?)
    `);
    const info = stmt.run(subjectId, classId, teacherUserId, title.trim(), description, category, publishAt);
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
  },

  // Ações em Lote (Bulk Actions)
  bulkUpdateStatus(materialIds, status) {
    if (!materialIds || materialIds.length === 0) return 0;
    const placeholders = materialIds.map(() => '?').join(',');
    const stmt = db.prepare(`
      UPDATE materials
      SET current_status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id IN (${placeholders})
    `);
    const result = stmt.run(status, ...materialIds);
    return result.changes;
  },

  // Gestão de Descrições de Imagens (Alt Text Review)
  createAltText({ materialVersionId, imageUrlOrPath, aiSuggestedAlt, humanReviewedAlt = null, status = 'PENDENTE' }) {
    const stmt = db.prepare(`
      INSERT INTO material_alt_texts (material_version_id, image_url_or_path, ai_suggested_alt, human_reviewed_alt, status)
      VALUES (?, ?, ?, ?, ?)
    `);
    const info = stmt.run(materialVersionId, imageUrlOrPath, aiSuggestedAlt, humanReviewedAlt, status);
    return db.prepare('SELECT * FROM material_alt_texts WHERE id = ?').get(info.lastInsertRowid);
  },

  listAltTextsByVersion(materialVersionId) {
    return db.prepare(`
      SELECT mat.*, u.name as reviewer_name
      FROM material_alt_texts mat
      LEFT JOIN users u ON u.id = mat.reviewed_by_user_id
      WHERE mat.material_version_id = ?
      ORDER BY mat.id ASC
    `).all(materialVersionId);
  },

  updateAltText(id, { humanReviewedAlt, status, reviewedByUserId }) {
    const stmt = db.prepare(`
      UPDATE material_alt_texts
      SET human_reviewed_alt = ?,
          status = ?,
          reviewed_by_user_id = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    stmt.run(humanReviewedAlt, status, reviewedByUserId, id);
    return db.prepare('SELECT * FROM material_alt_texts WHERE id = ?').get(id);
  },

  // Canal de Feedback Discente
  createMaterialFeedback({ materialId, studentUserId, issueType, description }) {
    const stmt = db.prepare(`
      INSERT INTO material_feedbacks (material_id, student_user_id, issue_type, description, status)
      VALUES (?, ?, ?, ?, 'ABERTO')
    `);
    const info = stmt.run(materialId, studentUserId, issueType, description.trim());
    return db.prepare(`
      SELECT mf.*, u.name as student_name, m.title as material_title
      FROM material_feedbacks mf
      JOIN users u ON u.id = mf.student_user_id
      JOIN materials m ON m.id = mf.material_id
      WHERE mf.id = ?
    `).get(info.lastInsertRowid);
  },

  listFeedbacksByMaterial(materialId) {
    return db.prepare(`
      SELECT mf.*, u.name as student_name
      FROM material_feedbacks mf
      JOIN users u ON u.id = mf.student_user_id
      WHERE mf.material_id = ?
      ORDER BY mf.created_at DESC
    `).all(materialId);
  }
};
