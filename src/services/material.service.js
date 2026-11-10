import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { materialRepository } from '../repositories/material.repository.js';
import { academicRepository } from '../repositories/academic.repository.js';
import { auditRepository } from '../repositories/audit.repository.js';
import { notificationEvents } from '../routes/api/notifications.api.js';
import { botAcessService } from '../integrations/bot-acess/service.js';

export const materialService = {
  // Envio de Material (Cria v1 ORIGINAL) com suporte opcional a agendamento
  async uploadMaterial({ subjectId, classId = null, title, description, category, originalFilename, mimeType, fileSizeBytes, fileBuffer, publishAt = null }, actorUser) {
    if (!title || !title.trim() || !subjectId || !category) {
      throw new Error('Título, disciplina e categoria são obrigatórios.');
    }

    // Validação da Disciplina e Categoria
    const subject = academicRepository.findSubjectById(subjectId);
    if (!subject) {
      throw new Error('A disciplina selecionada não foi encontrada ou não existe.');
    }

    // Mesma lista do CHECK de materials.category (migrations 001 e 003)
    const VALID_CATEGORIES = ['LIVRO', 'APOSTILA', 'SLIDE', 'ARTIGO', 'EXERCICIO', 'AVALIACAO', 'OUTRO'];
    if (category && !VALID_CATEGORIES.includes(category.toUpperCase())) {
      throw new Error(`Categoria de material inválida (${category}).`);
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

    // Grava o arquivo físico em disco para envio ao Core
    if (fileBuffer && Buffer.isBuffer(fileBuffer) && fileBuffer.length > 0) {
      const diskPath = path.resolve(process.cwd(), '.' + storagePath);
      const uploadsDir = path.dirname(diskPath);
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      fs.writeFileSync(diskPath, fileBuffer);
    }

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
  // Quem pode operar o material (ações em lote: aprovar, reprocessar): a equipe de
  // acessibilidade e o professor dono. Aluno nunca, mesmo vendo o material publicado.
  canUserOperateMaterial(user, materialId) {
    const material = materialRepository.findMaterialById(materialId);
    if (!material || !user) return false;
    if (['ADMINISTRADOR', 'GESTOR_ACESSIBILIDADE', 'REVISOR'].includes(user.roleCode)) return true;
    if (user.roleCode === 'PROFESSOR') return material.teacher_user_id === user.id;
    return false;
  },

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
      // Aluno pode ver se estiver matriculado na turma e o material já tiver versão acessibilizada (AGUARDANDO_REVISAO em diante)
      if (!material.class_id) return false;
      const isEnrolled = academicRepository.isStudentInClass(user.id, material.class_id);
      const isAccessibleStatus = ['AGUARDANDO_REVISAO', 'EM_REVISAO', 'APROVADO', 'PUBLICADO'].includes(material.current_status);
      
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

  // Verificação de Permissão de Download (Escopo Fino por Turma, Agendamento e Versão Acessibilizada)
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
      // Aluno matriculado pode baixar logo que a IA acessibiliza (AGUARDANDO_REVISAO em diante)
      if (!material.class_id) return false;
      const isEnrolled = academicRepository.isStudentInClass(user.id, material.class_id);
      const isAccessibleStatus = ['AGUARDANDO_REVISAO', 'EM_REVISAO', 'APROVADO', 'PUBLICADO'].includes(material.current_status);

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
  async requestProcessing(materialVersionId, actorUser, { newAttempt = false } = {}) {
    const version = materialRepository.findVersionById(materialVersionId);
    if (!version) throw new Error('Versão de material não encontrada.');

    // Chave única de idempotência. No reprocessamento a chave ganha o número da
    // tentativa; sem isso o ON CONFLICT devolveria o job antigo (já FAILED).
    let idempotencyKey = `job_${version.id}_${version.sha256_hash}`;
    if (newAttempt) {
      const attempt = materialRepository.countProcessingJobsForVersion(version.id) + 1;
      idempotencyKey += `_tentativa_${attempt}`;
    }

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

    // Previne criação de múltiplas revisões abertas simultâneas para a mesma versão (M2)
    const existingReview = materialRepository.findActiveReviewByVersionId(materialVersionId);
    if (existingReview) {
      return existingReview;
    }

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

    const review = materialRepository.findReviewById(reviewId);
    if (!review) {
      throw new Error('Revisão não encontrada.');
    }

    if (review.status !== 'EM_ANDAMENTO') {
      throw new Error('Esta revisão já foi concluída anteriormente e não pode ser reavaliada.');
    }

    if ((status === 'CORRECAO_SOLICITADA' || status === 'REPROVADO') && (!notes || !notes.trim())) {
      throw new Error('É obrigatório informar uma justificativa detalhada ao solicitar correção ou reprovar o material.');
    }

    materialRepository.updateReviewStatus(reviewId, status, notes ? notes.trim() : null);
    const version = materialRepository.findVersionById(review.material_version_id);
    if (!version) throw new Error('Versão associada à revisão não encontrada.');

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

    // Aceita a ação em qualquer caixa (o aviso de falha enviava "reprocess")
    action = String(action || '').toUpperCase();

    // Escopo por material: a rota só exige "materiais.enviar", então um professor não pode
    // aprovar nem reenviar ao Core (lendo o original e gastando a cota) material de outro.
    // Nada é feito se algum dos materiais estiver fora do escopo.
    const forbidden = materialIds.filter(id => !this.canUserOperateMaterial(actorUser, id));
    if (forbidden.length > 0) {
      const err = new Error('Você não tem permissão para operar um ou mais dos materiais selecionados.');
      err.statusCode = 403;
      throw err;
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
      // Reprocessar = novo job a partir da versão ORIGINAL mais recente, despachado
      // na hora para o Core. Antes só o status mudava e nenhum job era criado.
      const results = [];
      for (const id of materialIds) {
        const original = materialRepository.getMaterialVersions(id).find(v => v.version_type === 'ORIGINAL');
        if (!original) {
          results.push({ materialId: id, success: false, error: 'Material sem versão original.' });
          continue;
        }

        // Já está no Core: não envia de novo (evita job duplicado e gasto da cota)
        const activeJob = materialRepository.findActiveJobForMaterial(id);
        if (activeJob && activeJob.external_job_id) {
          results.push({ materialId: id, success: true, jobId: activeJob.id, alreadyActive: true });
          continue;
        }

        const job = activeJob || await this.requestProcessing(original.id, actorUser, { newAttempt: true });
        const dispatch = await botAcessService.dispatchJob(job.id);
        results.push({ materialId: id, jobId: job.id, ...dispatch });

        const newStatus = dispatch.success ? 'PROCESSANDO' : 'FALHA_PROCESSAMENTO';
        notificationEvents.emit('notify', {
          type: 'MATERIAL_UPDATED',
          materialId: id,
          status: newStatus,
          title: dispatch.success ? 'Material Reenviado' : 'Falha no Reenvio',
          message: dispatch.success ? 'Material reenviado ao Acessilia Core.' : dispatch.error
        });
      }

      const affected = results.filter(r => r.success).length;
      auditRepository.createLog({
        userId: actorUser.id,
        action: 'BULK_REPROCESS_MATERIALS',
        resource: 'materials',
        resourceId: 0,
        details: { materialIds, affected, jobs: results.map(r => ({ materialId: r.materialId, jobId: r.jobId, success: r.success })) }
      });
      return { action, affected, results };
    }

    throw new Error('Ação em lote não suportada.');
  },

  // Canal de Feedback Discente
  async submitFeedback({ materialId, issueType, description }, actorUser) {
    if (!description || !issueType) {
      throw new Error('Tipo do problema e descrição são obrigatórios.');
    }

    const allowedIssueTypes = ['FORMULA', 'IMAGEM_ALT', 'TABELA', 'AUDIO_SINTESE', 'OUTRO'];
    if (!allowedIssueTypes.includes(issueType)) {
      throw new Error('Tipo de problema inválido. Escolha uma das opções do formulário.');
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
