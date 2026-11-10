import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { buildApp } from '../../src/app.js';
import { authService } from '../../src/services/auth.service.js';
import { academicService } from '../../src/services/academic.service.js';
import { materialService } from '../../src/services/material.service.js';
import { materialRepository } from '../../src/repositories/material.repository.js';
import { botAcessService } from '../../src/integrations/bot-acess/service.js';
import { botAcessClient, CORE_RATE_LIMIT_MESSAGE } from '../../src/integrations/bot-acess/client.js';
import { resolveStoragePath } from '../../src/services/processed-document.service.js';

// Achados da noite de 07/11 (confirmados no navegador): categoria AVALIACAO recusada,
// reprocessamento que não criava job e limite de envios do Core (429) gravado como
// "Core indisponível".
test('Reprocessamento, categoria Avaliação e limite de envios do Core (429)', async (t) => {
  const admin = { id: 1, roleCode: 'ADMINISTRADOR', name: 'Administrador UFG' };
  const teacher = { id: 2, roleCode: 'PROFESSOR', name: 'Prof. Carlos' };
  const suffix = Date.now();
  const created = [];
  t.after(() => created.forEach(f => f && fs.rmSync(f, { force: true })));

  const subject = await academicService.createSubject({
    departmentId: 1, code: `REP-${suffix}`, name: 'Disciplina de Teste de Reprocessamento', workloadHours: 60
  }, admin);

  async function newMaterial(label, category = 'APOSTILA') {
    const result = await materialService.uploadMaterial({
      subjectId: subject.id, title: `Material ${label} ${suffix}`, category,
      originalFilename: `${label}.pdf`, mimeType: 'application/pdf', fileSizeBytes: 9, fileBuffer: Buffer.from('%PDF-1.4 x')
    }, teacher);
    created.push(resolveStoragePath(result.version.storage_path));
    return result;
  }

  async function failedMaterial(label) {
    const { material, version } = await newMaterial(label);
    const job = await materialService.requestProcessing(version.id, teacher);
    materialRepository.updateProcessingJobStatus(job.id, 'FAILED', { errorMessage: 'falha simulada' });
    materialRepository.updateMaterialStatus(material.id, 'FALHA_PROCESSAMENTO');
    return { material, version, job };
  }

  const jobsOf = (versionId) => materialRepository.countProcessingJobsForVersion(versionId);

  await t.test('1. Categoria "Avaliação / Prova" (AVALIACAO) é aceita no envio', async () => {
    const { material } = await newMaterial('avaliacao', 'AVALIACAO');
    assert.equal(materialRepository.findMaterialById(material.id).category, 'AVALIACAO');
  });

  await t.test('2. Reprocessar cria um job novo e o despacha (não fica parado em AGUARDANDO_PROCESSAMENTO)', async () => {
    const { material, version, job } = await failedMaterial('reproc');
    assert.equal(jobsOf(version.id), 1);

    // "reprocess" minúsculo era o valor enviado pelo aviso de falha
    const res = await materialService.executeBulkAction([material.id], 'reprocess', admin);
    assert.equal(res.affected, 1);
    assert.equal(jobsOf(version.id), 2, 'deve existir um job novo para a mesma versão original');

    const active = materialRepository.findActiveJobForMaterial(material.id);
    assert.notEqual(active.id, job.id);
    assert.equal(active.status, 'PROCESSING');
    assert.ok(active.external_job_id, 'o job novo foi enviado ao Core');
    assert.equal(materialRepository.findMaterialById(material.id).current_status, 'PROCESSANDO');

    // Clicar de novo enquanto o job está no Core não cria outro envio
    const again = await materialService.executeBulkAction([material.id], 'REPROCESS', admin);
    assert.equal(again.results[0].alreadyActive, true);
    assert.equal(jobsOf(version.id), 2);
  });

  await t.test('3. Reprocessar material já convertido gera a v3 (sem colidir com a v2)', async () => {
    const { material, version } = await newMaterial('reconverter');
    const first = await materialService.requestProcessing(version.id, teacher);
    await botAcessService.dispatchJob(first.id);
    await botAcessService.handleJobCompleted(first.id);

    await materialService.executeBulkAction([material.id], 'REPROCESS', admin);
    const second = materialRepository.findActiveJobForMaterial(material.id);
    await botAcessService.handleJobCompleted(second.id);

    const numbers = materialRepository.getMaterialVersions(material.id).map(v => v.version_number);
    assert.deepEqual(numbers, [3, 2, 1]);
    assert.equal(materialRepository.findMaterialById(material.id).current_status, 'AGUARDANDO_REVISAO');
  });

  const app = await buildApp({ logger: false });
  t.after(() => app.close());
  const user = await authService.authenticate('admin@acessilia.ufg.br', 'Temp@123456');
  // Sessão de verdade (como no login): a rota de ações em lote exige o token CSRF dela
  app.addHook('onRequest', async (req) => {
    req.user = user;
    req.session.set('user', user);
  });

  await t.test('4. Botão "Reprocessar Material" do aviso de falha funciona e volta para o material', async () => {
    const { material, version } = await failedMaterial('botao');
    const page = await app.inject({ method: 'GET', url: `/materiais/${material.id}` });
    assert.match(page.payload, /name="action" value="REPROCESS"/);
    const csrf = page.payload.match(/action="\/materiais\/bulk"[\s\S]*?name="_csrf" value="([^"]+)"/)[1];
    const cookie = page.cookies.map(c => `${c.name}=${c.value}`).join('; ');

    // Sem o token CSRF do formulário, nada é feito
    const forged = await app.inject({
      method: 'POST', url: '/materiais/bulk', headers: { cookie },
      payload: { materialIds: String(material.id), action: 'REPROCESS', returnTo: 'detalhe' }
    });
    assert.equal(forged.statusCode, 403);
    assert.equal(jobsOf(version.id), 1);

    const res = await app.inject({
      method: 'POST',
      url: '/materiais/bulk',
      headers: { cookie },
      payload: { materialIds: String(material.id), action: 'REPROCESS', returnTo: 'detalhe', _csrf: csrf }
    });
    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.location, `/materiais/${material.id}`);
    assert.equal(jobsOf(version.id), 2);
  });

  // Core mínimo que responde 429 (limite por minuto), como o slowapi do Core real
  let jobPosts = 0;
  let rejectFirst = 0;
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/v1/jobs') {
      req.resume();
      jobPosts++;
      if (jobPosts <= rejectFirst) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ detail: 'Rate limit exceeded: 5 per 1 minute' }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ task_id: `task${jobPosts}_${suffix}`, position: 1 }));
    }
    if (req.url === `/api/v1/download/tok${suffix}/docx`) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ detail: 'Rate limit exceeded: 20 per 1 minute' }));
    }
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

  // O atalho de simulação do cliente só vale com NODE_ENV=test; aqui a conversa HTTP é real
  const previous = { env: process.env.NODE_ENV, base: botAcessClient.baseUrl, delays: botAcessClient.rateLimitRetryDelaysMs };
  process.env.NODE_ENV = 'development';
  botAcessClient.baseUrl = `http://127.0.0.1:${server.address().port}`;
  botAcessClient.rateLimitRetryDelaysMs = [10, 10];
  t.after(() => {
    process.env.NODE_ENV = previous.env;
    botAcessClient.baseUrl = previous.base;
    botAcessClient.rateLimitRetryDelaysMs = previous.delays;
    server.close();
  });

  await t.test('5. 429 no envio: tenta de novo após espera curta e consegue', async () => {
    jobPosts = 0; rejectFirst = 2;
    const res = await botAcessClient.sendDocumentForProcessing({ jobId: 1, fileBuffer: Buffer.from('%PDF') });
    assert.equal(res.success, true);
    assert.equal(jobPosts, 3, '2 recusas + 1 envio aceito');
  });

  await t.test('6. 429 persistente: falha com a mensagem verdadeira, mostrada ao professor', async () => {
    jobPosts = 0; rejectFirst = 99;
    const { material, version } = await failedMaterial('limite');
    const res = await materialService.executeBulkAction([material.id], 'REPROCESS', admin);
    assert.equal(res.affected, 0);
    assert.equal(res.results[0].rateLimited, true);
    assert.equal(jobPosts, 3, 'poucas tentativas (1 + 2)');

    const lastJob = materialRepository.findLatestJobForMaterial(material.id);
    assert.equal(lastJob.status, 'FAILED');
    assert.equal(lastJob.error_message, CORE_RATE_LIMIT_MESSAGE);
    assert.doesNotMatch(lastJob.error_message, /indisponível/);
    assert.equal(jobsOf(version.id), 2);

    const page = await app.inject({ method: 'GET', url: `/materiais/${material.id}` });
    assert.match(page.payload, /muitos envios ao mesmo tempo; tente reprocessar em 1 minuto/);
  });

  await t.test('7. 429 no download do Core vira 503 com Retry-After e aviso de espera', async () => {
    const { material, version } = await newMaterial('download');
    const job = await materialService.requestProcessing(version.id, teacher);
    materialRepository.updateProcessingJobStatus(job.id, 'PROCESSING', { externalJobId: `dl${suffix}` });
    const downloadUrl = `https://core.exemplo/download/tok${suffix}`;
    await botAcessService.handleJobCompleted(job.id, { status: 'COMPLETED', downloadUrl, processedDocumentUrl: downloadUrl });

    const file = await botAcessClient.fetchProcessedFile(`tok${suffix}`, 'docx');
    assert.equal(file.rateLimited, true);

    const res = await app.inject({ method: 'GET', url: `/materiais/${material.id}/download?format=docx` });
    assert.equal(res.statusCode, 503);
    assert.equal(res.headers['retry-after'], '60');
    assert.match(res.json().error, /tente novamente em 1 minuto/);
  });
});
