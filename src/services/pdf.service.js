// src/services/pdf.service.js
'use strict';

const fs = require('fs/promises');
const path = require('path');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

/**
 * Embute as assinaturas visuais detalhadas (Estilo Clicksign).
 */
const embedSignatures = async (originalPdfPath, signers, documentData) => {
  try {
    const resolvedPdfPath = path.isAbsolute(originalPdfPath)
      ? originalPdfPath
      : path.join(process.cwd(), originalPdfPath);

    const pdfBuffer = await fs.readFile(resolvedPdfPath);
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Dimensões do carimbo
    const stampWidth = 500; // Mais largo para caber o texto ao lado
    const stampHeight = 100;
    const verticalMargin = 30;

    // Pega a última página (ou cria uma nova se não couber, mas aqui vamos na ultima)
    // Se quiser adicionar uma página de logs separada (como na img1), a lógica seria: pdfDoc.addPage()
    // Aqui faremos desenhado na página (estilo img2)
    // Pega a última página para ver dimensões, mas SEMPRE cria uma nova para assinar
    // Isso evita sobreposição em documentos cheios
    let lastPage = pdfDoc.getPage(pdfDoc.getPageCount() - 1);
    const { width: pageWidth, height: pageHeight } = lastPage.getSize();

    // Adiciona SEMPRE uma nova página para garantir que não cubra nada
    let page = pdfDoc.addPage();
    let currentY = page.getHeight() - 50; // Começa do topo da NOVA página

    // Título da página de assinaturas se for nova página ou apenas rodapé
    page.drawText('Registro de Assinaturas', {
      x: 50,
      y: currentY,
      size: 14,
      font: helveticaBold,
      color: rgb(0, 0, 0),
    });
    currentY -= 40;

    // Filtra apenas os signatários que de fato assinaram
    const signedSigners = signers.filter(s => s.status === 'SIGNED');

    for (const signer of signedSigners) {
      // 1. Carrega Imagem da Assinatura (se tiver desenhado)
      let signatureImage = null;
      if (signer.signatureArtefactPath) {
        try {
          let imgPath = signer.signatureArtefactPath;
          if (!path.isAbsolute(imgPath)) imgPath = path.join(process.cwd(), imgPath);
          const imgBytes = await fs.readFile(imgPath);
          signatureImage = await pdfDoc.embedPng(imgBytes);
        } catch (e) { console.error('Erro img assinatura:', e); }
      }

      // 2. Prepara os Textos (Baseado na sua referência)
      const signedAt = new Date(signer.signedAt).toLocaleString('pt-BR');
      const docIdClean = documentData.id;
      const sigIdClean = signer.signatureUuid || signer.id; // Usa o UUID gerado

      const textLines = [
        `Assinado por: ${signer.name}`,
        `CPF: ${signer.cpf || 'Não informado'}`,
        `E-mail: ${signer.email}`,
        `Data/Hora: ${signedAt}`,
        `IP: ${signer.ip || 'Não registrado'}`,
        `ID Assinatura: ${sigIdClean}`,
        `Hash Doc: ${documentData.sha256 ? documentData.sha256.substring(0, 20) + '...' : 'N/A'}`
      ];

      // 3. Desenha a Imagem (Esquerda)
      if (signatureImage) {
        const imgDims = signatureImage.scaleToFit(150, 80);
        page.drawImage(signatureImage, {
          x: 50,
          y: currentY - 80,
          width: imgDims.width,
          height: imgDims.height
        });
      } else {
        // Placeholder se não tiver imagem desenhada
        page.drawText('(Assinatura Eletrônica)', {
          x: 60,
          y: currentY - 50,
          size: 10,
          font: helveticaFont,
          color: rgb(0.5, 0.5, 0.5)
        });
      }

      // 4. Desenha o Texto (Direita da imagem)
      let textY = currentY - 10;
      for (const line of textLines) {
        page.drawText(line, {
          x: 220, // Deslocado para direita
          y: textY,
          size: 9,
          font: helveticaFont,
          color: rgb(0.2, 0.2, 0.2),
        });
        textY -= 12; // Espaçamento entre linhas
      }

      // 5. Linha divisória
      page.drawLine({
        start: { x: 50, y: currentY - 90 },
        end: { x: 550, y: currentY - 90 },
        thickness: 1,
        color: rgb(0.8, 0.8, 0.8),
      });

      currentY -= 110; // Próximo bloco

      // Se estourar a página, cria nova
      if (currentY < 50) {
        page = pdfDoc.addPage();
        currentY = page.getHeight() - 50;
      }
    }

    const finalPdfBytes = await pdfDoc.save();
    return Buffer.from(finalPdfBytes);

  } catch (error) {
    console.error("[PDF Service] Erro:", error);
    throw error;
  }
};

module.exports = { embedSignatures };