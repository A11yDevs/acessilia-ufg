import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app.js';
import { userRepository } from '../../src/repositories/user.repository.js';

test('Testes das Novas Rotas: Preferências Visuais, Relatório LBI e Monitoramento', async (t) => {
  const app = await buildApp({ logger: false });

  await t.test('1. Salvar e Recuperar Preferências Visuais de Acessibilidade via API', async () => {
    const prefs = {
      contrastMode: 'high',
      fontSize: 'font-xl',
      dyslexiaFont: 1,
      preferredDownloadFormat: 'mp3'
    };

    userRepository.saveUiPreferences(1, prefs);

    const retrieved = userRepository.getUiPreferences(1);
    assert.equal(retrieved.contrast_mode, 'high');
    assert.equal(retrieved.font_size, 'font-xl');
    assert.equal(retrieved.dyslexia_font, 1);
    assert.equal(retrieved.preferred_download_format, 'mp3');
  });

  await t.test('2. Rota de Relatório Legal LBI requer autenticação', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/relatorios/conformidade-lbi.html'
    });
    // Redireciona para /login quando não autenticado
    assert.equal(response.statusCode, 302);
    assert.equal(response.headers.location, '/login');
  });

  await t.test('3. Rota de Monitoramento requer autenticação', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/monitoramento'
    });
    assert.equal(response.statusCode, 302);
    assert.equal(response.headers.location, '/login');
  });

  await app.close();
});
