// Pix "copia e cola" (BR Code estático, padrão EMV do Banco Central) e QR code, gerados aqui no
// navegador a partir de config.js. Nenhum serviço externo é chamado.
(() => {
  const field = (id, value) => `${id}${String(value.length).padStart(2, '0')}${value}`;

  // CRC16-CCITT (polinômio 0x1021, valor inicial 0xFFFF), exigido no campo 63.
  function crc16(text) {
    let crc = 0xffff;
    for (let i = 0; i < text.length; i++) {
      crc ^= text.charCodeAt(i) << 8;
      for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }

  // Sem acentos e só caracteres aceitos pelos bancos.
  const clean = (s, max) => String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 .-]/g, '').trim().slice(0, max);

  function payload({ key, name, city }, amount) {
    const account = field('00', 'br.gov.bcb.pix') + field('01', String(key).trim());
    let out = field('00', '01') + field('26', account) + field('52', '0000') + field('53', '986');
    if (amount > 0) out += field('54', amount.toFixed(2));
    out += field('58', 'BR') + field('59', clean(name, 25)) + field('60', clean(city, 15));
    out += field('62', field('05', '***'));
    out += '6304';
    return out + crc16(out);
  }

  window.DOCX_pix = { payload, crc16 };

  const box = document.querySelector('[data-pix]');
  if (!box) return;
  const pix = (window.DOCX_SITE && window.DOCX_SITE.donate && window.DOCX_SITE.donate.pix) || {};
  if (!pix.key || !pix.name || !pix.city) {
    box.closest('[data-donate-card]').hidden = true;
    return;
  }

  const qrBox = box.querySelector('.pix-qr');
  const code = box.querySelector('.pix-code');
  let amount = 0;
  const render = () => {
    const text = payload(pix, amount);
    code.value = text;
    if (typeof window.qrcode === 'function') {
      const qr = window.qrcode(0, 'M');
      qr.addData(text);
      qr.make();
      qrBox.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
      const svg = qrBox.querySelector('svg');
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', amount ? `QR code Pix de R$ ${amount.toFixed(2)}` : 'QR code Pix');
    }
  };
  for (const btn of box.querySelectorAll('[data-amount]')) {
    btn.addEventListener('click', () => {
      const value = Number(btn.dataset.amount);
      amount = amount === value ? 0 : value;
      for (const b of box.querySelectorAll('[data-amount]')) b.setAttribute('aria-pressed', String(Number(b.dataset.amount) === amount));
      render();
    });
  }
  render();
})();
