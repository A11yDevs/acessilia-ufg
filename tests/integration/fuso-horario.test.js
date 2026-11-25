import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../database/connection.js';
import { buildApp } from '../../src/app.js';
import { materialService } from '../../src/services/material.service.js';
import { materialRepository } from '../../src/repositories/material.repository.js';
import { academicService } from '../../src/services/academic.service.js';
import { botAcessService } from '../../src/integrations/bot-acess/service.js';
import { certificateService } from '../../src/services/certificate.service.js';

// Achado do treinamento de 16/11: "Acessibilização Automática por IA realizada em 16/11/2026, 11:37:14"
// para uma acessibilização feita às 08:37 em Goiânia (servidor de homologação em UTC).
test('Selo e certificado mostram o horário de Goiânia', async (t) => {
  const admin = { id: 1, roleCode: 'ADMINISTRADOR', name: 'Administrador UFG', permissions: [] };
  const teacher = { id: 2, roleCode: 'PROFESSOR', name: 'Prof. Carlos', permissions: ['materiais.visualizar', 'materiais.enviar'] };
  const suffix = Date.now();

  const subject = await academicService.createSubject({
    departmentId: 1, code: `FUSO-${suffix}`, name: 'Disciplina de Teste de Fuso', workloadHours: 30
  }, admin);
  const { material, version } = await materialService.uploadMaterial({
    subjectId: subject.id, title: `Material Fuso ${suffix}`, category: 'APOSTILA', originalFilename: 'fuso.pdf'
  }, teacher);
  const job = await materialService.requestProcessing(version.id, teacher);
  await botAcessService.dispatchJob(job.id);
  await botAcessService.handleJobCompleted(job.id);

  // Fixa o instante gravado pelo SQLite (UTC, sem fuso), como no achado
  const botVersion = materialRepository.getMaterialVersions(material.id).find(v => v.version_type === 'PROCESSADO_BOT');
  db.prepare('UPDATE material_versions SET created_at = ? WHERE id = ?').run('2026-11-16 11:37:14', botVersion.id);

  await t.test('1. Dados do certificado', () => {
    const cert = certificateService.getCertificateData(material.id);
    assert.equal(cert.automaticDateFormatted, '16/11/2026, 08:37:14');
    assert.equal(cert.automaticIsoDate, '2026-11-16T11:37:14.000Z');
  });

  await t.test('2. Página pública do certificado', async () => {
    const app = await buildApp({ logger: false });
    t.after(() => app.close());
    const res = await app.inject({ method: 'GET', url: `/certificados/material/${material.id}` });
    assert.equal(res.statusCode, 200);
    assert.match(res.payload, /16\/11\/2026, 08:37:14/);
    assert.doesNotMatch(res.payload, /16\/11\/2026, 11:37:14/);
  });
});
