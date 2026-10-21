import { certificateService } from '../../services/certificate.service.js';

export async function certificateWebRoutes(fastify, opts) {
  // Página Pública de Autenticidade do Certificado Digital (acessível via escaneamento do QR Code ou link direto)
  const certificateHandler = async (request, reply) => {
    const materialId = parseInt(request.params.id, 10);
    const host = request.headers.host || 'localhost:3000';
    const protocol = request.headers['x-forwarded-proto'] ||
                     (request.headers.referer?.startsWith('https') ? 'https' : null) ||
                     (host.includes('localhost') || host.includes('127.0.0.1') ? (request.protocol || 'http') : 'https');
    const isGestor = request.headers['x-forwarded-prefix'] === '/gestor' ||
                     request.headers.referer?.includes('/gestor') ||
                     request.raw?.url?.includes('/gestor') ||
                     (!host.includes('localhost') && !host.includes('127.0.0.1'));
    const urlPrefix = isGestor ? '/gestor' : (process.env.APP_URL_PREFIX || '');

    const certData = certificateService.getCertificateData(materialId, host, protocol, urlPrefix);
    if (!certData) {
      return reply.status(404).send('Certificado não encontrado ou material inexistente.');
    }
    // O certificado só existe depois que o Core processou o documento (automático,
    // ainda sem revisão) ou depois da aprovação humana.
    if (!certData.isProcessed && !certData.isApproved) {
      return reply.status(404).send('Certificado ainda não disponível: o material não foi processado pelo Acessilia.');
    }

    const qrCodeDataUrl = await certificateService.generateQrCodeDataUrl(certData.certificateUrl);

    return reply.view('certificates/show.ejs', {
      title: `Certificado de Acessibilidade — ${certData.title}`,
      cert: certData,
      qrCodeDataUrl,
      user: request.session?.get('user') || null
    });
  };

  // Suporte a ambas as rotas (direta e com prefixo /gestor do proxy reverso)
  fastify.get('/certificados/material/:id', certificateHandler);
  fastify.get('/gestor/certificados/material/:id', certificateHandler);
}
