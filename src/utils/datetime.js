// Datas e horas do Gestor no fuso da instituição, independente do fuso do servidor.
//
// O SQLite grava CURRENT_TIMESTAMP em UTC sem indicar o fuso ("2026-11-16 11:37:14"), e o
// container roda em UTC. Antes, new Date(...) + toLocaleString('pt-BR') mostrava esse
// horário como se fosse local: uma ação feita às 08:37 em Goiânia aparecia como 11:37.

export const APP_TIMEZONE = process.env.APP_TIMEZONE || 'America/Sao_Paulo';

// "AAAA-MM-DD HH:MM[:SS[.fff]]" ou com "T", sem Z nem deslocamento
const NAIVE_DATETIME = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?$/;

/**
 * Converte um valor vindo do banco em Date. Texto sem fuso é UTC (é assim que o SQLite
 * grava CURRENT_TIMESTAMP); texto com Z/deslocamento, número ou Date seguem como estão.
 * @returns {Date|null} null quando vazio ou inválido
 */
export function parseDbTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  const text = String(value).trim();
  const naive = text.match(NAIVE_DATETIME);
  const d = naive ? new Date(`${text.replace(' ', 'T')}Z`) : new Date(text);
  return isNaN(d.getTime()) ? null : d;
}

// Deslocamento (ms) do fuso em relação ao UTC no instante informado
function timeZoneOffsetMs(instant, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).formatToParts(instant).map(p => [p.type, p.value])
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * Lê o valor de um <input type="datetime-local"> ("2026-11-20T10:00") como horário de
 * parede no fuso da instituição. Valor com Z/deslocamento segue como está.
 * @returns {Date|null} null quando vazio ou inválido
 */
export function parseLocalDateTimeInput(value, timeZone = APP_TIMEZONE) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  const m = text.match(NAIVE_DATETIME);
  if (!m) {
    const d = new Date(text);
    return isNaN(d.getTime()) ? null : d;
  }
  const [, y, mo, da, h, mi, s = '0', ms = '0'] = m;
  const wallAsUtc = Date.UTC(+y, +mo - 1, +da, +h, +mi, +s, +ms.padEnd(3, '0'));
  // Date.UTC "corrige" mês 13 ou hora 99 para outra data: aqui isso é valor inválido
  const check = new Date(wallAsUtc);
  if (isNaN(wallAsUtc) || check.getUTCMonth() !== +mo - 1 || check.getUTCDate() !== +da
      || check.getUTCHours() !== +h || check.getUTCMinutes() !== +mi || check.getUTCSeconds() !== +s) {
    return null;
  }
  // Duas passadas cobrem a troca de horário de verão
  let instant = wallAsUtc - timeZoneOffsetMs(new Date(wallAsUtc), timeZone);
  instant = wallAsUtc - timeZoneOffsetMs(new Date(instant), timeZone);
  return new Date(instant);
}

/** "16/11/2026, 08:37:14" no fuso da instituição; '' quando vazio ou inválido. */
export function formatDateTime(value, options = {}) {
  const d = parseDbTimestamp(value);
  if (!d) return '';
  return d.toLocaleString('pt-BR', { timeZone: APP_TIMEZONE, ...options });
}

/** "16/11/2026" no fuso da instituição; '' quando vazio ou inválido. */
export function formatDate(value, options = {}) {
  const d = parseDbTimestamp(value);
  if (!d) return '';
  return d.toLocaleDateString('pt-BR', { timeZone: APP_TIMEZONE, ...options });
}
