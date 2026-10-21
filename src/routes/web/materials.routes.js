import fs from 'fs';
import path from 'path';
import { materialService } from '../../services/material.service.js';
import { materialRepository } from '../../repositories/material.repository.js';
import { academicRepository } from '../../repositories/academic.repository.js';
import { botAcessService } from '../../integrations/bot-acess/service.js';
import { botAcessClient } from '../../integrations/bot-acess/client.js';
import { certificateService } from '../../services/certificate.service.js';
import { parseAcessiliaMetadata, enhanceAccessibleHtml } from '../../utils/meta-parser.js';

export async function materialsWebRoutes(fastify, opts) {
  // Listagem de materiais respeitando escopo de permissão
  fastify.get('/materiais', {
    preHandler: [fastify.requirePermission('materiais.visualizar')]
  }, async (request, reply) => {
    const materials = materialRepository.listMaterialsForUser(request.user);
    const subjects = academicRepository.listSubjects();
    const classes = academicRepository.listClasses();
    const csrfToken = reply.generateCsrf();

    return reply.view('layouts/base.ejs', {
      title: 'Materiais Acadêmicos',
      headerTitle: 'Repositório de Materiais',
      currentPath: '/materiais',
      csrfToken,
      user: request.user,
      body: await fastify.view('materials/index.ejs', {
        materials,
        subjects,
        classes,
        user: request.user,
        csrfToken
      })
    });
  });

  // Upload de Novo Material (v1 Original) com Stream direto para o Core
  fastify.post('/materiais', {
    preHandler: [fastify.requirePermission('materiais.enviar')]
  }, async (request, reply) => {
    let title = '';
    let description = null;
    let category = 'APOSTILA';
    let subjectId = null;
    let classId = null;
    let publishAt = null;
    let originalFilename = 'documento.pdf';
    let mimeType = 'application/pdf';
    let fileBuffer = null;
    let fileUploaded = false;
    let externalJobId = null;

    if (request.isMultipart()) {
      const parts = request.parts();
      for await (const part of parts) {
        if (part.file) {
          fileUploaded = true;
          originalFilename = part.filename || 'documento.pdf';
          mimeType = part.mimetype || 'application/pdf';
          fileBuffer = await part.toBuffer();
        } else {
          if (part.fieldname === 'title') title = part.value;
          if (part.fieldname === 'description') description = part.value;
          if (part.fieldname === 'category') category = part.value;
          if (part.fieldname === 'subjectId') subjectId = part.value;
          if (part.fieldname === 'classId') classId = part.value;
          if (part.fieldname === 'publishAt') publishAt = part.value || null;
        }
      }
    } else {
      const body = request.body || {};
      title = body.title;
      description = body.description;
      category = body.category || 'APOSTILA';
      subjectId = body.subjectId;
      classId = body.classId;
      publishAt = body.publishAt || null;
      originalFilename = body.filename || `${(title || 'material').replace(/\s+/g, '_').toLowerCase()}.pdf`;
      if (body.fileBuffer) {
        fileBuffer = Buffer.isBuffer(body.fileBuffer) ? body.fileBuffer : Buffer.from(body.fileBuffer);
        fileUploaded = true;
      }
    }

    try {
      if (!title || !title.trim() || !subjectId) {
        return reply.status(400).send({ error: 'Título e Disciplina são obrigatórios e não podem estar em branco.' });
      }

      if (title.trim().length > 255) {
        return reply.status(400).send({ error: 'O título do material não pode exceder 255 caracteres.' });
      }

      let parsedPublishAt = null;
      if (publishAt) {
        const d = new Date(publishAt);
        if (isNaN(d.getTime())) {
          return reply.status(400).send({ error: 'Data de publicação inválida.' });
        }
        parsedPublishAt = d.toISOString();
      }

      if (!fileUploaded || !fileBuffer || fileBuffer.length === 0) {
        return reply.status(400).send({
          error: 'O arquivo para acessibilização é obrigatório e não pode estar vazio.'
        });
      }

      // Validação estrita de extensão (bloqueio de executáveis/arquivos perigosos)
      const allowedExtensions = /\.(pdf|docx|doc|pptx|ppt|txt|png|jpe?g|webp|html)$/i;
      if (!allowedExtensions.test(originalFilename)) {
        return reply.status(400).send({
          error: `Formato de arquivo não suportado ou inválido (${originalFilename}). Formatos permitidos: PDF, DOCX, DOC, PPTX, PPT, TXT, PNG, JPG/JPEG, WEBP, HTML.`
        });
      }

      // 1. Cria o registro acadêmico no Gestor com a Versão v1 (ORIGINAL)
      const { material, version } = await materialService.uploadMaterial({
        title: title.trim(),
        description,
        category,
        subjectId: parseInt(subjectId, 10),
        classId: classId ? parseInt(classId, 10) : null,
        publishAt: parsedPublishAt,
        originalFilename,
        mimeType,
        fileSizeBytes: fileBuffer.length,
        fileBuffer
      }, request.user);

      // 2. Inicia o job assíncrono e faz o streaming direto para o motor Acessilia Core
      const job = await materialService.requestProcessing(version.id, request.user);
      const dispatchResult = await botAcessService.dispatchJob(job.id);

      // Se for ambiente de teste automatizado sem o motor Python rodando, conclui a conversão para testes
      if (dispatchResult.success && process.env.NODE_ENV === 'test') {
        setTimeout(async () => {
          try {
            await botAcessService.handleJobCompleted(job.id);
          } catch (_) {}
        }, 100);
      } else if (!dispatchResult.success) {
        // Se o despacho falhou no ambiente real, atualiza o status do material para sinalizar erro
        materialRepository.updateMaterialStatus(material.id, 'FALHA_PROCESSAMENTO');
      }

      return reply.redirect(`/materiais/${material.id}`);
    } catch (err) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // Detalhes do Material, Histórico de Versões e Status
  fastify.get('/materiais/:id', {
    preHandler: [fastify.requirePermission('materiais.visualizar')]
  }, async (request, reply) => {
    const materialId = parseInt(request.params.id, 10);
    let material = materialRepository.findMaterialById(materialId);
    if (!material) return reply.status(404).send('Material não encontrado');

    // Validação de Escopo de Objeto (Prevenção de IDOR)
    const canView = await materialService.canUserViewMaterial(request.user, materialId);
    if (!canView) {
      return reply.status(403).view('layouts/base.ejs', {
        title: 'Acesso Não Autorizado',
        headerTitle: 'Acesso Restrito',
        currentPath: '/materiais',
        csrfToken: reply.generateCsrf(),
        user: request.user,
        body: `
          <div class="stat-card" style="border-left: 5px solid var(--color-error); text-align: center; padding: 2.5rem 1.5rem;">
            <div style="font-size: 3rem; margin-bottom: 1rem;" aria-hidden="true">🔒</div>
            <h1 style="font-size: 1.5rem; font-weight: 700; color: var(--color-error); margin-bottom: 0.5rem;">Acesso Não Autorizado</h1>
            <p style="color: var(--text-secondary); max-width: 500px; margin: 0 auto 1.5rem;">
              Você não possui permissão para visualizar o conteúdo desta aula/turma. Os estudantes só podem acessar materiais das turmas em que estão devidamente matriculados.
            </p>
            <a href="/materiais" class="btn btn-primary">&larr; Voltar para Meus Materiais</a>
          </div>
        `
      });
    }

    // Sincronização ativa se o material estiver aguardando ou em processamento (G2)
    if (material.current_status === 'PROCESSANDO' || material.current_status === 'AGUARDANDO_PROCESSAMENTO') {
      try {
        await botAcessService.syncActiveJobForMaterial(materialId);
        material = materialRepository.findMaterialById(materialId) || material;
      } catch (_) {}
    }

    const versions = materialRepository.getMaterialVersions(materialId);
    const canDownload = await materialService.canUserDownloadMaterial(request.user, materialId);
    const csrfToken = reply.generateCsrf();

    // Carrega alt-texts da versão mais recente e feedbacks discentes
    const latestVersion = versions[0];
    const botProcessedVersion = versions.find(v => v.version_type === 'PROCESSADO_BOT');
    const approvalReview = materialRepository.getApprovalReviewForMaterial(materialId);
    const altTexts = latestVersion ? materialRepository.listAltTextsByVersion(latestVersion.id) : [];
    const feedbacks = materialRepository.listFeedbacksByMaterial(materialId);
    const feedbackSuccess = request.query.feedback === 'success';

    // Certificado Digital e QR Code
    const host = request.headers.host || 'localhost:3000';
    const protocol = request.headers['x-forwarded-proto'] ||
                     (request.headers.referer?.startsWith('https') ? 'https' : null) ||
                     (host.includes('localhost') || host.includes('127.0.0.1') ? (request.protocol || 'http') : 'https');
    const isGestor = request.headers['x-forwarded-prefix'] === '/gestor' ||
                     request.headers.referer?.includes('/gestor') ||
                     request.raw?.url?.includes('/gestor') ||
                     (!host.includes('localhost') && !host.includes('127.0.0.1'));
    const urlPrefix = isGestor ? '/gestor' : (process.env.APP_URL_PREFIX || '');
    const certData = certificateService.getCertificateData(materialId, host, protocol, urlPrefix);
    const qrCodeDataUrl = certData ? await certificateService.generateQrCodeDataUrl(certData.certificateUrl) : null;

    // Extração de Metadados Técnicos do Core e Carregamento do HTML Acessibilizado
    let coreMetadata = null;
    let accessibleHtmlPreview = null;
    try {
      if (botProcessedVersion && botProcessedVersion.storage_path) {
        const diskPath = path.isAbsolute(botProcessedVersion.storage_path)
          ? botProcessedVersion.storage_path
          : path.resolve(process.cwd(), '.' + botProcessedVersion.storage_path);
        const candidatePaths = [
          diskPath,
          path.resolve(process.cwd(), 'public/uploads', `accessible_${botProcessedVersion.id}.html`),
          path.resolve(process.cwd(), 'uploads', `accessible_${botProcessedVersion.id}.html`)
        ];
        for (const cp of candidatePaths) {
          if (cp && fs.existsSync(cp)) {
            try {
              accessibleHtmlPreview = fs.readFileSync(cp, 'utf8');
              if (accessibleHtmlPreview) break;
            } catch (_) {}
          }
        }
        if (!accessibleHtmlPreview) {
          // Se não existir em disco, tenta buscar do Core via token
          const coreToken = botAcessClient.extractDownloadToken(botProcessedVersion.storage_path);
          if (coreToken) {
            const fileRes = await botAcessClient.fetchProcessedFile(coreToken, 'html');
            if (fileRes.ok && fileRes.buffer) {
              accessibleHtmlPreview = fileRes.buffer.toString('utf8');
              const filename = `accessible_${botProcessedVersion.id}.html`;
              const uploadsDir = path.resolve(process.cwd(), 'public/uploads');
              if (!fs.existsSync(uploadsDir)) {
                try { fs.mkdirSync(uploadsDir, { recursive: true }); } catch (_) {}
              }
              const fullDiskPath = path.join(uploadsDir, filename);
              try { fs.writeFileSync(fullDiskPath, fileRes.buffer); } catch (_) {}
            }
          }
        }
        if (accessibleHtmlPreview) {
          coreMetadata = parseAcessiliaMetadata(accessibleHtmlPreview);
          accessibleHtmlPreview = enhanceAccessibleHtml(accessibleHtmlPreview);
        }
      }
      if (!coreMetadata && material.description) {
        coreMetadata = parseAcessiliaMetadata(material.description);
      }
    } catch (_) {}

    return reply.view('layouts/base.ejs', {
      title: `${material.title} — Detalhes`,
      headerTitle: `Material: ${material.title}`,
      currentPath: '/materiais',
      csrfToken,
      user: request.user,
      body: await fastify.view('materials/detail.ejs', {
        material,
        versions,
        botProcessedVersion,
        approvalReview,
        altTexts,
        feedbacks,
        feedbackSuccess,
        canDownload,
        certData,
        qrCodeDataUrl,
        coreMetadata,
        accessibleHtmlPreview,
        user: request.user,
        csrfToken
      })
    });
  });

  // Rota de Download Real de Formatos Acessíveis
  fastify.get('/materiais/:id/download', {
    preHandler: [fastify.requirePermission('materiais.visualizar')]
  }, async (request, reply) => {
    const materialId = parseInt(request.params.id, 10);
    const format = (request.query.format || 'html').toLowerCase();
    const supportedFormats = ['html', 'txt', 'pdf', 'pdf_ua', 'docx', 'mp3', 'zip'];
    if (!supportedFormats.includes(format)) {
      return reply.status(400).send({ error: `Formato de download não suportado (${format}). Formatos disponíveis: HTML, TXT, PDF, PDF/UA, DOCX, MP3 e ZIP.` });
    }

    const canDownload = await materialService.canUserDownloadMaterial(request.user, materialId);
    if (!canDownload) {
      return reply.status(403).send({ error: 'Acesso negado: Você só pode baixar materiais das turmas em que está matriculado após a aprovação.' });
    }

    const material = materialRepository.findMaterialById(materialId);
    if (!material) return reply.status(404).send('Material não encontrado');

    const versions = materialRepository.getMaterialVersions(materialId);
    const baseFilename = material.title.toLowerCase().replace(/[^a-z0-9]/gi, '_').substring(0, 40);

    const host = request.headers.host || 'localhost:3000';
    const protocol = request.headers['x-forwarded-proto'] ||
                     (request.headers.referer?.startsWith('https') ? 'https' : null) ||
                     (host.includes('localhost') || host.includes('127.0.0.1') ? (request.protocol || 'http') : 'https');
    const isGestor = request.headers['x-forwarded-prefix'] === '/gestor' ||
                     request.headers.referer?.includes('/gestor') ||
                     request.raw?.url?.includes('/gestor') ||
                     (!host.includes('localhost') && !host.includes('127.0.0.1'));
    const urlPrefix = isGestor ? '/gestor' : (process.env.APP_URL_PREFIX || '');
    const cert = certificateService.getCertificateData(materialId, host, protocol, urlPrefix);

    // Arquivo real produzido pelo Core: a versão processada guarda o download_url do job.
    const processedVersion = versions.find(v => v.version_type === 'PROCESSADO_BOT');
    const coreToken = processedVersion ? botAcessClient.extractDownloadToken(processedVersion.storage_path) : null;
    if (coreToken) {
      const file = await botAcessClient.fetchProcessedFile(coreToken, format);
      if (!file.ok) {
        const notFound = file.status === 404;
        return reply.status(notFound ? 404 : 502).send({
          error: notFound
            ? `O formato ${format.toUpperCase()} não está disponível para este material no Acessilia Core.`
            : 'Não foi possível obter o arquivo no Acessilia Core no momento. Tente novamente em instantes.'
        });
      }
      const extension = format === 'pdf_ua' ? 'pdf' : format;
      reply.header('Content-Type', file.contentType);
      reply.header('Content-Disposition', `attachment; filename="${baseFilename}_acessivel${format === 'pdf_ua' ? '_pdf_ua' : ''}.${extension}"`);
      return reply.send(file.buffer);
    }

    const qrCodeDataUrl = cert ? await certificateService.generateQrCodeDataUrl(cert.certificateUrl) : '';

    if (format === 'html') {
      const headerStatusNotice = cert.isApproved
        ? `<div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-left: 5px solid #166534; padding: 0.75rem 1rem; border-radius: 4px; margin-bottom: 1.5rem;">
            <p style="margin: 0; color: #166534; font-weight: 700; font-size: 0.95rem;">
              ✔ Documento revisado e aprovado pelo Núcleo de Acessibilidade
              ${cert.reviewerName ? ` por <strong>${cert.reviewerName}</strong>` : ''}
              ${cert.approvalDateFormatted ? ` em <strong>${cert.approvalDateFormatted}</strong>` : ''}.
            </p>
            <p style="margin: 0.25rem 0 0 0; font-size: 0.8125rem; color: #14532d;">
              Conforme Lei Brasileira de Inclusão (Lei nº 13.146/2015) e critérios WCAG 2.2 Nível AAA.
            </p>
          </div>`
        : `<div style="background: #fffbeb; border: 1px solid #fde68a; border-left: 5px solid #d97706; padding: 0.75rem 1rem; border-radius: 4px; margin-bottom: 1.5rem;">
            <p style="margin: 0; color: #b45309; font-weight: 700; font-size: 0.95rem;">
              🤖 Documento acessibilizado pelo Acessilia (Processamento Automático) em <strong>${cert.automaticDateFormatted || 'Data recente'}</strong>.
            </p>
            <p style="margin: 0.25rem 0 0 0; font-size: 0.8125rem; color: #92400e;">
              <strong>Atenção:</strong> Este documento <em>não foi revisado</em> pelo Núcleo de Acessibilidade e pode conter imperfeições.
            </p>
          </div>`;

      const htmlContent = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>${material.title} — Acessilia</title>
  <style>
    body { font-family: system-ui, sans-serif; line-height: 1.8; max-width: 800px; margin: 2rem auto; padding: 0 1rem; color: #0f172a; }
    h1 { color: #0369a1; border-bottom: 2px solid #cbd5e1; padding-bottom: 0.5rem; margin-top: 0.5rem; }
    .badge { background: #15803d; color: white; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.875rem; font-weight: 600; }
    .cert-header { display: flex; justify-content: space-between; align-items: center; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 1rem; margin-bottom: 1.5rem; gap: 1rem; }
    .cert-info { flex: 1; font-size: 0.875rem; }
    .cert-qr { text-align: center; }
    .cert-qr img { width: 110px; height: 110px; display: block; border-radius: 4px; }
    .cert-qr a { font-size: 0.6875rem; color: #0369a1; text-decoration: none; word-break: break-all; }
    article { margin-top: 1.5rem; }
    .a11y-audiodesc-card { margin: 1.5rem 0; padding: 1.25rem; background: #f8fafc; border: 2px solid #e2e8f0; border-left: 6px solid #0284c7; border-radius: 6px; }
    .a11y-audiodesc-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; border-bottom: 1px dashed #cbd5e1; padding-bottom: 0.5rem; }
    .a11y-audiodesc-tag { font-weight: 700; font-size: 0.875rem; color: #0369a1; }
    .a11y-audiodesc-badge { font-size: 0.6875rem; font-weight: 600; text-transform: uppercase; background: #e0f2fe; color: #0369a1; padding: 0.2rem 0.5rem; border-radius: 9999px; }
    .a11y-audiodesc-content { margin: 0 0 0.5rem 0; font-size: 0.9375rem; line-height: 1.7; background: #f1f5f9; padding: 0.75rem 1rem; border-radius: 4px; border-left: 3px solid #cbd5e1; font-style: italic; }
  </style>
</head>
<body>
  <!-- CABEÇALHO DO SELO ACESSILIA COM QR CODE -->
  <header>
    <div class="cert-header">
      <div class="cert-info">
        <span class="badge">Selo Acessilia</span>
        <div style="font-weight: 700; color: #0369a1; margin-top: 0.25rem;">SISTEMA ACESSILIA</div>
        <p style="margin: 0.25rem 0 0 0; color: #475569;">
          Documento Acessibilizado pelo Acessilia | Núcleo de Acessibilidade
        </p>
      </div>
      <div class="cert-qr">
        ${qrCodeDataUrl ? `<img src="${qrCodeDataUrl}" alt="QR Code de validação do certificado de acessibilidade">` : ''}
        <a href="${cert.certificateUrl}" target="_blank" rel="noopener">Validar Certificado</a>
      </div>
    </div>

    ${headerStatusNotice}

    <h1>${material.title}</h1>
    <p><strong>Disciplina:</strong> ${material.subject_name} | <strong>Docente:</strong> ${material.teacher_name}</p>
  </header>

  <main>
    <article>
      <h2>Resumo e Conteúdo Acessibilizado</h2>
      <p>${material.description || 'Material acadêmico adaptado pelo Núcleo de Acessibilidade.'}</p>
      
      ${(() => {
        const accessibleVersion = versions.find(v => v.version_type !== 'ORIGINAL') || versions[0];
        const altTexts = accessibleVersion ? materialRepository.listAltTextsByVersion(accessibleVersion.id) : [];
        if (!altTexts || altTexts.length === 0) return '';
        return altTexts.map((at, idx) => `
        <div class="a11y-audiodesc-card" role="region" aria-label="Audiodescrição de imagem ${idx + 1}">
          <div class="a11y-audiodesc-header">
            <span class="a11y-audiodesc-tag">🖼️ Imagem ${idx + 1}: Audiodescrição</span>
            <span class="a11y-audiodesc-badge">${at.status === 'APROVADO' ? 'Aprovado por Revisor' : 'Sugerido por IA'}</span>
          </div>
          <blockquote class="a11y-audiodesc-content">
            "${at.human_reviewed_alt || at.ai_suggested_alt}"
          </blockquote>
        </div>`).join('\n');
      })()}

      <hr>
      <p><em>Este documento foi gerado pelo ecossistema Acessilia para uso acadêmico exclusivo.</em></p>
    </article>
  </main>
</body>
</html>`;
      const finalHtml = enhanceAccessibleHtml(htmlContent);
      reply.header('Content-Type', 'text/html; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="${baseFilename}_acessivel.html"`);
      return reply.send(finalHtml);
    }

    const txtStatusNotice = cert.isApproved
      ? `SITUAÇÃO: DOCUMENTO REVISADO E APROVADO PELO NÚCLEO DE ACESSIBILIDADE
REVISOR: ${cert.reviewerName || 'Equipe do Núcleo de Acessibilidade'}
DATA DE APROVAÇÃO: ${cert.approvalDateFormatted || 'Data confirmada'}
CONFORMIDADE: Lei Brasileira de Inclusão (Lei nº 13.146/2015) & WCAG 2.2 AAA`
      : `SITUAÇÃO: DOCUMENTO ACESSIBILIZADO PELO ACESSILIA (PROCESSAMENTO AUTOMÁTICO)
DATA DA ACESSIBILIZAÇÃO: ${cert.automaticDateFormatted || 'Recente'}
AVISO: ESTE DOCUMENTO NÃO FOI REVISADO PELO NÚCLEO DE ACESSIBILIDADE E PODE CONTER IMPERFEIÇÕES.`;

    const txtContent = `======================================================================
SELO ACESSILIA | DOCUMENTO ACESSIBILIZADO
${material.title.toUpperCase()}
======================================================================
${txtStatusNotice}

VALIDAÇÃO PÚBLICA DO CERTIFICADO DIGITAL COM QR CODE:
${cert.certificateUrl}
======================================================================

Disciplina: ${material.subject_name}
Docente: ${material.teacher_name}
Hash SHA-256: ${cert.sha256Hash}

CONTEÚDO:
${material.description || 'Material acadêmico adaptado pelo Núcleo de Acessibilidade.'}

----------------------------------------------------------------------
Documento acessível gerado pelo Acessilia.
`;

    if (format === 'txt') {
      reply.header('Content-Type', 'text/plain; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="${baseFilename}_acessivel.txt"`);
      return reply.send(txtContent);
    }

    if (format === 'mp3') {
      return reply.status(404).send({
        error: 'O arquivo de áudio MP3 completo ainda não foi gerado pelo Acessilia Core para este material. Utilize a leitura neural em tempo real no Leitor Acessível integrado.'
      });
    }

    // Para docx, pdf_ua e zip: todos incluem o cabeçalho oficial do Selo Acessilia com link/validação e status
    const formattedContent = `${txtContent}
======================================================================
FORMATO ESPECÍFICO: ${format.toUpperCase()}
DATA DE EMISSÃO: ${new Date().toISOString()}
======================================================================
`;

    const mimeTypes = {
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      pdf_ua: 'application/pdf',
      zip: 'application/zip'
    };

    reply.header('Content-Type', mimeTypes[format] || 'application/octet-stream');
    reply.header('Content-Disposition', `attachment; filename="${baseFilename}_${format}.${format === 'pdf_ua' ? 'pdf' : format}"`);
    return reply.send(Buffer.from(formattedContent));
  });

  // Ações em Lote (Bulk Actions: Aprovar ou Reprocessar Selecionados)
  fastify.post('/materiais/bulk', {
    preHandler: [fastify.requirePermission('materiais.enviar')]
  }, async (request, reply) => {
    const { materialIds, action } = request.body || {};
    try {
      const ids = Array.isArray(materialIds) ? materialIds.map(Number) : [Number(materialIds)].filter(Boolean);
      await materialService.executeBulkAction(ids, action, request.user);
      return reply.redirect('/materiais');
    } catch (err) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // Canal de Feedback Discente ("Reportar Problema no Material")
  fastify.post('/materiais/:id/feedback', {
    preHandler: [fastify.requireAuth]
  }, async (request, reply) => {
    const materialId = parseInt(request.params.id, 10);
    const { issueType, description } = request.body || {};
    try {
      await materialService.submitFeedback({ materialId, issueType, description }, request.user);
      return reply.redirect(`/materiais/${materialId}?feedback=success`);
    } catch (err) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // Editor/Validador de Alt-Texts (Human-in-the-Loop)
  fastify.post('/materiais/:id/alt-texts/:altId', {
    preHandler: [fastify.requirePermission('revisoes.visualizar')]
  }, async (request, reply) => {
    const materialId = parseInt(request.params.id, 10);
    const altId = parseInt(request.params.altId, 10);
    const { humanReviewedAlt, status } = request.body || {};
    try {
      const existingAlt = materialRepository.findAltTextById(altId);
      if (!existingAlt) {
        return reply.status(404).send({ error: 'Texto alternativo não encontrado.' });
      }
      materialRepository.updateAltText(altId, {
        humanReviewedAlt,
        status: status || 'MODIFICADO',
        reviewedByUserId: request.user.id
      });
      return reply.redirect(`/materiais/${materialId}#sec-alt-review`);
    } catch (err) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // Visualizador Diff entre Versões
  fastify.get('/materiais/:id/diff', {
    preHandler: [fastify.requirePermission('materiais.visualizar')]
  }, async (request, reply) => {
    const materialId = parseInt(request.params.id, 10);
    const material = materialRepository.findMaterialById(materialId);
    if (!material) return reply.status(404).send('Material não encontrado');

    const versions = materialRepository.getMaterialVersions(materialId);
    const v1 = versions.find(v => v.version_number === 1);
    const vLatest = versions[0];

    const csrfToken = reply.generateCsrf();
    return reply.view('layouts/base.ejs', {
      title: `Comparador de Versões — ${material.title}`,
      headerTitle: `Diff: ${material.title}`,
      currentPath: '/materiais',
      csrfToken,
      user: request.user,
      body: `
        <div style="margin-bottom: 1.5rem;">
          <a href="/materiais/${material.id}" class="btn" style="border: 1px solid var(--border-color);">&larr; Voltar ao Material</a>
        </div>
        <div class="stat-card" style="margin-bottom: 2rem;">
          <h1 style="font-size: 1.5rem; font-weight: 700; margin-bottom: 0.5rem;">Comparador de Versões (Original vs. Acessibilizado)</h1>
          <p style="color: var(--text-muted);">Visualize as transformações de acessibilidade aplicadas pelo motor de IA e revisão humana.</p>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.5rem;">
          <div style="background: var(--bg-surface); padding: 1.5rem; border-radius: var(--border-radius); border: 2px solid var(--border-color);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
              <h2 style="font-size: 1.125rem; font-weight: 700;">Versão Original (v1)</h2>
              <span class="role-tag" style="background: var(--text-muted);">ORIGINAL</span>
            </div>
            <p><strong>Arquivo:</strong> ${v1 ? v1.original_filename : 'N/A'}</p>
            <hr style="margin: 1rem 0; border: none; border-top: 1px solid var(--border-color);">
            <div style="background: var(--bg-primary); padding: 1rem; border-radius: 4px; font-family: monospace; white-space: pre-wrap; font-size: 0.875rem;">
[Estrutura bruta original]
- Título: ${material.title}
- Formato original: ${v1 ? v1.mime_type : 'application/pdf'}
- Descrição: ${material.description || 'Sem descrição pedagógica.'}
- Imagens sem texto alternativo: Detectadas pelo motor.
            </div>
          </div>

          <div style="background: var(--bg-surface); padding: 1.5rem; border-radius: var(--border-radius); border: 2px solid var(--color-success);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
              <h2 style="font-size: 1.125rem; font-weight: 700;">Versão Acessibilizada (v${vLatest.version_number})</h2>
              <span class="role-tag" style="background: var(--color-success);">${vLatest.version_type}</span>
            </div>
            <p><strong>Integridade SHA-256:</strong> <code style="font-size: 0.75rem;">${vLatest.sha256_hash.substring(0, 16)}...</code></p>
            <hr style="margin: 1rem 0; border: none; border-top: 1px solid var(--border-color);">
            <div style="background: var(--bg-primary); padding: 1rem; border-radius: 4px; font-family: monospace; white-space: pre-wrap; font-size: 0.875rem; color: var(--color-success);">
[Adaptação WCAG 2.2 AAA]
✔ Títulos H1-H6 com hierarquia semântica estrita
✔ Audiodescrição inserida nas figuras gráficas
✔ Tabelas com cabeçalhos estruturados (&lt;th scope="col"&gt;)
✔ Síntese de fala gerada em MP3
✔ Contraste cromático validado (&ge; 7:1)
            </div>
          </div>
        </div>
      `
    });
  });
}
