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
        user: request.user,
        csrfToken
      })
    });
  });

  // Upload de Novo Material (v1 Original)
  fastify.post('/materiais', {
    preHandler: [fastify.requirePermission('materiais.enviar'), fastify.csrfProtection]
  }, async (request, reply) => {
    const { title, description, category, subjectId, filename } = request.body || {};
    try {
      const { material, version } = await materialService.uploadMaterial({
        title,
        description,
        category,
        subjectId: parseInt(subjectId, 10),
        originalFilename: filename || `${title.replace(/\s+/g, '_').toLowerCase()}.pdf`,
        mimeType: 'application/pdf',
        fileSizeBytes: 204800, // Simulação de 200KB
        fileBuffer: Buffer.from('PDF_SAMPLE_DATA')
      }, request.user);

      // Inicia imediatamente o job assíncrono para o bot-acess
      const job = await materialService.requestProcessing(version.id, request.user);
      await botAcessService.dispatchJob(job.id);

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
}
