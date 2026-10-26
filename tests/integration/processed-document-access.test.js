import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { buildApp } from '../../src/app.js';
import { academicService } from '../../src/services/academic.service.js';
import { materialService } from '../../src/services/material.service.js';
import { materialRepository } from '../../src/repositories/material.repository.js';
import { botAcessService } from '../../src/integrations/bot-acess/service.js';
import { botAcessClient } from '../../src/integrations/bot-acess/client.js';
import { loadProcessedHtml, resolveStoragePath } from '../../src/services/processed-document.service.js';

// O documento processado pelo Core precisa chegar ao aluno: no leitor, na voz e nos
// downloads. storage_path '/uploads/...' é relativo à raiz do projeto, não do disco.
test('Documento processado: leitor, voz e downloads usam o HTML do Core', async (t) => {
  const admin = { id: 1, roleCode: 'ADMINISTRADOR', name: 'Administrador UFG' };
  const teacher = { id: 2, roleCode: 'PROFESSOR', name: 'Prof. Carlos' };
  const suffix = Date.now();
  const uploads = path.resolve(process.cwd(), 'uploads');
  fs.mkdirSync(uploads, { recursive: true });
  const created = [];
  t.after(() => created.forEach(f => fs.rmSync(f, { force: true })));

  const subject = await academicService.createSubject({
    departmentId: 1, code: `DOC-${suffix}`, name: 'Disciplina de Teste do Leitor', workloadHours: 60
  }, admin);

  async function processedMaterial(label) {
    const { material, version } = await materialService.uploadMaterial({
      subjectId: subject.id, title: `Material ${label}`, category: 'APOSTILA',
      originalFilename: `${label}.pdf`, mimeType: 'application/pdf', fileSizeBytes: 9, fileBuffer: Buffer.from('%PDF-1.4 x')
    }, teacher);
    created.push(resolveStoragePath(version.storage_path));
    const job = await materialService.requestProcessing(version.id, teacher);
    materialRepository.updateProcessingJobStatus(job.id, 'PROCESSING', { externalJobId: `job${label}${suffix}` });
    return { material, job };
  }

  await t.test('1. resolveStoragePath lê /uploads/... a partir da raiz do projeto', () => {
    const file = path.join(uploads, `qa_resolve_${suffix}.html`);
    fs.writeFileSync(file, '<p>ok</p>'); created.push(file);
    assert.equal(resolveStoragePath(`/uploads/qa_resolve_${suffix}.html`), file);
    assert.equal(resolveStoragePath('https://core.exemplo/download/tok'), null);
    assert.equal(resolveStoragePath('/uploads/nao-existe.html'), null);
  });

  // Core mínimo: entrega o HTML processado pelo token do download_url
  const coreHtml = `<!doctype html><html><body><h1>Capítulo 2</h1><p>Consumo de água ${suffix}</p>`
    + '<table><tr><td>Fevereiro</td><td>135</td></tr></table></body></html>';
  const server = http.createServer((req, res) => {
    if (req.url === `/api/v1/download/tok${suffix}/html`) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(coreHtml);
    }
    if (req.url === `/api/v1/download/tok${suffix}/docx`) {
      res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      return res.end(Buffer.from('PK-docx-real'));
    }
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const previousBase = botAcessClient.baseUrl;
  botAcessClient.baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(() => { botAcessClient.baseUrl = previousBase; server.close(); });

  let material;
  await t.test('2. Conclusão guarda o link do Core e uma cópia local que o leitor encontra', async () => {
    const made = await processedMaterial('core');
    material = made.material;
    const downloadUrl = `https://core.exemplo/download/tok${suffix}`;
    await botAcessService.handleJobCompleted(made.job.id, { status: 'COMPLETED', downloadUrl, processedDocumentUrl: downloadUrl });
    created.push(path.join(uploads, `accessible_jobcore${suffix}.html`));

    const processed = materialRepository.getMaterialVersions(material.id).find(v => v.version_type === 'PROCESSADO_BOT');
    assert.equal(processed.storage_path, downloadUrl, 'storage_path mantém o download_url do Core');

    botAcessClient.baseUrl = 'http://127.0.0.1:9';   // Core fora do ar: tem que vir da cópia local
    const html = await loadProcessedHtml(processed);
    botAcessClient.baseUrl = `http://127.0.0.1:${server.address().port}`;
    assert.match(html, new RegExp(`Consumo de água ${suffix}`));
  });

  const app = await buildApp({ logger: false });
  t.after(() => app.close());
  const adminWithPerms = { ...admin, permissions: ['materiais.visualizar', 'materiais.enviar'] };
  app.addHook('preHandler', async (req) => {
    req.user = adminWithPerms;
    req.session = { get: () => adminWithPerms };
  });

  await t.test('3. Download HTML e TXT trazem o conteúdo; DOCX vem do Core', async () => {
    const html = await app.inject({ method: 'GET', url: `/materiais/${material.id}/download?format=html` });
    assert.equal(html.statusCode, 200);
    assert.match(html.payload, new RegExp(`Consumo de água ${suffix}`));

    const docx = await app.inject({ method: 'GET', url: `/materiais/${material.id}/download?format=docx` });
    assert.equal(docx.statusCode, 200);
    assert.equal(docx.rawPayload.toString(), 'PK-docx-real');
  });

  await t.test('4. Material antigo (cópia local, sem link do Core) não recebe arquivo inventado', async () => {
    const { material: legacy, job } = await processedMaterial('legado');
    const file = path.join(uploads, `accessible_legado_${suffix}.html`);
    fs.writeFileSync(file, coreHtml); created.push(file);
    await botAcessService.handleJobCompleted(job.id, { status: 'COMPLETED', processedDocumentUrl: `/uploads/accessible_legado_${suffix}.html` });

    const html = await app.inject({ method: 'GET', url: `/materiais/${legacy.id}/download?format=html` });
    assert.match(html.payload, new RegExp(`Consumo de água ${suffix}`));
    const txt = await app.inject({ method: 'GET', url: `/materiais/${legacy.id}/download?format=txt` });
    assert.match(txt.payload, /Fevereiro/);
    const pdf = await app.inject({ method: 'GET', url: `/materiais/${legacy.id}/download?format=pdf_ua` });
    assert.equal(pdf.statusCode, 404);
  });

  await t.test('5. Trechos da leitura em voz alta vêm do documento, não só do título', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/materials/${material.id}/tts/chunks` });
    assert.equal(res.statusCode, 200);
    const texts = res.json().chunks.map(c => c.text).join(' ');
    assert.match(texts, new RegExp(`Consumo de água ${suffix}`));
  });
});
