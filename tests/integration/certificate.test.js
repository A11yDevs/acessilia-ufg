import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app.js';
import { materialService } from '../../src/services/material.service.js';
import { materialRepository } from '../../src/repositories/material.repository.js';
import { academicService } from '../../src/services/academic.service.js';
import { botAcessService } from '../../src/integrations/bot-acess/service.js';
import { certificateService } from '../../src/services/certificate.service.js';

test('Selo e Certificado Digital de Acessibilidade com QR Code', async (t) => {
  const app = await buildApp({ logger: false });

  const admin = { id: 1, roleCode: 'ADMINISTRADOR', name: 'Administrador UFG', permissions: [] };
  const teacher = { id: 2, roleCode: 'PROFESSOR', name: 'Prof. Carlos', permissions: ['materiais.visualizar', 'materiais.baixar', 'materiais.enviar'] };
  const student = { id: 4, roleCode: 'ALUNO', name: 'Lucas Aluno', permissions: ['materiais.visualizar', 'materiais.baixar'] };
  const reviewer = { id: 3, roleCode: 'REVISOR', name: 'Ana Beatriz Souza (Revisora)', permissions: ['revisoes.visualizar', 'revisoes.avaliar', 'revisoes.aprovar', 'materiais.visualizar'] };

  const suffix = Date.now();
  const course = await academicService.createCourse({
    departmentId: 1,
    code: `CERT-${suffix}`,
    name: 'Engenharia de Software',
    modality: 'PRESENCIAL',
    durationSemesters: 8
  }, admin);

  const subject = await academicService.createSubject({
    departmentId: 1,
    code: `DISC-CERT-${suffix}`,
    name: 'Acessibilidade Web Avançada',
    description: 'Ementa Acessibilidade',
    workloadHours: 64
  }, admin);

  const testClass = await academicService.createClass({
    courseId: course.id,
    subjectId: subject.id,
    academicPeriodId: 1,
    code: `TURMA-CERT-${suffix}`
  }, admin);

  await academicService.assignTeacher(testClass.id, teacher.id, 'TITULAR', admin);
  await academicService.enrollStudent(testClass.id, student.id, admin);

  // 1. Upload do Material Original
  const { material, version } = await materialService.uploadMaterial({
    subjectId: subject.id,
    classId: testClass.id,
    title: 'Guia de Diretrizes WCAG 2.2',
    description: 'Normas completas de conformidade digital e inclusão.',
    category: 'APOSTILA',
    originalFilename: 'diretrizes_wcag.pdf'
  }, teacher);

  // Processamento automático pelo Core da versão
  const job = await materialService.requestProcessing(version.id, teacher);
  await botAcessService.dispatchJob(job.id);
  await botAcessService.handleJobCompleted(job.id);

  let currentUser = null;
  app.addHook('preHandler', async (req) => {
    if (currentUser) {
      req.user = currentUser;
      req.session = { get: () => currentUser };
    }
  });

  await t.test('1. Certificado com Processamento Automático (Aguardando Revisão)', async () => {
    const certData = certificateService.getCertificateData(material.id);
    assert.ok(certData);
    assert.equal(certData.isApproved, false);
    assert.equal(certData.title, 'Guia de Diretrizes WCAG 2.2');
    assert.ok(certData.automaticDateFormatted);

    // Geração do QR Code
    const qrCode = await certificateService.generateQrCodeDataUrl(certData.certificateUrl);
    assert.ok(qrCode);
    assert.match(qrCode, /^data:image\/png;base64,/);

    // Consulta à rota pública do certificado sem autenticação
    currentUser = null;
    const resPublic = await app.inject({
      method: 'GET',
      url: `/certificados/material/${material.id}`
    });

    assert.equal(resPublic.statusCode, 200);
    assert.match(resPublic.payload, /Certificado Digital de Acessibilidade/);
    assert.match(resPublic.payload, /Documento Acessibilizado pelo Acessilia/);
    assert.match(resPublic.payload, /não foi revisado.*pelo Núcleo de Acessibilidade/);
    assert.match(resPublic.payload, /data:image\/png;base64,/);
  });

  await t.test('2. Cabeçalho no Download HTML e TXT para Material Automático', async () => {
    currentUser = student;

    // Download HTML
    const resHtml = await app.inject({
      method: 'GET',
      url: `/materiais/${material.id}/download?format=html`
    });
    assert.equal(resHtml.statusCode, 200);
    assert.match(resHtml.payload, /Selo Acessilia/);
    assert.doesNotMatch(resHtml.payload, /UFG/i);
    assert.match(resHtml.payload, /Documento acessibilizado pelo Acessilia \(Processamento Automático\)/);
    assert.match(resHtml.payload, /não foi revisado.*pelo Núcleo de Acessibilidade/);
    assert.match(resHtml.payload, /data:image\/png;base64,/);
    assert.match(resHtml.payload, new RegExp(`/certificados/material/${material.id}`));

    // Download TXT
    const resTxt = await app.inject({
      method: 'GET',
      url: `/materiais/${material.id}/download?format=txt`
    });
    assert.equal(resTxt.statusCode, 200);
    assert.match(resTxt.payload, /SELO ACESSILIA/);
    assert.doesNotMatch(resTxt.payload, /UFG/i);
    assert.match(resTxt.payload, /DOCUMENTO ACESSIBILIZADO PELO ACESSILIA \(PROCESSAMENTO AUTOMÁTICO\)/);
    assert.match(resTxt.payload, /ESTE DOCUMENTO NÃO FOI REVISADO PELO NÚCLEO DE ACESSIBILIDADE/);
    assert.match(resTxt.payload, new RegExp(`/certificados/material/${material.id}`));

    // Download DOCX / PDF_UA / ZIP (todos com o cabeçalho)
    for (const fmt of ['docx', 'pdf_ua', 'zip']) {
      const resOther = await app.inject({
        method: 'GET',
        url: `/materiais/${material.id}/download?format=${fmt}`
      });
      assert.equal(resOther.statusCode, 200);
      const textPayload = resOther.payload.toString();
      assert.match(textPayload, /SELO ACESSILIA/);
      assert.doesNotMatch(textPayload, /UFG/i);
      assert.match(textPayload, /DOCUMENTO ACESSIBILIZADO PELO ACESSILIA/);
    }
  });

  await t.test('3. Certificado após Revisão Humana e Homologação NAI', async () => {
    const latestVersion = materialRepository.getLatestVersion(material.id);
    const review = await materialService.startReview(latestVersion.id, reviewer);
    await materialService.finishReview(review.id, 'APROVADO', { notes: 'Material 100% conforme WCAG 2.2 AAA' }, reviewer);

    const certData = certificateService.getCertificateData(material.id);
    assert.equal(certData.isApproved, true);
    assert.equal(certData.reviewerName, 'Ana Beatriz Souza (Revisora)');
    assert.ok(certData.approvalDateFormatted);

    // Consulta à rota pública do certificado com material homologado
    currentUser = null;
    const resPublic = await app.inject({
      method: 'GET',
      url: `/certificados/material/${material.id}`
    });

    assert.equal(resPublic.statusCode, 200);
    assert.match(resPublic.payload, /Documento Revisado e Aprovado pelo Núcleo de Acessibilidade/);
    assert.match(resPublic.payload, /Ana Beatriz Souza \(Revisora\)/);
    assert.doesNotMatch(resPublic.payload, /não foi revisado pelo Núcleo de Acessibilidade/);
    assert.doesNotMatch(resPublic.payload, /UFG/i);

    // Download HTML deve agora refletir a homologação com data de aprovação
    currentUser = student;
    const resHtmlApproved = await app.inject({
      method: 'GET',
      url: `/materiais/${material.id}/download?format=html`
    });
    assert.equal(resHtmlApproved.statusCode, 200);
    assert.match(resHtmlApproved.payload, /Documento revisado e aprovado pelo Núcleo de Acessibilidade/);
    assert.match(resHtmlApproved.payload, /Ana Beatriz Souza \(Revisora\)/);
    assert.doesNotMatch(resHtmlApproved.payload, /não foi revisado pelo Núcleo de Acessibilidade/);
    assert.doesNotMatch(resHtmlApproved.payload, /UFG/i);
  });

  await app.close();
});
