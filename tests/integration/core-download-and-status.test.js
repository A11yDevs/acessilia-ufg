import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { BotAcessClient } from '../../src/integrations/bot-acess/client.js';

// Um Core mínimo, com o mesmo contrato do Acessilia Core real
// (backend/api/routes/jobs.py e download.py): status em minúsculas e
// arquivo servido em /api/v1/download/{token}/{format}.
function startStubCore(jobs) {
  const server = http.createServer((req, res) => {
    const job = req.url.match(/^\/api\/v1\/jobs\/([^/]+)$/);
    const file = req.url.match(/^\/api\/v1\/download\/([^/]+)\/([^/]+)$/);
    if (job && jobs[job[1]]) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ task_id: job[1], arquivo: 'aula.pdf', progresso: 1, etapa_atual: '', erros: [], ...jobs[job[1]] }));
    }
    if (file && file[1] === 'tok123' && file[2] === 'pdf') {
      res.writeHead(200, { 'Content-Type': 'application/pdf' });
      return res.end(Buffer.from('%PDF-1.7 conteudo real'));
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ detail: 'not found' }));
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

test('Cliente do Core: status reais e download do arquivo processado', async (t) => {
  const server = await startStubCore({
    'job-done': { status: 'done', download_url: 'https://core.exemplo/download/tok123' },
    'job-error': { status: 'error', erros: ['timeout no modelo'] },
    'job-cancelled': { status: 'cancelled' },
    'job-running': { status: 'processing', progresso: 0.4 }
  });
  const client = new BotAcessClient(`http://127.0.0.1:${server.address().port}`, '');

  // O atalho de simulação do cliente só vale em ambiente de teste; aqui o
  // objetivo é exercitar a conversa HTTP de verdade.
  const previousEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  t.after(() => {
    process.env.NODE_ENV = previousEnv;
    server.close();
  });

  await t.test('1. "done" (minúsculo) é reconhecido como concluído e traz o download_url', async () => {
    const res = await client.checkJobStatus('job-done');
    assert.equal(res.status, 'COMPLETED');
    assert.equal(res.processedDocumentUrl, 'https://core.exemplo/download/tok123');
  });

  await t.test('2. "error" e "cancelled" são falha, com a mensagem do Core', async () => {
    const failed = await client.checkJobStatus('job-error');
    assert.equal(failed.status, 'FAILED');
    assert.match(failed.error, /timeout no modelo/);
    assert.equal((await client.checkJobStatus('job-cancelled')).status, 'FAILED');
  });

  await t.test('3. "processing" continua em processamento', async () => {
    assert.equal((await client.checkJobStatus('job-running')).status, 'PROCESSING');
  });

  await t.test('4. Core sem resposta para o job não é tratado como falha do processamento', async () => {
    const res = await client.checkJobStatus('job-inexistente');
    assert.equal(res.status, 'UNAVAILABLE');
  });

  await t.test('5. Token é extraído do download_url nos dois formatos de URL', () => {
    assert.equal(client.extractDownloadToken('https://core.exemplo/download/tok123'), 'tok123');
    assert.equal(client.extractDownloadToken('/api/v1/download/tok123/html'), 'tok123');
    assert.equal(client.extractDownloadToken('/uploads/accessible_ext_1.html'), null);
    assert.equal(client.extractDownloadToken(null), null);
  });

  await t.test('6. Arquivo processado vem do Core com o conteúdo e o tipo originais', async () => {
    const file = await client.fetchProcessedFile('tok123', 'pdf');
    assert.equal(file.ok, true);
    assert.equal(file.contentType, 'application/pdf');
    assert.equal(file.buffer.toString(), '%PDF-1.7 conteudo real');
  });

  await t.test('7. Formato inexistente no Core devolve 404, sem conteúdo inventado', async () => {
    const file = await client.fetchProcessedFile('tok123', 'docx');
    assert.equal(file.ok, false);
    assert.equal(file.status, 404);
  });
});
