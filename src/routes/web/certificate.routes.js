import { certificateService } from '../../services/certificate.service.js';

export async function certificateWebRoutes(fastify, opts) {
  // Página Pública de Autenticidade do Certificado Digital (acessível via escaneamento do QR Code)
  fastify.get('/certificados/material/:id', async (request, reply) => {
    const materialId = parseInt(request.params.id, 10);
    const host = request.headers.host || 'localhost:3000';
    const protocol = request.protocol || 'http';

    const certData = certificateService.getCertificateData(materialId, host, protocol);
    if (!certData) {
      return reply.status(404).send('Certificado não encontrado ou material inexistente.');
    }

    const qrCodeDataUrl = await certificateService.generateQrCodeDataUrl(certData.certificateUrl);

    return reply.view('certificates/show.ejs', {
      title: `Certificado de Acessibilidade — ${certData.title}`,
      cert: certData,
      qrCodeDataUrl,
      user: request.session?.get('user') || null
    });
  });
}
