import WebSocket from 'ws';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { generateSecMsGecV2, EDGE_TTS_CONSTANTS } from '../utils/edge-tts-drm.js';

/**
 * Dicionário Léxico de Pronúncia Acessível (PLS / Pronunciation Lexicon)
 * Substitui termos técnicos, siglas acadêmicas e notações por pronúncias foneticamente ideais.
 */
const PRONUNCIATION_LEXICON = [
  // Siglas Institucionais e Legais
  { pattern: /\bUFG\b/g, alias: 'U, F, G' },
  { pattern: /\bNAI\b/g, alias: 'Nai' },
  { pattern: /\bAcessilia\b/gi, alias: 'Acessília' },
  { pattern: /\bLBI\b/g, alias: 'Lei Brasileira de Inclusão' },
  { pattern: /\bWCAG\b/gi, alias: 'W, C, A, G' },
  { pattern: /\bNVDA\b/gi, alias: 'N, V, D, A' },
  { pattern: /\bPDF\/UA\b/gi, alias: 'P, D, F, Universalmente Acessível' },
  { pattern: /\bPDF\b/gi, alias: 'P, D, F' },
  { pattern: /\bDOCX\b/gi, alias: 'Doc X' },
  { pattern: /\bHTML\b/gi, alias: 'H, T, M, L' },
  { pattern: /\bOCR\b/gi, alias: 'O, C, R' },
  { pattern: /\bIA\b/g, alias: 'Inteligência Artificial' },
  { pattern: /\bINF\b/g, alias: 'Instituto de Informática' },

  // Capítulos com numerais romanos (ex: Capítulo I -> Capítulo Primeiro)
  { pattern: /\bCapítulo\s+I\b/gi, alias: 'Capítulo Primeiro' },
  { pattern: /\bCapítulo\s+II\b/gi, alias: 'Capítulo Segundo' },
  { pattern: /\bCapítulo\s+III\b/gi, alias: 'Capítulo Terceiro' },
  { pattern: /\bCapítulo\s+IV\b/gi, alias: 'Capítulo Quarto' },
  { pattern: /\bCapítulo\s+V\b/gi, alias: 'Capítulo Quinto' },
  { pattern: /\bCapítulo\s+VI\b/gi, alias: 'Capítulo Sexto' },
  { pattern: /\bCapítulo\s+VII\b/gi, alias: 'Capítulo Sétimo' },
  { pattern: /\bCapítulo\s+VIII\b/gi, alias: 'Capítulo Oitavo' },
  { pattern: /\bCapítulo\s+IX\b/gi, alias: 'Capítulo Nono' },
  { pattern: /\bCapítulo\s+X\b/gi, alias: 'Capítulo Décimo' }
];

export class EdgeTtsService {
  constructor() {
    this.cacheDir = path.resolve(process.cwd(), 'scratch/audio_cache');
    if (!fs.existsSync(this.cacheDir)) {
      try {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      } catch (_) {}
    }
  }

  /**
   * Vozes padrão em Português Brasileiro suportadas pelo Edge TTS Neural
   */
  getAvailableVoices() {
    return [
      { id: 'pt-BR-FranciscaNeural', name: 'Francisca (Neural - Feminina)', gender: 'Female' },
      { id: 'pt-BR-AntonioNeural', name: 'Antônio (Neural - Masculino)', gender: 'Male' },
      { id: 'pt-BR-ThalitaMultilingualNeural', name: 'Thalita (Neural - Expressiva)', gender: 'Female' }
    ];
  }

  /**
   * Aplica regras do Padrão CSS Speech e léxicos de pronúncia para gerar SSML
   */
  applyCssSpeechAndLexicon(rawText, options = {}) {
    if (!rawText || typeof rawText !== 'string') return '';

    let text = rawText;

    // 1. Aplica o Léxico de Pronúncia com tags SSML <sub alias="...">
    for (const entry of PRONUNCIATION_LEXICON) {
      text = text.replace(entry.pattern, `<sub alias="${entry.alias}">$&</sub>`);
    }

    // 2. Converte quebras de linha em breaks SSML suaves
    text = text.replace(/\n\s*\n/g, '<break time="450ms"/>');
    text = text.replace(/\n/g, ' ');

    return text.trim();
  }

