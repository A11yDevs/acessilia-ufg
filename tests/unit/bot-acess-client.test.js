import { test, describe } from 'node:test';
import assert from 'node:assert';
import { botAcessClient } from '../../src/integrations/bot-acess/client.js';

describe('Integração com Acessilia Core (API Client)', () => {
  test('1. Deve enviar documento com multipart document_file e source=gestor em modo teste', async () => {
    const result = await botAcessClient.sendDocumentForProcessing({
      jobId: 101,
      filename: 'calculo_1_aula.pdf',
      mimeType: 'application/pdf',
      customPrompt: 'Enfatizar formulas e graficos de funcoes',
      mode: 'normal'
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.status, 'QUEUED');
    assert.ok(result.externalJobId.startsWith('ext_acessilia_'));
  });

  test('2. Deve obter download url compatível com a rota do Core', () => {
    const url = botAcessClient.getDownloadUrl('tok_123', 'html');
    assert.ok(url.includes('/api/v1/download/tok_123/html'));
  });
});
