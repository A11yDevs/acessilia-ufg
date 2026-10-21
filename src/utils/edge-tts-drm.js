/**
 * Utilitário de DRM v2 para autenticação no serviço Edge-TTS da Microsoft.
 * Implementa a derivação de token baseada em ticks Windows e rounds SHA-256/CS64.
 */

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const WIN_EPOCH = 11644473600;
const S_TO_NS = 1e9;

const _SHA256_INITIAL = [
  0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A,
  0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19
];

const _SHA256_STATE = [
  0xFD9FBEA2, 0x91243CE7, 0xBE499094, 0xCD2E1E0A,
  0x6C006F49, 0x04BD35AB, 0xFEB0A7E4, 0x03EFFBD2
];

const _SHA256_SCHEDULE = [
  0xEB24BF9E, 0x1558691F, 0xA0C09EE2, 0x0CFA32BA,
  0xA622EE8C, 0xD1DD9491, 0xC0DD25A0, 0xF9E70AB6,
  0xF0C31573, 0x7058CE4E, 0x7188E606, 0x00E5AB33,
  0xD258B060, 0x72766564
];

const _SHA256_ROUND_CONSTANTS = [
  0x428A2F98, 0x71374491, 0xB5C0FBCF, 0xE9B5DBA5, 0x3956C25B, 0x59F111F1, 0x923F82A4, 0xAB1C5ED5,
  0xD807AA98, 0x12835B01, 0x243185BE, 0x550C7DC3, 0x72BE5D74, 0x80DEB1FE, 0x9BDC06A7, 0xC19BF174,
  0xE49B69C1, 0xEFBE4786, 0x0FC19DC6, 0x240CA1CC, 0x2DE92C6F, 0x4A7484AA, 0x5CB0A9DC, 0x76F988DA,
  0x983E5152, 0xA831C66D, 0xB00327C8, 0xBF597FC7, 0xC6E00BF3, 0xD5A79147, 0x06CA6351, 0x14292967,
  0x27B70A85, 0x2E1B2138, 0x4D2C6DFC, 0x53380D13, 0x650A7354, 0x766A0ABB, 0x81C2C92E, 0x92722C85,
  0xA2BFE8A1, 0xA81A664B, 0xC24B8B70, 0xC76C51A3, 0xD192E819, 0xD6990624, 0xF40E3585, 0x106AA070,
  0x19A4C116, 0x1E376C08, 0x2748774C, 0x34B0BCB5, 0x391C0CB3, 0x4ED8AA4A, 0x5B9CCA4F, 0x682E6FF3,
  0x748F82EE, 0x78A5636F, 0x84C87814, 0x8CC70208, 0x90BEFFFA, 0xA4506CEB, 0xBEF9A3F7, 0xC67178F2
];

const _SHA256_ADJUSTMENT = 0xC9DC06A7;
const _SHA256_BLOCK_CONSTANTS = [
  ..._SHA256_ROUND_CONSTANTS.slice(0, 14),
  _SHA256_ADJUSTMENT,
  ..._SHA256_ROUND_CONSTANTS.slice(15)
];
const _SHA256_SIGMA0_ADJUSTMENT = 0x059C0B80;
const _SHA256_SIGMA1_ADJUSTMENT = 0x000B92C0;

const _CS64_COEFFICIENTS = [
  [0xE82E91B1, 0xB32700D0],
  [0x44DE24C6, 0x88DFF51D],
  [0x3BEB65BC, 0x29514038],
  [0xC89C5933, 0xB328CBDF],
  [0x8D1EC211, 0xD405B4D5],
  [0x314EF5D5, 0x26E55F3C],
  [0xE92491B1, 0x607801C6],
  [0xF0A5B9D5, 0x82B2C1FB],
  [0x06064CF3, 0xFA51A3DA],
  [0xDA79FA60, 0x207CC464],
  [0xBED20560, 0x3C3C74F3],
  [0x89F9C9F8, 0xD2D14B61],
  [0x35FA38C6, 0xBB04A2C1],
  [0xCB49E3C6, 0xC5626167]
];
const _CS64_FACTOR = 0x82893933;
const _CS64_ADJUSTMENT0 = 0xF2F90B1A;
const _CS64_ADJUSTMENT1 = 0x0B1A0000;

function _rol16(val) {
  val = val >>> 0;
  return ((val << 16) | (val >>> 16)) >>> 0;
}

function _words_le4_even(data) {
  const padLen = (-data.length) & 3;
  const padded = Buffer.concat([data, Buffer.alloc(padLen)]);
  if (padded.length === 0) return [];
  const words = [];
  for (let i = 0; i < padded.length; i += 4) {
    words.push(padded.readUInt32LE(i));
  }
  if (words.length % 2 !== 0) words.push(0);
  return words;
}

