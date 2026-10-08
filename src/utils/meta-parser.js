/**
 * Utilitário para analisar e extrair metadados técnicos do Acessilia Core.
 * O Core anexa ao final do HTML acessibilizado um bloco:
 * <aside class="meta"><h2>Metadados técnicos</h2><p>{'pipeline_engine': 'pddl', ...}</p></aside>
 */

export function parseAcessiliaMetadata(htmlString) {
  if (!htmlString || typeof htmlString !== 'string') {
    return null;
  }

  const metaMatch = htmlString.match(/<aside\s+class=["']meta["'][^>]*>([\s\S]*?)<\/aside>/i);
  if (!metaMatch) {
    return null;
  }

  const asideContent = metaMatch[1];
  const pMatch = asideContent.match(/<p>([\s\S]*?)<\/p>/i);
  if (!pMatch) {
    return null;
  }

  let rawData = pMatch[1].trim();

  rawData = rawData
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

  let parsed = null;

  try {
    parsed = JSON.parse(rawData);
  } catch (_) {
    try {
      // Pré-normalização para converter sintaxe de dicionário Python para JSON
      // Protege strings com aspas escapadas ou quebras
      const jsonCandidate = rawData
        .replace(/:\s*None\b/g, ': null')
        .replace(/:\s*True\b/g, ': true')
        .replace(/:\s*False\b/g, ': false')
        .replace(/,\s*([\}\]])/g, '$1')
        .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?:/g, '"$2":')
        .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (match, p1) => {
          const escaped = p1.replace(/"/g, '\\"');
          return `"${escaped}"`;
        });

      parsed = JSON.parse(jsonCandidate);
    } catch (parseErr) {
      parsed = extractFallbackMeta(rawData);
    }
  }

  if (!parsed) return null;

  return summarizeMetadata(parsed, rawData);
}

function extractFallbackMeta(text) {
  const getField = (regex) => {
    const m = text.match(regex);
    return m ? m[1] : null;
  };

  const pageCountMatch = text.match(/['"]page_count['"]\s*:\s*(\d+)/);
  const pipelineEngine = getField(/['"]pipeline_engine['"]\s*:\s*['"]([^'"]+)['"]/);
  const manifestId = getField(/['"]pddl_manifest_id['"]\s*:\s*['"]([^'"]+)['"]/);
  const executionStatus = getField(/['"]pddl_execution_status['"]\s*:\s*['"]([^'"]+)['"]/);

  const imageMatches = text.match(/['"]type['"]\s*:\s*['"]image['"]/g);
  const blockMatches = text.match(/['"]id['"]\s*:\s*['"]element-\d+['"]/g);

  return {
    pipeline_engine: pipelineEngine || 'pddl',
    pddl_manifest_id: manifestId,
    pddl_execution_status: executionStatus,
    page_count: pageCountMatch ? parseInt(pageCountMatch[1], 10) : 1,
    detected_images_count: imageMatches ? imageMatches.length : 0,
    total_blocks_count: blockMatches ? blockMatches.length : 0
  };
}

function summarizeMetadata(data, rawText) {
  let imagesCount = data.detected_images_count || 0;
  let totalBlocks = data.total_blocks_count || 0;
  let textLength = 0;
  const imageDetails = [];

  if (Array.isArray(data.pages)) {
    data.pages.forEach(page => {
      if (typeof page.text === 'string') {
        textLength += page.text.length;
      }
      if (Array.isArray(page.blocks)) {
        totalBlocks += page.blocks.length;
        page.blocks.forEach(block => {
          if (block.type === 'image' || block.metadata?.raw_label === 'picture') {
            imagesCount++;
            imageDetails.push({
              id: block.id,
              altText: block.alt_text || block.metadata?.alt_text || '',
              visionLanguage: block.metadata?.vision_language || 'pt',
              visionConfidence: block.metadata?.vision_confidence ?? 1.0,
              elements: block.metadata?.vision_elements || [],
              bbox: block.source_location?.bbox || null
            });
          }
        });
      }
    });
  }

  // Se o fallback por regex foi ativado ou faltam detalhes
  if (imageDetails.length === 0 && rawText) {
    const altRegex = /['"]alt_text['"]\s*:\s*["']([^"']+)["']/g;
    let match;
    let idx = 1;
    while ((match = altRegex.exec(rawText)) !== null) {
      imageDetails.push({
        id: `element-img-${idx++}`,
        altText: match[1],
        visionLanguage: 'pt',
        visionConfidence: 1.0,
        elements: []
      });
    }
    if (imagesCount === 0) imagesCount = imageDetails.length;
  }

  const wordCount = textLength > 0 ? Math.ceil(textLength / 6) : 0;
  const readingTimeMinutes = Math.max(1, Math.ceil(wordCount / 200));

  return {
    pipelineEngine: data.pipeline_engine || 'pddl',
    manifestId: data.pddl_manifest_id || 'manifest-auto',
    executionStatus: data.pddl_execution_status || 'completed',
    pageCount: data.page_count || (data.pages ? data.pages.length : 1),
    totalBlocks: totalBlocks || 1,
    imagesCount: imagesCount || imageDetails.length,
    imageDetails,
    estimatedWordCount: wordCount,
    estimatedReadingTimeMinutes: readingTimeMinutes,
    hasDoclingMeta: true
  };
}

/**
 * Transforma o HTML gerado pelo Acessilia Core para substituir <figure><img src="" alt="...">
 * por componentes visuais e acessíveis de Audiodescrição.
 */
export function enhanceAccessibleHtml(htmlContent) {
  if (!htmlContent || typeof htmlContent !== 'string') return htmlContent;

  return htmlContent.replace(
    /<figure([^>]*)>\s*<img\s+([^>]*?)alt=["']([^"']*)["']([^>]*?)>\s*<\/figure>/gi,
    (match, figureAttrs, preAlt, altText, postAlt) => {
      if (!altText || altText.trim() === '') {
        return match;
      }

      const cleanAlt = altText
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');

      const escapedAlt = cleanAlt
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');

      return `
<div class="a11y-audiodesc-card" role="region" aria-label="Audiodescrição de elemento visual">
  <div class="a11y-audiodesc-header">
    <span class="a11y-audiodesc-tag">
      <span aria-hidden="true">🖼️</span> Audiodescrição de Imagem Original
    </span>
    <span class="a11y-audiodesc-badge">Acessibilidade Visual (IA + Acessilia)</span>
  </div>
  <blockquote class="a11y-audiodesc-content">
    "${escapedAlt}"
  </blockquote>
  <div class="a11y-audiodesc-actions">
    <button type="button" class="btn btn-sm btn-a11y-speak" onclick="window.speakAudiodesc(this)" data-text="${escapedAlt}" aria-label="Ouvir audiodescrição em voz alta">
      🔊 Ouvir Descrição
    </button>
    <button type="button" class="btn btn-sm" onclick="window.copyAudiodesc(this, '${escapedAlt.replace(/'/g, "\\'")}')" aria-label="Copiar texto da audiodescrição">
      📋 Copiar Texto
    </button>
  </div>
  <figure${figureAttrs} style="display: none;" aria-hidden="true">
    <img alt="${escapedAlt}" src="">
  </figure>
</div>`;
    }
  );
}
