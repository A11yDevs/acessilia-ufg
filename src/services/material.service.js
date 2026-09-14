import crypto from 'crypto';
import { materialRepository } from '../repositories/material.repository.js';
import { academicRepository } from '../repositories/academic.repository.js';
import { auditRepository } from '../repositories/audit.repository.js';
import { notificationEvents } from '../routes/api/notifications.api.js';

export const materialService = {
  // Envio de Material (Cria v1 ORIGINAL) com suporte opcional a agendamento
  async uploadMaterial({ subjectId, classId = null, title, description, category, originalFilename, mimeType, fileSizeBytes, fileBuffer, publishAt = null }, actorUser) {
    if (!title || !subjectId || !category) {
      throw new Error('Título, disciplina e categoria são obrigatórios.');
    }

    // Checagem de Escopo: Se for professor, precisa estar associado à turma/disciplina se especificada
    if (actorUser.roleCode === 'PROFESSOR' && classId) {
      const isTeacher = academicRepository.isTeacherOfClass(actorUser.id, classId);
      if (!isTeacher) {
        throw new Error('Acesso negado: Você não é professor desta turma.');
      }
    }

    // Calcula hash SHA-256 para integridade
    const sha256Hash = crypto.createHash('sha256').update(fileBuffer || originalFilename).digest('hex');
    const storageKey = `mat_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const storagePath = `/uploads/${storageKey}_${originalFilename}`;

    const material = materialRepository.createMaterial({
      subjectId,
      classId,
      teacherUserId: actorUser.id,
      title,
      description,
      category,
      publishAt
    });

    const version = materialRepository.createVersion({
      materialId: material.id,
      versionNumber: 1,
      storageProvider: 'LOCAL_DISK',
      storageKey,
      storagePath,
      originalFilename,
      mimeType: mimeType || 'application/octet-stream',
      fileSizeBytes: fileSizeBytes || 0,
      sha256Hash,
      versionType: 'ORIGINAL',
      uploadedByUserId: actorUser.id
    });

    auditRepository.createLog({
      userId: actorUser.id,
      action: 'UPLOAD_MATERIAL',
      resource: 'materials',
      resourceId: material.id,
      details: { versionNumber: 1, sha256Hash, originalFilename, publishAt }
    });

    return { material, version };
  },

  // Verificação de Permissão para Visualizar Detalhes do Material (Prevenção de IDOR)
  async canUserViewMaterial(user, materialId) {
    const material = materialRepository.findMaterialById(materialId);
    if (!material) return false;

    if (user.roleCode === 'ADMINISTRADOR' || user.roleCode === 'GESTOR_ACESSIBILIDADE' || user.roleCode === 'REVISOR') {
      return true;
    }

    if (user.roleCode === 'PROFESSOR') {
      return material.teacher_user_id === user.id;
    }

    if (user.roleCode === 'ALUNO') {
      // Aluno só pode ver se estiver matriculado na turma e o material estiver APROVADO ou PUBLICADO
      if (!material.class_id) return false;
      const isEnrolled = academicRepository.isStudentInClass(user.id, material.class_id);
      const isAccessibleStatus = ['APROVADO', 'PUBLICADO'].includes(material.current_status);
      
      // Checagem de Agendamento: Se houver publish_at no futuro, ainda não está disponível para discentes
      if (material.publish_at) {
        const publishDate = new Date(material.publish_at);
        if (publishDate > new Date()) {
          return false;
        }
      }

      return isEnrolled && isAccessibleStatus;
    }

    return false;
  },

  // Verificação de Permissão de Download (Escopo Fino por Turma e Agendamento)
  async canUserDownloadMaterial(user, materialId) {
    const material = materialRepository.findMaterialById(materialId);
    if (!material) return false;

    if (user.roleCode === 'ADMINISTRADOR' || user.roleCode === 'GESTOR_ACESSIBILIDADE') {
      return true;
    }

    if (user.roleCode === 'PROFESSOR') {
      return material.teacher_user_id === user.id;
    }

    if (user.roleCode === 'REVISOR') {
      return true; // Revisor tem acesso para análise de qualidade
    }

    if (user.roleCode === 'ALUNO') {
      // Deve ser aluno matriculado na turma da aula e o material deve estar aprovado/publicado
      if (!material.class_id) return false;
      const isEnrolled = academicRepository.isStudentInClass(user.id, material.class_id);
      const isAccessibleStatus = ['APROVADO', 'PUBLICADO'].includes(material.current_status);

      // Checagem de Agendamento
      if (material.publish_at) {
        const publishDate = new Date(material.publish_at);
        if (publishDate > new Date()) {
          return false;
        }
      }

      return isEnrolled && isAccessibleStatus;
    }

    return false;
  },

  // Iniciar Job de Processamento no bot-acess (com idempotência)
  async requestProcessing(materialVersionId, actorUser) {
    const version = materialRepository.findVersionById(materialVersionId);
    if (!version) throw new Error('Versão de material não encontrada.');

    // Chave única de idempotência
    const idempotencyKey = `job_${version.id}_${version.sha256_hash}`;

    const job = materialRepository.createProcessingJob({
      idempotencyKey,
      materialVersionId: version.id,
      provider: 'bot-acess'
    });

    materialRepository.updateMaterialStatus(version.material_id, 'AGUARDANDO_PROCESSAMENTO');

    auditRepository.createLog({
      userId: actorUser.id,
      action: 'CRIAR_JOB_PROCESSAMENTO',
      resource: 'processing_jobs',
      resourceId: job.id,
      details: { idempotencyKey, materialVersionId }
    });

    return job;
  },

  // Revisão Humana
  async startReview(materialVersionId, reviewerUser) {
    const version = materialRepository.findVersionById(materialVersionId);
    if (!version) throw new Error('Versão não encontrada.');

    const review = materialRepository.createReview({
      materialVersionId,
      reviewerUserId: reviewerUser.id
    });

    materialRepository.updateMaterialStatus(version.material_id, 'EM_REVISAO');
    return review;
  },

  async finishReview(reviewId, status, { notes = null } = {}, actorUser) {
    if (!['APROVADO', 'REPROVADO', 'CORRECAO_SOLICITADA'].includes(status)) {
      throw new Error('Status de revisão inválido.');
    }

    materialRepository.updateReviewStatus(reviewId, status);
    const review = materialRepository.findReviewById(reviewId);
    const version = materialRepository.findVersionById(review.material_version_id);

    const materialStatusMap = {
      APROVADO: 'APROVADO',
      REPROVADO: 'REPROVADO',
      CORRECAO_SOLICITADA: 'CORRECAO_SOLICITADA'
    };

    materialRepository.updateMaterialStatus(version.material_id, materialStatusMap[status]);

    // Emite evento SSE para atualização da tela em tempo real
    notificationEvents.emit('notify', {
      type: 'MATERIAL_UPDATED',
      materialId: version.material_id,
      status: materialStatusMap[status],
      title: 'Material Atualizado',
      message: `O status do material foi alterado para ${materialStatusMap[status]}.`
    });

    auditRepository.createLog({
      userId: actorUser.id,
      action: 'CONCLUIR_REVISAO',
      resource: 'reviews',
      resourceId: reviewId,
      details: { status, materialId: version.material_id }
    });
  },

  // Ações em Lote (Bulk Actions)
  async executeBulkAction(materialIds, action, actorUser) {
    if (!materialIds || materialIds.length === 0) {
      throw new Error('Nenhum material selecionado.');
    }

    if (action === 'APPROVE') {
      const affected = materialRepository.bulkUpdateStatus(materialIds, 'APROVADO');
      for (const id of materialIds) {
        notificationEvents.emit('notify', {
          type: 'MATERIAL_UPDATED',
          materialId: id,
          status: 'APROVADO',
          title: 'Material Aprovado',
          message: 'Material aprovado via ação em lote.'
        });
      }
      auditRepository.createLog({
        userId: actorUser.id,
        action: 'BULK_APPROVE_MATERIALS',
        resource: 'materials',
        resourceId: 0,
        details: { materialIds, affected }
      });
      return { action, affected };
    }

    if (action === 'REPROCESS') {
      const affected = materialRepository.bulkUpdateStatus(materialIds, 'AGUARDANDO_PROCESSAMENTO');
      for (const id of materialIds) {
        notificationEvents.emit('notify', {
          type: 'MATERIAL_UPDATED',
          materialId: id,
          status: 'AGUARDANDO_PROCESSAMENTO',
          title: 'Material em Fila',
          message: 'Material reenviado para fila de acessibilização em lote.'
        });
      }
      auditRepository.createLog({
        userId: actorUser.id,
        action: 'BULK_REPROCESS_MATERIALS',
        resource: 'materials',
        resourceId: 0,
        details: { materialIds, affected }
      });
      return { action, affected };
    }

    throw new Error('Ação em lote não suportada.');
  },

  // Canal de Feedback Discente
  async submitFeedback({ materialId, issueType, description }, actorUser) {
    if (!description || !issueType) {
      throw new Error('Tipo do problema e descrição são obrigatórios.');
    }

    const material = materialRepository.findMaterialById(materialId);
    if (!material) throw new Error('Material não encontrado.');

    const feedback = materialRepository.createMaterialFeedback({
      materialId,
      studentUserId: actorUser.id,
      issueType,
      description
    });

    // Notifica professor titular e equipe NAI
    notificationEvents.emit('notify', {
      userId: material.teacher_user_id,
      type: 'FEEDBACK_SUBMITTED',
      materialId,
      feedbackId: feedback.id,
      title: 'Feedback de Acessibilidade Recebido',
      message: `O aluno ${actorUser.name} apontou uma dificuldade no material "${material.title}".`
    });

    auditRepository.createLog({
      userId: actorUser.id,
      action: 'FEEDBACK_ACESSIBILIDADE_DISCENTE',
      resource: 'material_feedbacks',
      resourceId: feedback.id,
      details: { materialId, issueType }
    });

    return feedback;
  }
};