function _sigma0(v) {
  v = v >>> 0;
  return ((v >>> 7) ^ (v << 25) ^ (v >>> 18) ^ (v << 14) ^ (v >>> 3)) >>> 0;
}

function _sigma1(v) {
  v = v >>> 0;
  return ((v >>> 17) ^ (v << 15) ^ (v >>> 19) ^ (v << 13) ^ (v >>> 10)) >>> 0;
}

function _rotr(v, n) {
  v = v >>> 0;
  return ((v >>> n) | (v << (32 - n))) >>> 0;
}

function _sha256_rounds(state, words, firstRound = 0) {
  let [a, b, c, d, e, f, g, h] = state;
  const constants = (firstRound === 14) ? _SHA256_BLOCK_CONSTANTS : _SHA256_ROUND_CONSTANTS;
  const aligned = Math.min(64, Math.ceil(firstRound / 8) * 8);

  for (let index = firstRound; index < aligned; index++) {
    const s1 = (_rotr(e, 6) ^ _rotr(e, 11) ^ _rotr(e, 25)) >>> 0;
    const ch = (g ^ (e & (f ^ g))) >>> 0;
    const t1 = (h + s1 + ch + constants[index] + words[index]) >>> 0;
    const s0 = (_rotr(a, 2) ^ _rotr(a, 13) ^ _rotr(a, 22)) >>> 0;
    const maj = ((a & b) | (c & (a | b))) >>> 0;
    const t2 = (s0 + maj) >>> 0;
    h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
  }

  for (let index = aligned; index < 64; index++) {
    const s1 = (_rotr(e, 6) ^ _rotr(e, 11) ^ _rotr(e, 25)) >>> 0;
    const ch = (g ^ (e & (f ^ g))) >>> 0;
    const t1 = (h + s1 + ch + constants[index] + words[index]) >>> 0;
    const s0 = (_rotr(a, 2) ^ _rotr(a, 13) ^ _rotr(a, 22)) >>> 0;
    const maj = ((a & b) | (c & (a | b))) >>> 0;
    const t2 = (s0 + maj) >>> 0;
    h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
  }

  return [a, b, c, d, e, f, g, h];
}

function _expand_sha256_schedule(words, firstWord = 16) {
  for (let index = firstWord; index < 64; index++) {
    const x = words[index - 2];
    const y = words[index - 15];
    const s1 = _sigma1(x);
    const s0 = _sigma0(y);
    words.push((s1 + words[index - 7] + s0 + words[index - 16]) >>> 0);
  }
}

function _sha256_init(data) {
  const words = Array(14).fill(0);
  const part1 = Buffer.concat([data.subarray(0, 3), Buffer.alloc(1)]);
  words.push(part1.readUInt32BE(0) >>> 8);
  words.push(data.subarray(3, 7).readUInt32BE(0));

  for (let index = 16; index < 30; index++) {
    let value = _SHA256_SCHEDULE[index - 16];
    if (index - 2 >= 14) {
      value = (value + (index === 16 ? (_sigma1(words[index - 2]) ^ _SHA256_SIGMA1_ADJUSTMENT) : _sigma1(words[index - 2]))) >>> 0;
    }
    if (index - 7 >= 14) {
      value = (value + words[index - 7]) >>> 0;
    }
    if (index - 15 >= 14) {
      value = (value + (index === 29 ? (_sigma0(words[index - 15]) ^ _SHA256_SIGMA0_ADJUSTMENT) : _sigma0(words[index - 15]))) >>> 0;
    }
    words.push(value >>> 0);
  }

  words.push((_sigma1(words[28]) + words[23] + _sigma0(words[15]) + words[14] + _SHA256_ADJUSTMENT - _SHA256_ROUND_CONSTANTS[14]) >>> 0);
  _expand_sha256_schedule(words, 31);
  const working = _sha256_rounds(_SHA256_STATE, words, 14);
  return _SHA256_INITIAL.map((x, i) => (x + working[i]) >>> 0);
}

function _sha256_digest(data) {
  if (data.length < 7) throw new Error("Token salt must contain at least 7 bytes");
  const length = 57 + data.length;
  const padZeroLen = (55 - length) % 64 >= 0 ? (55 - length) % 64 : ((55 - length) % 64) + 64;
  const bufLen = Buffer.alloc(8);
  bufLen.writeBigUInt64BE(BigInt(length * 8));

  const padded = Buffer.concat([
    data.subarray(7),
    Buffer.from([0x80]),
    Buffer.alloc(padZeroLen),
    bufLen
  ]);

  let state = _sha256_init(data.subarray(0, 7));
  for (let offset = 0; offset < padded.length; offset += 64) {
    const chunk = padded.subarray(offset, offset + 64);
    const words = [];
    for (let i = 0; i < 64; i += 4) {
      words.push(chunk.readUInt32BE(i));
    }
    _expand_sha256_schedule(words);
    const working = _sha256_rounds(state, words);
    state = state.map((x, i) => (x + working[i]) >>> 0);
  }

  const out = Buffer.alloc(32);
  for (let i = 0; i < 8; i++) {
    out.writeUInt32BE(state[i], i * 4);
  }
  return out;
}

