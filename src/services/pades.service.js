// src/services/pades.service.js

const fs = require('fs/promises');
const path = require('path');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const { P12Signer } = require('@signpdf/signer-p12');
const { sign } = require('@signpdf/signpdf');
const { pdf_lib_add_placeholder } = require('@signpdf/placeholder-pdf-lib');

/**
 * Desenha os carimbos visuais de assinatura no PDF, incluindo a imagem da assinatura de cada signatário.
 * @param {PDFDocument} pdfDoc - O documento PDF carregado com pdf-lib.
 * @param {Array<object>} signatures - Array com os dados dos signatários, suas posições e o caminho da imagem da assinatura.
 */
const drawVisualStamps = async (pdfDoc, signatures) => {
  const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const stampWidth = 180;
  const stampHeight = 70;

  for (const sig of signatures) {
    // Pula signatários que não têm uma posição de carimbo definida
    if (sig.positionX === null || sig.positionY === null || sig.positionPage === null || !sig.artefactPath) {
      continue;
    }

    const pageIndex = sig.positionPage - 1; // A API é 1-based, o array é 0-based
    const page = pdfDoc.getPages()[pageIndex];
    if (!page) continue;

    const { width: pageWidth, height: pageHeight } = page.getSize();
    // Garante que o carimbo não seja desenhado fora dos limites da página
    const x = Math.min(Math.max(sig.positionX, 0), pageWidth - stampWidth);
    const y = Math.min(Math.max(sig.positionY, 0), pageHeight - stampHeight);

    // Carrega a imagem da assinatura salva no disco
    const signatureImagePath = path.join(__dirname, '..', '..', sig.artefactPath);
    const signatureImageBytes = await fs.readFile(signatureImagePath);
    const signatureImage = await pdfDoc.embedPng(signatureImageBytes);

    // Escala a imagem da assinatura para caber proporcionalmente no carimbo
    const imageDims = signatureImage.scaleToFit(stampWidth * 0.8, stampHeight * 0.6);

    // Desenha a imagem da assinatura no PDF, centralizada dentro da área do carimbo
    page.drawImage(signatureImage, {
      x: x + (stampWidth - imageDims.width) / 2,
      y: y + 20,
      width: imageDims.width,
      height: imageDims.height,
    });
    
    // Desenha o texto informativo (nome e data) abaixo da imagem da assinatura
    const signedAt = new Date(sig.signedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    page.drawText(`Assinado por: ${sig.name}\nEm: ${signedAt}`, {
        x: x + 5,
        y: y + 5,
        font: helveticaFont,
        size: 7,
        lineHeight: 9,
        color: rgb(0.2, 0.2, 0.2),
    });

    // Desenha uma borda sutil ao redor do carimbo
    page.drawRectangle({
      x,
      y,
      width: stampWidth,
      height: stampHeight,
      borderColor: rgb(0.7, 0.7, 0.7),
      borderWidth: 0.5,
    });
  }
};

/**
 * Aplica os carimbos visuais e uma assinatura digital PAdES criptográfica a um buffer de PDF.
 * @param {Buffer} pdfBuffer - O conteúdo do PDF original a ser assinado.
 * @param {Array<object>} signaturesToApply - Dados dos signatários com posições e caminhos de artefatos.
 * @returns {Promise<Buffer>} - O buffer do novo PDF finalizado e assinado digitalmente.
 */
const applyPadesSignatureWithStamps = async (pdfBuffer, signaturesToApply) => {
  try {
    // Carrega o certificado A1 da plataforma e a senha do .env
    const p12Buffer = await fs.readFile(process.env.PADES_CERTIFICATE_PATH);
    const signer = new P12Signer(p12Buffer, { password: process.env.PADES_CERTIFICATE_PASSWORD });

    // PASSO 1: Adicionar os carimbos visuais
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    await drawVisualStamps(pdfDoc, signaturesToApply);
    
    // Salva o PDF com os carimbos em um buffer intermediário
    const pdfWithStampsBuffer = await pdfDoc.save({ useObjectStreams: false });

    // PASSO 2: Aplicar a assinatura digital criptográfica
    // Carregamos o PDF (já com os carimbos) novamente para adicionar o placeholder da assinatura digital
    const placeholderPdf = await PDFDocument.load(pdfWithStampsBuffer);
    const finalPdf = await pdf_lib_add_placeholder({
      pdfDoc: placeholderPdf,
      reason: 'Documento finalizado e selado pela Plataforma Doculink',
      contactInfo: 'contato@doculink.com',
      name: 'Doculink Assinador Digital',
      location: 'Brasil',
    });

    // Assina digitalmente o documento (incluindo os carimbos), selando sua integridade
    const signedPdfBuffer = await sign(finalPdf, signer);
    return Buffer.from(signedPdfBuffer);

  } catch (error) {
    console.error('[PAdES Service] Erro ao aplicar assinatura digital com carimbos:', error);
    throw new Error('Falha no processo de assinatura digital PAdES.');
  }
};

module.exports = {
  applyPadesSignatureWithStamps,
};