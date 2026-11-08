import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { piperTtsService, parseHtmlTable } from '../../src/services/piper-tts.service.js';

// Trecho do HTML real do Core (material 159, qa_tabela): sumário, título, parágrafo,
// tabela com <td> dentro do <thead> e figura com audiodescrição.
const CORE_HTML = `
<nav class="toc" aria-label="Sumário"><strong>Sumário</strong><ul>
<li class="lvl-1"><a href="#element-000001">Capítulo 2 — Consumo de água no campus</a></li>
</ul></nav>
<h1 id="element-000001">Capítulo 2 — Consumo de água no campus</h1>
<p id="element-000002">O gráfico abaixo mostra o consumo mensal em metros cúbicos.</p>
<table id="element-000003"><thead><tr><td>Mês</td><td>Bloco A</td><td>Bloco B</td></tr></thead><tbody><tr><td>Janeiro</td><td>120</td><td>95</td></tr><tr><td>Fevereiro</td><td>135</td><td>101</td></tr><tr><td>Março</td><td>128</td><td>99</td></tr></tbody></table>
<p id="element-000005">Figura 1 — Consumo mensal por bloco</p>
<figure id="element-000004"><img alt="Gráfico de barras do consumo por bloco." src=""></figure>
<aside class="meta"><h2>Metadados</h2><p>docling</p></aside>
`;

describe('Leitura em voz alta: trechos (chunks) do documento processado', () => {
  const chunks = piperTtsService.createChunksFromHtml(CORE_HTML);
  const texts = chunks.map(c => c.text);

  test('1. O sumário (nav.toc) não é lido; o documento começa pelo título', () => {
    assert.equal(texts.filter(t => /Capítulo 2/.test(t)).length, 1, 'o título aparece uma vez só');
    assert.match(texts[0], /Capítulo 2 — Consumo de água no campus/);
    assert.equal(chunks[0].tag, 'h1');
  });

  test('2. A tabela é lida linha a linha, com o cabeçalho de cada coluna', () => {
    assert.ok(texts.includes('Tabela, 3 linhas, colunas: Mês, Bloco A, Bloco B.'));
    assert.ok(texts.includes('Linha 1: Mês: Janeiro; Bloco A: 120; Bloco B: 95.'));
    assert.ok(texts.includes('Linha 2: Mês: Fevereiro; Bloco A: 135; Bloco B: 101.'));
    assert.ok(texts.includes('Linha 3: Mês: Março; Bloco A: 128; Bloco B: 99. Fim da tabela.'));
    // Ordem de leitura: parágrafo, tabela, legenda da figura
    const iTable = texts.findIndex(t => t.startsWith('Tabela'));
    assert.ok(texts[iTable - 1].includes('consumo mensal'));
    assert.match(texts[iTable + 4], /^Figura 1/);
  });

  test('3. blockIndex: um bloco por elemento (abertura da tabela + uma por linha)', () => {
    const iTable = texts.findIndex(t => t.startsWith('Tabela'));
    const indexes = chunks.slice(iTable, iTable + 4).map(c => c.blockIndex);
    assert.deepEqual(indexes, [2, 3, 4, 5]);
    assert.doesNotMatch(texts.join(' '), /docling/);
    assert.match(texts.join(' '), /Audiodescrição de elemento visual: Gráfico de barras/);
  });

  test('4. Tabela com <th> e legenda, sem <thead>', () => {
    const t = piperTtsService.createChunksFromHtml(
      '<table><caption>Tabela 1 - Notas</caption><tr><th>Aluno</th><th>Nota</th></tr>'
      + '<tr><td>Ana</td><td>9,5</td></tr><tr><td>Bruno</td><td>7,0</td></tr></table>'
    ).map(c => c.text);
    assert.deepEqual(t, [
      'Tabela 1 - Notas, 2 linhas, colunas: Aluno, Nota.',
      'Linha 1: Aluno: Ana; Nota: 9,5.',
      'Linha 2: Aluno: Bruno; Nota: 7,0. Fim da tabela.'
    ]);
  });

  test('5. Tabela sem cabeçalho lê só as células', () => {
    const { headers, bodyRows } = parseHtmlTable('<tr><td>Fevereiro</td><td>135</td></tr>');
    assert.deepEqual(headers, []);
    assert.deepEqual(bodyRows, [['Fevereiro', '135']]);
  });

  test('6. Documento sem parágrafos (só <div>/<pre>) não quebra e vira trechos de texto', () => {
    let result;
    assert.doesNotThrow(() => {
      result = piperTtsService.createChunksFromHtml('<div>Primeiro bloco de texto.</div><pre>Segundo bloco</pre>');
    });
    assert.deepEqual(result.map(c => c.text), ['Primeiro bloco de texto.', 'Segundo bloco']);
    assert.deepEqual(result.map(c => c.blockIndex), [0, 1]);
    assert.ok(result.every(c => c.tag === 'p'));
  });
});