  /**
   * Constrói documento SSML compatível com as especificações W3C e Microsoft Edge TTS
   */
  buildSsml(textOrContent, options = {}) {
    const voice = options.voice || 'pt-BR-FranciscaNeural';
    const rate = options.rate ? (typeof options.rate === 'number' ? `${Math.round((options.rate - 1) * 100)}%` : options.rate) : '+0%';
    const pitch = options.pitch || '+0Hz';

    // Processa o texto com léxicos
    const processedText = this.applyCssSpeechAndLexicon(textOrContent);

    return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='https://www.w3.org/2001/mstts' xml:lang='pt-BR'><voice name='${voice}'><prosody rate='${rate}' pitch='${pitch}'>${processedText}</prosody></voice></speak>`;
  }

  /**
   * Divide o HTML semântico ou texto do documento em chunks acessíveis
   * Respeita regras do padrão CSS Speech (speak: none, aria-hidden, abbr, headings).
   */
  createChunksFromHtml(htmlContent) {
    if (!htmlContent || typeof htmlContent !== 'string') return [];

    const chunks = [];
    let chunkIndex = 0;

    // Remove elementos marcados com speak: none, aria-hidden="true" ou classes decorativas
    let cleanHtml = htmlContent
      .replace(/<aside\s+class=["']meta["'][\s\S]*?<\/aside>/gi, '') // Metadados técnicos não devem ser lidos
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+aria-hidden=["']true["'][^>]*>[\s\S]*?<\/[^>]+>/gi, '') // aria-hidden="true"
      .replace(/<[^>]+class=["'][^"']*\b(a11y-ignore-speech|badge|btn)\b[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/gi, ''); // CSS Speech: speak: none

    // Converte <abbr title="..."> em texto falado expandido
    cleanHtml = cleanHtml.replace(/<abbr[^>]+title=["']([^"']+)["'][^>]*>([^<]+)<\/abbr>/gi, '$1 ($2)');

    // Extrai audiodescrições de <figure><img alt="..." src="">
    cleanHtml = cleanHtml.replace(/<figure[^>]*>[\s\S]*?<img[^>]+alt=["']([^"']+)["'][^>]*>[\s\S]*?<\/figure>/gi, '<p class="a11y-audiodesc-item">Audiodescrição de elemento visual: $1</p>');

    // Regex para capturar blocos semânticos: títulos, parágrafos, blockquotes, listas
    const blockRegex = /<(h[1-6]|p|blockquote|li)[^>]*>([\s\S]*?)<\/\1>/gi;
    let match;

    while ((match = blockRegex.exec(cleanHtml)) !== null) {
      const tag = match[1].toLowerCase();
      let innerText = match[2]
        .replace(/<[^>]+>/g, ' ') // Remove tags internas mantendo o texto
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();

      if (!innerText || innerText.length < 2) continue;

      // Adiciona ênfase a títulos (Padrão CSS Speech)
      let prefix = '';
      if (tag.startsWith('h')) {
        const level = tag.replace('h', '');
        prefix = `Título: `;
      } else if (tag === 'blockquote') {
        prefix = `Citação: `;
      }

      const fullText = prefix + innerText;

      // Se o bloco for muito longo (> 400 caracteres), divide em frases
      if (fullText.length > 400) {
        const sentences = fullText.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) || [fullText];
        let currentPart = '';
        for (const sentence of sentences) {
          if ((currentPart + sentence).length > 350 && currentPart.trim()) {
            chunks.push({
              id: `chunk-${chunkIndex++}`,
              tag,
              text: currentPart.trim(),
              wordCount: currentPart.split(/\s+/).length
            });
            currentPart = sentence;
          } else {
            currentPart += ' ' + sentence;
          }
        }
        if (currentPart.trim()) {
          chunks.push({
            id: `chunk-${chunkIndex++}`,
            tag,
            text: currentPart.trim(),
            wordCount: currentPart.split(/\s+/).length
          });
        }
      } else {
        chunks.push({
          id: `chunk-${chunkIndex++}`,
          tag,
          text: fullText,
          wordCount: fullText.split(/\s+/).length
        });
      }
    }

    // Fallback: se nenhum bloco HTML estruturado foi encontrado, faz chunking do texto bruto
    if (chunks.length === 0) {
      const plainText = cleanHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (plainText) {
        const parts = plainText.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) || [plainText];
        for (const part of parts) {
          if (part.trim()) {
            chunks.push({
              id: `chunk-${chunkIndex++}`,
              tag: 'p',
              text: part.trim(),
              wordCount: part.split(/\s+/).length
            });
          }
        }
      }
    }

    return chunks;
  }

  /**
   * Sintetiza um chunk de áudio via Edge-TTS Neural e devolve o Buffer MP3
   */
  async synthesizeChunk(text, options = {}) {
    const voice = options.voice || 'pt-BR-FranciscaNeural';
    const rate = options.rate || 1.0;
    const ssml = this.buildSsml(text, { voice, rate, pitch: options.pitch });

    // Cache por hash MD5 do SSML gerado
    const cacheKey = crypto.createHash('md5').update(`${voice}_${rate}_${ssml}`).digest('hex');
    const cachePath = path.join(this.cacheDir, `${cacheKey}.mp3`);

    if (fs.existsSync(cachePath)) {
      return fs.readFileSync(cachePath);
    }

    const isTestEnv = process.env.NODE_ENV === 'test' ||
                      (process.env.NODE_ENV !== 'development' && process.execArgv.some(arg => arg.includes('--test')));

    if (isTestEnv) {
      // Buffer MP3 sintético válido para testes automatizados rápidos e sem dependência de rede
      const mockMp3 = Buffer.alloc(2048, 0x55);
      mockMp3.write('ID3', 0, 3, 'ascii');
      mockMp3[3] = 0x03;
      mockMp3[10] = 0xFF;
      mockMp3[11] = 0xFB;
      return mockMp3;
    }

    const audioBuffer = await this._synthesizeViaWebSocket(ssml);

    // Salva em cache
    try {
      fs.writeFileSync(cachePath, audioBuffer);
    } catch (_) {}

    return audioBuffer;
  }

  /**
   * Conexão de baixo nível com o WebSocket da Microsoft usando DRM v2
   */
  _synthesizeViaWebSocket(ssml) {
    return new Promise((resolve, reject) => {
      const secMsGec = generateSecMsGecV2();
      const connectionId = crypto.randomUUID().replace(/-/g, '');
      const url = `wss://${EDGE_TTS_CONSTANTS.BASE_URL}/edge/v1?TrustedClientToken=${EDGE_TTS_CONSTANTS.TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=${EDGE_TTS_CONSTANTS.SEC_MS_GEC_VERSION}&ConnectionId=${connectionId}`;

      const headers = {
        'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${EDGE_TTS_CONSTANTS.CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${EDGE_TTS_CONSTANTS.CHROMIUM_MAJOR_VERSION}.0.0.0`,
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'Pragma': 'no-cache',
        'Cache-Control': 'no-cache',
        'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        'Cookie': `muid=${crypto.randomBytes(16).toString('hex').toUpperCase()};`
      };

      const ws = new WebSocket(url, { headers });
      const audioChunks = [];
      let isClosed = false;

      const timeout = setTimeout(() => {
        if (!isClosed) {
          isClosed = true;
          try { ws.close(); } catch (_) {}
          reject(new Error('Timeout de comunicação com o serviço Edge-TTS.'));
        }
      }, 15000);

      ws.on('open', () => {
        const dateStr = new Date().toISOString();
        ws.send(`X-Timestamp:${dateStr}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`);

        const reqId = crypto.randomUUID().replace(/-/g, '');
        ws.send(`X-RequestId:${reqId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${dateStr}Z\r\nPath:ssml\r\n\r\n${ssml}`);
      });

      ws.on('message', (data, isBinary) => {
        if (isBinary) {
          if (data.length > 2) {
            const headerLen = data.readUInt16BE(0);
            const audioData = data.subarray(2 + headerLen);
            if (audioData.length > 0) {
              audioChunks.push(audioData);
            }
          }
        } else {
          const textMsg = data.toString('utf8');
          if (textMsg.includes('Path:turn.end')) {
            clearTimeout(timeout);
            isClosed = true;
            ws.close();
            const fullBuffer = Buffer.concat(audioChunks);
            resolve(fullBuffer);
          }
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        if (!isClosed) {
          isClosed = true;
          reject(new Error(`Falha no WebSocket do Edge-TTS: ${err.message}`));
        }
      });

      ws.on('unexpected-response', (req, res) => {
        clearTimeout(timeout);
        if (!isClosed) {
          isClosed = true;
          reject(new Error(`Serviço Edge-TTS respondeu com status HTTP ${res.statusCode} ${res.statusMessage}`));
        }
      });
    });
  }
}

export const edgeTtsService = new EdgeTtsService();
