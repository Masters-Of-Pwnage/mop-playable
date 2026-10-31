/**
 * PDF generation for printing decks — same layout as the original PrintPreview:
 * A4 portrait, 63×88 mm cards, 9 per page, a page of card backs (mirrored
 * columns) followed by the fronts so duplex printing lines them up.
 */
import { jsPDF } from 'jspdf';
import { backUrl, getCard, imageUrl } from '../stores/cards.js';

export const PRINT = { cardWidth: 63, cardHeight: 88, margin: 5, spacing: 5, cardsPerPage: 9 };

/** Loads an image and returns it as a PNG data URL with rounded corners. */
function loadRounded(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      const r = Math.round(img.width * 0.045);
      ctx.beginPath();
      ctx.roundRect(0, 0, canvas.width, canvas.height, r);
      ctx.clip();
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL('image/jpeg', 0.92));
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Expands a deck into the ordered list of cards (one entry per copy). */
export function expandForPrint(deck) {
  const out = [];
  for (const e of deck.cards) {
    const c = getCard(e.uid);
    if (c) for (let i = 0; i < e.amount; i += 1) out.push(c);
  }
  return out;
}

export function pages(deck) {
  const cards = expandForPrint(deck);
  const out = [];
  for (let i = 0; i < cards.length; i += PRINT.cardsPerPage) out.push(cards.slice(i, i + PRINT.cardsPerPage));
  return out;
}

export async function generatePdf(deck, onProgress = () => {}) {
  const cards = expandForPrint(deck);
  if (!cards.length) throw new Error('Nenhuma carta selecionada para impressão.');
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const { cardWidth, cardHeight, margin, spacing, cardsPerPage } = PRINT;
  const back = await loadRounded(backUrl('full'));
  const cache = new Map();
  const totalPages = Math.ceil(cards.length / cardsPerPage);
  for (let page = 0; page < totalPages; page += 1) {
    const pageCards = cards.slice(page * cardsPerPage, (page + 1) * cardsPerPage);
    // Backs: mirrored columns so they align with the fronts when printed duplex.
    pageCards.forEach((_, i) => {
      const row = Math.floor(i / 3);
      const col = 2 - (i % 3);
      if (back) pdf.addImage(back, 'JPEG', margin + col * (cardWidth + spacing), margin + row * (cardHeight + spacing), cardWidth, cardHeight);
    });
    pdf.addPage();
    for (let i = 0; i < pageCards.length; i += 1) {
      const card = pageCards[i];
      const row = Math.floor(i / 3);
      const col = i % 3;
      if (!cache.has(card.uid)) cache.set(card.uid, await loadRounded(imageUrl(card, 'full')));
      const data = cache.get(card.uid);
      if (data) pdf.addImage(data, 'JPEG', margin + col * (cardWidth + spacing), margin + row * (cardHeight + spacing), cardWidth, cardHeight);
      onProgress((page * cardsPerPage + i + 1) / cards.length);
    }
    if (page < totalPages - 1) pdf.addPage();
  }
  pdf.setProperties({ title: `${deck.name || 'Deck'} - Masters of Pwnage`, subject: 'Card Deck', creator: 'MOP Card Printer', author: deck.author || 'MOP' });
  const name = `${(deck.name || 'deck').toLowerCase().replace(/\s+/g, '-')}.pdf`;
  pdf.save(name);
  return name;
}
