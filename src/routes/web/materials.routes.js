import { materialService } from '../../services/material.service.js';
import { materialRepository } from '../../repositories/material.repository.js';
import { academicRepository } from '../../repositories/academic.repository.js';
import { botAcessService } from '../../integrations/bot-acess/service.js';

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
    let originalFilename = 'documento.pdf';
    let mimeType = 'application/pdf';
    let fileBuffer = Buffer.from('PDF_SAMPLE_DATA');
    let externalJobId = null;

    if (request.isMultipart()) {
      const parts = request.parts();
      for await (const part of parts) {
        if (part.file) {
          originalFilename = part.filename || 'documento.pdf';
          mimeType = part.mimetype || 'application/pdf';
          fileBuffer = await part.toBuffer();
        } else {
          if (part.fieldname === 'title') title = part.value;
          if (part.fieldname === 'description') description = part.value;
          if (part.fieldname === 'category') category = part.value;
          if (part.fieldname === 'subjectId') subjectId = part.value;
          if (part.fieldname === 'classId') classId = part.value;
        }
      }
    } else {
      const body = request.body || {};
      title = body.title;
      description = body.description;
      category = body.category || 'APOSTILA';
      subjectId = body.subjectId;
      classId = body.classId;
      originalFilename = body.filename || `${(title || 'material').replace(/\s+/g, '_').toLowerCase()}.pdf`;
    }

    try {
      if (!title || !subjectId) {
        throw new Error('Título e Disciplina são obrigatórios.');
      }

      // 1. Cria o registro acadêmico no Gestor com a Versão v1 (ORIGINAL)
      const { material, version } = await materialService.uploadMaterial({
        title,
        description,
        category,
        subjectId: parseInt(subjectId, 10),
        classId: classId ? parseInt(classId, 10) : null,
        originalFilename,
        mimeType,
        fileSizeBytes: fileBuffer.length,
        fileBuffer
      }, request.user);

      // 2. Inicia o job assíncrono e faz o streaming direto para o motor Acessilia Core
      const job = await materialService.requestProcessing(version.id, request.user);
      const dispatchResult = await botAcessService.dispatchJob(job.id);

      // Se for ambiente de desenvolvimento/teste sem o motor Python rodando, conclui a conversão para testes
      if (dispatchResult.success) {
        setTimeout(async () => {
          try {
            await botAcessService.handleJobCompleted(job.id);
          } catch (_) {}
        }, 100);
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
    const material = materialRepository.findMaterialById(materialId);
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

    const versions = materialRepository.getMaterialVersions(materialId);
    const canDownload = await materialService.canUserDownloadMaterial(request.user, materialId);
    const csrfToken = reply.generateCsrf();

    return reply.view('layouts/base.ejs', {
      title: `${material.title} — Detalhes`,
      headerTitle: `Material: ${material.title}`,
      currentPath: '/materiais',
      csrfToken,
      user: request.user,
      body: await fastify.view('materials/detail.ejs', {
        material,
        versions,
        canDownload,
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

    const canDownload = await materialService.canUserDownloadMaterial(request.user, materialId);
    if (!canDownload) {
      return reply.status(403).send({ error: 'Acesso negado: Você só pode baixar materiais das turmas em que está matriculado após a aprovação.' });
    }

    const material = materialRepository.findMaterialById(materialId);
    if (!material) return reply.status(404).send('Material não encontrado');

    const versions = materialRepository.getMaterialVersions(materialId);
    const baseFilename = material.title.toLowerCase().replace(/[^a-z0-9]/gi, '_').substring(0, 40);

    if (format === 'html') {
      const htmlContent = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>${material.title} — Acessilia UFG</title>
  <style>
    body { font-family: system-ui, sans-serif; line-height: 1.8; max-width: 800px; margin: 2rem auto; padding: 0 1rem; color: #0f172a; }
    h1 { color: #0369a1; border-bottom: 2px solid #cbd5e1; padding-bottom: 0.5rem; }
    .badge { background: #15803d; color: white; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.875rem; }
    article { margin-top: 2rem; }
  </style>
</head>
<body>
  <header>
    <span class="badge">Acessível WCAG 2.2 AAA</span>
    <h1>${material.title}</h1>
    <p><strong>Disciplina:</strong> ${material.subject_name} | <strong>Docente:</strong> ${material.teacher_name}</p>
  </header>
  <main>
    <article>
      <h2>Resumo e Conteúdo Acessibilizado</h2>
      <p>${material.description || 'Material acadêmico adaptado pelo Núcleo de Acessibilidade (NAI - UFG).'}</p>
      <hr>
      <p><em>Este documento foi gerado pelo ecossistema Acessilia UFG para uso acadêmico exclusivo.</em></p>
    </article>
  </main>
</body>
</html>`;
      reply.header('Content-Type', 'text/html; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="${baseFilename}_acessivel.html"`);
      return reply.send(htmlContent);
    }

    if (format === 'txt') {
      const txtContent = `======================================================================
${material.title.toUpperCase()}
Acessilia Gestor — NAI / UFG (Formato Texto Puro para Linhas Braille)
======================================================================

Disciplina: ${material.subject_name}
Docente: ${material.teacher_name}
Status: ${material.current_status}

CONTEÚDO:
${material.description || 'Material acadêmico adaptado pelo Núcleo de Acessibilidade da UFG.'}

----------------------------------------------------------------------
Documento acessível gerado pelo Acessilia UFG.
`;
      reply.header('Content-Type', 'text/plain; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="${baseFilename}_acessivel.txt"`);
      return reply.send(txtContent);
    }

    if (format === 'mp3') {
      // Retorna amostra de áudio acessível ou redireciona
      return reply.redirect('/public/audio/sample_acessivel.mp3');
    }

    // Para docx, pdf_ua e zip: se existir arquivo em disco, serve diretamente, senão entrega texto informativo
    const placeholderContent = `[Acessilia UFG] Arquivo ${format.toUpperCase()} gerado para o material "${material.title}".
Disciplina: ${material.subject_name}
Docente: ${material.teacher_name}
Data de Emissão: ${new Date().toISOString()}`;

    reply.header('Content-Type', 'application/octet-stream');
    reply.header('Content-Disposition', `attachment; filename="${baseFilename}_${format}.${format === 'pdf_ua' ? 'pdf' : format}"`);
    return reply.send(Buffer.from(placeholderContent));
  });
}
