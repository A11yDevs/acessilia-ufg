import QRCode from 'qrcode';
import { materialRepository } from '../repositories/material.repository.js';

export const certificateService = {
  /**
   * Gera um QR Code em Data URL (imagem base64 PNG)
   */
  async generateQrCodeDataUrl(url) {
    try {
      return await QRCode.toDataURL(url, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 180,
        color: {
          dark: '#0369a1',
          light: '#ffffff'
        }
      });
    } catch (err) {
      console.error('Erro ao gerar QR Code:', err);
      return null;
    }
  },

  /**
   * Obtém os metadados completos de conformidade e auditoria de um material
   */
  getCertificateData(materialId, reqHost = 'localhost:3000', reqProtocol = 'http') {
    const material = materialRepository.findMaterialById(materialId);
    if (!material) return null;

    const versions = materialRepository.getMaterialVersions(materialId);
    const botVersion = versions.find(v => v.version_type === 'PROCESSADO_BOT');
    const approvalReview = materialRepository.getApprovalReviewForMaterial(materialId);
    const latestVersion = versions[0];

    // Status de homologação humana
    const isApproved = material.current_status === 'APROVADO' || material.current_status === 'PUBLICADO' || !!approvalReview;
    const isProcessed = !!botVersion || versions.some(v => v.version_type !== 'ORIGINAL');

    const automaticDate = botVersion ? new Date(botVersion.created_at) : (latestVersion ? new Date(latestVersion.created_at) : new Date(material.created_at));
    const approvalDate = (approvalReview && approvalReview.finished_at) ? new Date(approvalReview.finished_at) : null;
    const reviewerName = (approvalReview && approvalReview.reviewer_name) ? approvalReview.reviewer_name : null;

    const certificateUrl = `${reqProtocol}://${reqHost}/certificados/material/${material.id}`;

    return {
      materialId: material.id,
      title: material.title,
      description: material.description,
      subjectName: material.subject_name,
      teacherName: material.teacher_name,
      currentStatus: material.current_status,
      isApproved,
      isProcessed,
      automaticDateFormatted: automaticDate ? automaticDate.toLocaleString('pt-BR') : null,
      automaticIsoDate: automaticDate ? automaticDate.toISOString() : null,
      approvalDateFormatted: approvalDate ? approvalDate.toLocaleString('pt-BR') : null,
      reviewerName,
      sha256Hash: latestVersion ? latestVersion.sha256_hash : 'N/A',
      certificateUrl
    };
  }
};
