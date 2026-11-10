// Comportamento comum a todas as páginas. Sem dependências e sem rastreamento.
(() => {
  const cfg = window.DOCX_SITE || {};
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const FILES = {
    windows: { file: 'DocX-Setup.exe', label: 'Baixar para Windows' },
    deb: { file: 'DocX-linux-amd64.deb', label: 'Baixar para Ubuntu / Debian' },
    appimage: { file: 'DocX-x86_64.AppImage', label: 'Baixar AppImage (Linux)' },
  };
  const downloadUrl = (key) => `https://github.com/${cfg.repo}/releases/latest/download/${FILES[key].file}`;
  const releasesUrl = `https://github.com/${cfg.repo}/releases/latest`;

  // ---- Links de download (data-download="windows|deb|appimage|auto") ----
  function detectOs() {
    const ua = navigator.userAgent || '';
    const platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
    if (/android|iphone|ipad|ipod/i.test(ua)) return 'mobile';
    if (/win/i.test(platform) || /windows/i.test(ua)) return 'windows';
    if (/mac/i.test(platform) || /mac os/i.test(ua)) return 'mac';
    if (/linux|x11/i.test(platform) || /linux/i.test(ua)) return 'linux';
    return 'unknown';
  }
  const os = detectOs();

  for (const a of $$('[data-download]')) {
    const kind = a.dataset.download;
    if (kind !== 'auto') {
      a.href = downloadUrl(kind);
      continue;
    }
    const label = $('.label', a) || a;
    if (os === 'windows') { a.href = downloadUrl('windows'); label.textContent = FILES.windows.label; }
    else if (os === 'linux') { a.href = downloadUrl('deb'); label.textContent = FILES.deb.label; }
    else { a.href = '#download'; label.textContent = os === 'mac' ? 'Ver downloads (macOS em breve)' : 'Ver downloads'; }
  }
  const recommended = os === 'windows' ? 'windows' : os === 'linux' ? 'deb' : null;
  if (recommended) {
    const card = $(`.dl-card[data-os="${recommended}"]`);
    if (card) {
      card.classList.add('recommended');
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = 'Recomendado para você';
      card.prepend(tag);
    }
  }
  for (const a of $$('[data-releases]')) a.href = releasesUrl;

  // ---- Versão mais recente (API pública do GitHub; se falhar, o texto padrão fica) ----
  async function latestRelease() {
    const key = 'docx.latest';
    try {
      const cached = JSON.parse(sessionStorage.getItem(key) || 'null');
      if (cached && Date.now() - cached.at < 30 * 60 * 1000) return cached.data;
    } catch { /* storage bloqueado */ }
    const res = await fetch(`https://api.github.com/repos/${cfg.repo}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error(String(res.status));
    const json = await res.json();
    const data = {
      version: String(json.tag_name || '').replace(/^v/, ''),
      date: json.published_at,
      sizes: Object.fromEntries((json.assets || []).map((x) => [x.name, x.size])),
    };
    try { sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), data })); } catch { /* ok */ }
    return data;
  }
  const mb = (bytes) => `${Math.round(bytes / 1024 / 1024)} MB`;
  if ($$('[data-version], [data-size]').length) {
    latestRelease().then((rel) => {
      if (!rel.version) return;
      const date = rel.date ? new Date(rel.date).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
      for (const el of $$('[data-version]')) {
        const mode = el.dataset.version;
        if (mode === 'long' && date) el.textContent = `Versão ${rel.version} · ${date}`;
        else if (mode === 'name' || mode === 'long') el.textContent = `Versão ${rel.version}`;
        else el.textContent = `v${rel.version}`;
      }
      for (const el of $$('[data-size]')) {
        const size = rel.sizes[FILES[el.dataset.size]?.file];
        if (size) el.textContent = mb(size);
      }
    }).catch(() => {});
  }

  // ---- Menu no celular ----
  const toggle = $('.menu-toggle');
  const nav = $('.nav');
  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });
    nav.addEventListener('click', (e) => { if (e.target.closest('a')) { nav.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false'); } });
  }

  // ---- Vídeos: carregam e tocam só quando aparecem na tela ----
  const videos = $$('video[data-autoplay]');
  if ('IntersectionObserver' in window && videos.length) {
    const io = new IntersectionObserver((entries) => {
      for (const { target, isIntersecting } of entries) {
        if (isIntersecting && !reduceMotion) {
          if (target.preload === 'none') target.preload = 'auto';
          target.play().catch(() => {});
        } else {
          target.pause();
        }
      }
    }, { threshold: 0.35 });
    for (const v of videos) {
      if (reduceMotion) v.setAttribute('controls', '');
      io.observe(v);
    }
  }

  // ---- Céu estrelado ao fundo (leve; parado se o sistema pede menos movimento) ----
  const canvas = $('.sky canvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    let stars = [];
    let w = 0;
    let h = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.round((w * h) / 9000);
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        r: Math.random() * 1.1 + 0.2, p: Math.random() * Math.PI * 2, s: 0.4 + Math.random() * 1.2,
      }));
    };
    const draw = (t) => {
      ctx.clearRect(0, 0, w, h);
      for (const st of stars) {
        const a = reduceMotion ? 0.6 : 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(st.p + (t / 1000) * st.s));
        ctx.globalAlpha = a;
        ctx.fillStyle = st.r > 1 ? '#cfc6ff' : '#ffffff';
        ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2); ctx.fill();
      }
      if (!reduceMotion && !document.hidden) requestAnimationFrame(draw);
    };
    resize();
    window.addEventListener('resize', () => { resize(); if (reduceMotion) draw(0); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && !reduceMotion) requestAnimationFrame(draw); });
    requestAnimationFrame(draw);
  }

  // ---- Ano no rodapé e "copiar" genérico ----
  for (const el of $$('[data-year]')) el.textContent = String(new Date().getFullYear());

  window.DOCX_toast = (text) => {
    const t = document.createElement('div');
    t.className = 'toast';
    t.setAttribute('role', 'status');
    t.textContent = text;
    document.body.append(t);
    setTimeout(() => t.remove(), 2200);
  };
  for (const btn of $$('[data-copy]')) {
    btn.addEventListener('click', async () => {
      const src = document.getElementById(btn.dataset.copy);
      const text = src ? (src.value ?? src.textContent) : '';
      try { await navigator.clipboard.writeText(text.trim()); window.DOCX_toast('Copiado!'); } catch { src?.select?.(); }
    });
  }

  // ---- Guia: destaca no índice a seção visível ----
  const tocLinks = $$('.toc a');
  if (tocLinks.length && 'IntersectionObserver' in window) {
    const byId = new Map(tocLinks.map((l) => [l.getAttribute('href').slice(1), l]));
    const tocIo = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        for (const l of tocLinks) l.classList.toggle('active', l === byId.get(e.target.id));
      }
    }, { rootMargin: '-30% 0px -60% 0px' });
    for (const id of byId.keys()) { const sec = document.getElementById(id); if (sec) tocIo.observe(sec); }
  }

  // ---- Contato ----
  for (const a of $$('[data-contact]')) {
    if (cfg.contact) { a.href = `mailto:${cfg.contact}`; a.textContent = cfg.contact; }
    else a.closest('[data-contact-block]').hidden = true;
  }

  // ---- Doação: esconde opções sem link configurado ----
  const d = cfg.donate || {};
  for (const a of $$('[data-donate]')) {
    const url = d[a.dataset.donate];
    if (url) a.href = url;
    else (a.closest('[data-donate-card]') || a).hidden = true;
  }
})();
