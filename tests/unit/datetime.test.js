import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  APP_TIMEZONE, parseDbTimestamp, parseLocalDateTimeInput, formatDateTime, formatDate
} from '../../src/utils/datetime.js';

// O selo mostrou "realizada em 16/11/2026, 11:37:14" para uma acessibilização feita às 08:37
// em Goiânia: o SQLite grava em UTC sem fuso e o servidor de homologação roda em UTC.
describe('Datas no fuso da instituição (src/utils/datetime.js)', () => {
  test('1. Fuso padrão é America/Sao_Paulo', () => {
    assert.equal(APP_TIMEZONE, process.env.APP_TIMEZONE || 'America/Sao_Paulo');
  });

  test('2. CURRENT_TIMESTAMP do SQLite (sem fuso) é lido como UTC', () => {
    assert.equal(parseDbTimestamp('2026-11-16 11:37:14').toISOString(), '2026-11-16T11:37:14.000Z');
    assert.equal(parseDbTimestamp('2026-11-16T11:37:14.250').toISOString(), '2026-11-16T11:37:14.250Z');
    // Com Z ou deslocamento, segue como está
    assert.equal(parseDbTimestamp('2026-11-16T11:37:14.000Z').toISOString(), '2026-11-16T11:37:14.000Z');
    assert.equal(parseDbTimestamp('2026-11-16T08:37:14-03:00').toISOString(), '2026-11-16T11:37:14.000Z');
  });

  test('3. Exibição no horário de Goiânia, não no do servidor', () => {
    assert.equal(formatDateTime('2026-11-16 11:37:14'), '16/11/2026, 08:37:14');
    assert.equal(formatDateTime(new Date('2026-11-16T11:37:14Z')), '16/11/2026, 08:37:14');
    // Perto da meia-noite UTC a data também muda
    assert.equal(formatDate('2026-11-17 01:30:00'), '16/11/2026');
  });

  test('4. Agendamento (datetime-local) é horário de parede em Goiânia', () => {
    const d = parseLocalDateTimeInput('2026-11-20T10:00');
    assert.equal(d.toISOString(), '2026-11-20T13:00:00.000Z');
    assert.equal(formatDateTime(d), '20/11/2026, 10:00:00');
    // Valor que já traz o fuso não é reinterpretado
    assert.equal(parseLocalDateTimeInput('2026-11-20T10:00:00Z').toISOString(), '2026-11-20T10:00:00.000Z');
  });

  test('5. Vazio ou inválido não quebra a tela', () => {
    for (const value of [null, undefined, '', 'amanhã', '2026-13-45 99:99']) {
      assert.equal(formatDateTime(value), '');
      assert.equal(parseLocalDateTimeInput(value), null);
    }
  });

  test('6. O resultado não depende do fuso do processo (servidor em UTC ou em outro fuso)', () => {
    const moduleUrl = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/utils/datetime.js')).href;
    const code = `import(${JSON.stringify(moduleUrl)}).then(m => console.log(JSON.stringify([
      m.formatDateTime('2026-11-16 11:37:14'), m.parseLocalDateTimeInput('2026-11-20T10:00').toISOString()
    ])))`;
    for (const tz of ['UTC', 'Asia/Tokyo', 'America/Sao_Paulo']) {
      const child = spawnSync(process.execPath, ['-e', code], {
        encoding: 'utf8', env: { ...process.env, TZ: tz, APP_TIMEZONE: '' }
      });
      assert.equal(child.status, 0, child.stderr);
      assert.deepEqual(JSON.parse(child.stdout), ['16/11/2026, 08:37:14', '2026-11-20T13:00:00.000Z'], `TZ=${tz}`);
    }
  });
});
