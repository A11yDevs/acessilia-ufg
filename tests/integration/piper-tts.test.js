import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app.js';
import { authService } from '../../src/services/auth.service.js';
import { piperTtsService } from '../../src/services/piper-tts.service.js';
import { materialRepository } from '../../src/repositories/material.repository.js';

test('Integração Piper-TTS Local: Chunks, Padrão CSS Speech, Léxicos de Pronúncia e Síntese Imune a Proxy', async (t) => {
  const app = await buildApp({ logger: false });
  const admin = await authService.authenticate('admin@acessilia.ufg.br', 'Temp@123456');

  app.addHook('preHandler', async (req) => {
    req.user = admin;
    req.session = { get: () => admin };
  });

  await t.test('1. Léxico de Pronúncia: substitui siglas e numerais por formas fonéticas adequadas', () => {
    const raw = 'O aluno da UFG e do NAI usou a Acessilia para ler a LBI e o Capítulo I.';
    const adapted = piperTtsService.applyPronunciationLexicon(raw);

    assert.match(adapted, /U, F, G/);
    assert.match(adapted, /Nai/);
    assert.match(adapted, /Acessília/);
    assert.match(adapted, /Lei Brasileira de Inclusão/);
    assert.match(adapted, /Capítulo Primeiro/i);
  });

  await t.test('2. Padrão CSS Speech e Chunking: ignora elementos decorativos, expande abreviações e divide blocos', () => {
    const html = `
      <h1>O que faz o brasil, Brasil?</h1>
      <p class="a11y-ignore-speech">Este aviso não deve ser lido.</p>
      <p aria-hidden="true">Elemento puramente decorativo oculto.</p>
      <aside class="meta"><p>metadados docling ignorados</p></aside>
      <p>A <abbr title="Universidade Federal de Goiás">UFG</abbr> promove inclusão.</p>
      <figure><img src="/img.png" alt="Capa ilustrada do livro"></figure>
    `;

    const chunks = piperTtsService.createChunksFromHtml(html);
    assert.ok(chunks.length >= 3, 'Deve gerar pelo menos 3 chunks semânticos');

    const fullText = chunks.map(c => c.text).join(' ');
    assert.doesNotMatch(fullText, /Este aviso não deve ser lido/);
    assert.doesNotMatch(fullText, /Elemento puramente decorativo/);
    assert.doesNotMatch(fullText, /metadados docling ignorados/);
    assert.match(fullText, /Universidade Federal de Goiás/);
    assert.match(fullText, /Audiodescrição de elemento visual: Capa ilustrada do livro/);
  });

  await t.test('3. Rota /api/v1/materials/:id/tts/chunks responde 200 OK com lista de chunks e vozes Piper', async () => {
    const material = materialRepository.findMaterialById(9) || db.prepare('SELECT * FROM materials LIMIT 1').get();
    assert.ok(material, 'Deve existir ao menos um material no banco');

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/materials/${material.id}/tts/chunks`
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.equal(body.materialId, material.id);
    assert.ok(Array.isArray(body.chunks), 'chunks deve ser um array');
    assert.ok(body.chunks.length > 0, 'deve ter ao menos um chunk');
    assert.ok(Array.isArray(body.voices), 'voices deve ser um array');
    assert.ok(body.voices.some(v => v.id === 'pt_BR-cadu-medium'));
  });

  await t.test('4. Rota /api/v1/tts/synthesize gera áudio WAV Base64 válido e protegido', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tts/synthesize',
      payload: {
        text: 'Acessilia Gestor. Teste de síntese local com Piper.',
        voice: 'pt_BR-cadu-medium',
        rate: 1.0
      }
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.equal(body.format, 'wav');
    assert.ok(body.audio.startsWith('data:audio/wav;base64,'), 'Deve retornar áudio Base64 protegido');
  });
});
