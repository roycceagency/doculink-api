// src/services/pdf.service.js
'use strict';

const fs = require('fs/promises');
const path = require('path');
const { PDFDocument, rgb } = require('pdf-lib');

/**
 * Embute as imagens das assinaturas em um documento PDF.
 * @param {string} originalPdfPath - Caminho para o PDF original.
 * @param {Array<object>} signers - Lista de objetos de signatários que assinaram.
 * @returns {Buffer} - O buffer do novo PDF com as assinaturas embutidas.
 */
const embedSignatures = async (originalPdfPath, signers) => {
  try {
    const pdfBuffer = await fs.readFile(originalPdfPath);
    const pdfDoc = await PDFDocument.load(pdfBuffer);

    for (const signer of signers) {
      // Pula se o signatário não tiver uma assinatura ou posição definida
      if (!signer.signatureArtefactPath || signer.signaturePositionX == null) {
        continue;
      }
      
      const pageIndex = (signer.signaturePositionPage || 1) - 1;
      const page = pdfDoc.getPages()[pageIndex];
      if (!page) continue;

      // Carrega a imagem da assinatura
      const signatureImagePath = path.join(__dirname, '..', '..', signer.signatureArtefactPath);
      const signatureImageBytes = await fs.readFile(signatureImagePath);
      const signatureImage = await pdfDoc.embedPng(signatureImageBytes);

      // Converte as coordenadas salvas para o sistema da pdf-lib (canto inferior esquerdo)
      const { height } = page.getSize();
      const x = signer.signaturePositionX;
      const y = height - signer.signaturePositionY - 70; // 70 é a altura aproximada do carimbo

      // Desenha a imagem da assinatura na página
      page.drawImage(signatureImage, {
        x: x,
        y: y,
        width: 150, // Largura fixa para o carimbo
        height: 56, // Altura fixa para o carimbo
      });
    }

    // Salva o PDF modificado em um novo buffer
    const finalPdfBytes = await pdfDoc.save();
    return Buffer.from(finalPdfBytes);

  } catch (error) {
    console.error("Erro ao embutir assinaturas no PDF:", error);
    throw new Error("Falha ao gerar o documento final assinado.");
  }
};

module.exports = { embedSignatures };