function _cs64_digest(data, digest) {
  let key_a = digest.readUInt32LE(0) | 1;
  let key_b = digest.readUInt32LE(4) | 1;
  const factor_a = Math.imul(key_a, _CS64_FACTOR) >>> 0;
  const factor_b = Math.imul(key_b, _CS64_FACTOR) >>> 0;

  const terms = _CS64_COEFFICIENTS.map(([coef], idx) => 
    Math.imul(coef, idx % 2 === 0 ? factor_a : factor_b) >>> 0
  );
  const offsets = _CS64_COEFFICIENTS.map(([, off]) => off);

  const words = _words_le4_even(Buffer.concat([Buffer.from([0]), data]));
  words.forEach((word, idx) => {
    let term = Math.imul(word, idx % 2 === 0 ? key_a : key_b) >>> 0;
    let offset = Math.imul(_rol16(word), idx % 2 === 0 ? 0xEF0569FB : 0xC31713DB) >>> 0;
    if (idx === 0) {
      term = (term + Math.imul(_CS64_ADJUSTMENT0, factor_a)) >>> 0;
      offset = (offset + _CS64_ADJUSTMENT1) >>> 0;
    }
    terms.push(term);
    offsets.push(offset);
  });

  let swap_acc = 0, swap_last = 0, state = 0, acc = 0;
  for (let i = 0; i < terms.length; i += 2) {
    const x = terms[i], y = terms[i + 1];
    let t = _rol16((offsets[i] + x) >>> 0);
    let q = Math.imul(t, 0x76F50F34) >>> 0;
    swap_acc = (swap_acc + Math.imul(_rol16(q), 0xC3EFEA97) + q) >>> 0;
    t = _rol16((offsets[i + 1] + y) >>> 0);
    q = Math.imul(t, 0x1881CE3C) >>> 0;
    swap_last = (Math.imul(_rol16(q), 0x35BD1EC9) + q) >>> 0;
    swap_acc = (swap_acc + swap_last) >>> 0;

    state = (Math.imul(state, key_a) + x) >>> 0;
    state = Math.imul(_rol16(state), 0xCF98B111) >>> 0;
    state = Math.imul(_rol16(state), 0x87085B9F) >>> 0;
    state = Math.imul(_rol16(state), 0x12CEB96D) >>> 0;
    state = Math.imul(_rol16(state), 0x257E1D83) >>> 0;
    acc = (acc + state) >>> 0;

    t = (Math.imul(state, key_b) + y) >>> 0;
    t = Math.imul(_rol16(t), 0xA27416F5) >>> 0;
    t = Math.imul(_rol16(t), 0xD38396FF) >>> 0;
    state = Math.imul(_rol16((Math.imul(_rol16(t), 0x7C932B89) >>> 0)), 0xBFA49F69) >>> 0;
    acc = (acc + state) >>> 0;
  }

  return [(swap_last ^ state) >>> 0, (swap_acc ^ acc) >>> 0];
}

/**
 * Gera token Sec-MS-GEC v2 para o cabeçalho do WebSocket Edge-TTS
 */
export function generateSecMsGecV2(unixTimestamp = null) {
  let ticks = unixTimestamp === null ? (Date.now() / 1e3) : unixTimestamp;
  ticks += WIN_EPOCH;
  ticks -= ticks % 300;
  ticks *= S_TO_NS / 100;
  const strToHash = Buffer.from(`${ticks.toFixed(0)}${TRUSTED_CLIENT_TOKEN}`, 'ascii');
  const digest = _sha256_digest(strToHash);
  const [cs0, cs1] = _cs64_digest(strToHash, digest);
  const csBuf = Buffer.alloc(8);
  csBuf.writeUInt32LE(cs0, 0);
  csBuf.writeUInt32LE(cs1, 4);
  return `${csBuf.toString('hex').toUpperCase()}-${digest.toString('hex').toUpperCase()}`;
}

export const EDGE_TTS_CONSTANTS = {
  BASE_URL: 'speech.platform.bing.com/consumer/speech/synthesize/readaloud',
  TRUSTED_CLIENT_TOKEN,
  CHROMIUM_FULL_VERSION: '143.0.3650.75',
  CHROMIUM_MAJOR_VERSION: '143',
  SEC_MS_GEC_VERSION: '2-143.0.3650.75'
};
