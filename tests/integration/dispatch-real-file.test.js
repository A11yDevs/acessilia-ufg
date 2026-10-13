import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app.js';
import { academicService } from '../../src/services/academic.service.js';
import { materialService } from '../../src/services/material.service.js';
import { botAcessService } from '../../src/integrations/bot-acess/service.js';
import { botAcessClient } from '../../src/integrations/bot-acess/client.js';

// Regressão: o arquivo enviado pelo professor precisa chegar inteiro ao Core.
// storage_path é gravado como '/uploads/<arquivo>' (relativo à raiz do projeto);
// tratá-lo como caminho absoluto fazia o envio falhar sempre.
test('Envio ao Core usa o arquivo real gravado em disco', async (t) => {
  const app = await buildApp({ logger: false });
  const adminActor = { id: 1, roleCode: 'ADMINISTRADOR' };
  const teacherActor = { id: 2, roleCode: 'PROFESSOR' };
  const suffix = Date.now();

  const subject = await academicService.createSubject({
    departmentId: 1,
    code: `ENV-${suffix}`,
    name: 'Disciplina de Teste de Envio',
    workloadHours: 60
  }, adminActor);

  const content = Buffer.from(`CONTEUDO_REAL_DO_ARQUIVO_${suffix}`);
  const { version } = await materialService.uploadMaterial({
    subjectId: subject.id,
    title: 'Material para teste de envio ao Core',
    category: 'APOSTILA',
    originalFilename: 'envio_real.pdf',
    mimeType: 'application/pdf',
    fileSizeBytes: content.length,
    fileBuffer: content
  }, teacherActor);

  assert.ok(version.storage_path.startsWith('/uploads/'), 'storage_path relativo à raiz do projeto');

  const original = botAcessClient.sendDocumentForProcessing;
  let received = null;
  botAcessClient.sendDocumentForProcessing = async (args) => {
    received = args;
    return { success: true, externalJobId: `ext_acessilia_teste_${suffix}`, status: 'QUEUED' };
  };
  t.after(async () => {
    botAcessClient.sendDocumentForProcessing = original;
    await app.close();
  });

  const job = await materialService.requestProcessing(version.id, teacherActor);
  const result = await botAcessService.dispatchJob(job.id);

  assert.equal(result.success, true);
  assert.ok(received, 'o cliente do Core deve ser chamado');
  assert.ok(Buffer.isBuffer(received.fileBuffer), 'o conteúdo do arquivo deve ser enviado');
  assert.equal(received.fileBuffer.toString(), content.toString(), 'o Core recebe exatamente o arquivo enviado');
  assert.equal(received.filename, 'envio_real.pdf');
});
