import { test, describe } from 'node:test';
import assert from 'node:assert';
import { parseAcessiliaMetadata, enhanceAccessibleHtml } from '../../src/utils/meta-parser.js';

describe('Parser de Metadados e Audiodescrição do Acessilia Core', () => {
  test('1. Deve extrair metadados técnicos de <aside class="meta"> com sintaxe de dicionário Python do Core', () => {
    const sampleHtml = `
      <html>
        <body>
          <main>
            <p>Parágrafo de conteúdo acadêmico.</p>
            <aside class="meta">
              <h2>Metadados técnicos</h2>
              <p>{'pipeline_engine': 'pddl', 'pddl_manifest_id': 'manifest-test-123', 'pddl_execution_status': 'completed', 'page_count': 3, 'pages': [{'page_number': 1, 'text': 'Texto 1', 'blocks': [{'id': 'element-000001', 'type': 'image', 'alt_text': 'Logo do CEIA', 'metadata': {'raw_label': 'picture'}}]}]}</p>
            </aside>
          </main>
        </body>
      </html>
    `;

    const meta = parseAcessiliaMetadata(sampleHtml);
    assert.ok(meta !== null, 'Metadados não devem ser nulos');
    assert.strictEqual(meta.pipelineEngine, 'pddl');
    assert.strictEqual(meta.manifestId, 'manifest-test-123');
    assert.strictEqual(meta.pageCount, 3);
    assert.strictEqual(meta.imagesCount, 1);
    assert.strictEqual(meta.hasDoclingMeta, true);
  });

  test('2. Deve transformar <figure><img alt="..." src=""></figure> em Card de Audiodescrição visual acessível', () => {
    const rawHtml = `
      <figure id="element-000024">
        <img alt="Descrição detalhada do logotipo da universidade em alto contraste." src="">
      </figure>
    `;

    const enhanced = enhanceAccessibleHtml(rawHtml);
    assert.ok(enhanced.includes('class="a11y-audiodesc-card"'), 'Deve conter a classe do card de audiodescrição');
    assert.ok(enhanced.includes('Audiodescrição de Imagem Original'), 'Deve conter o título da audiodescrição');
    assert.ok(enhanced.includes('Descrição detalhada do logotipo da universidade em alto contraste.'), 'Deve conter o texto do alt visível');
    assert.ok(enhanced.includes('btn-a11y-speak'), 'Deve conter botão de reprodução em voz alta');
    assert.ok(enhanced.includes('aria-label="Audiodescrição de elemento visual"'), 'Deve manter semântica ARIA para leitor de tela');
  });

  test('3. Deve retornar null graciosamente quando não houver <aside class="meta">', () => {
    const plainHtml = '<html><body><h1>Sem metadados</h1></body></html>';
    const meta = parseAcessiliaMetadata(plainHtml);
    assert.strictEqual(meta, null);
  });
});
