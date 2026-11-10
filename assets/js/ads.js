// Anúncios do site, com consentimento (LGPD).
//
// - Sem `ads.adsenseClient` em config.js: nenhum script de terceiros é carregado e cada espaço
//   (.ad-slot) mostra um convite para apoiar o projeto.
// - Com o AdSense configurado: o visitante escolhe entre anúncios personalizados (usam cookies)
//   ou não personalizados. A escolha fica salva neste navegador e pode ser mudada no rodapé.
//
// Anúncios "limpos": a filtragem de categorias é feita no painel do AdSense (ver README.md,
// "Anúncios limpos"). Anúncios adultos não são permitidos na rede do AdSense.
(() => {
  const cfg = (window.DOCX_SITE && window.DOCX_SITE.ads) || {};
  const client = /^ca-pub-\d{10,20}$/.test(cfg.adsenseClient || '') ? cfg.adsenseClient : '';
  const slots = [...document.querySelectorAll('.ad-slot')];
  const KEY = 'docx.ads.consent'; // 'personalized' | 'non-personalized'

  const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  const write = (v) => { try { localStorage.setItem(KEY, v); } catch { /* sem storage: vale só nesta visita */ } };

  function houseAd(slot) {
    slot.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'house-ad';
    const p = document.createElement('p');
    const strong = document.createElement('strong');
    strong.textContent = 'O DocX é gratuito e sem anúncios dentro do app.';
    p.append(strong, document.createTextNode(' Se ele te ajuda, considere apoiar o desenvolvimento.'));
    const a = document.createElement('a');
    a.className = 'btn btn-ghost btn-sm';
    a.href = 'apoie.html';
    a.textContent = 'Apoiar o projeto';
    box.append(p, a);
    slot.append(box);
  }

  function loadAdsense(personalized) {
    window.adsbygoogle = window.adsbygoogle || [];
    if (!personalized) window.adsbygoogle.requestNonPersonalizedAds = 1;
    const s = document.createElement('script');
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
    document.head.append(s);
    for (const slot of slots) {
      const id = (cfg.slots || {})[slot.dataset.slot];
      if (!/^\d{6,20}$/.test(id || '')) { houseAd(slot); continue; }
      slot.innerHTML = '';
      const label = document.createElement('div');
      label.className = 'ad-label';
      label.textContent = 'Publicidade';
      const ins = document.createElement('ins');
      ins.className = 'adsbygoogle';
      ins.dataset.adClient = client;
      ins.dataset.adSlot = id;
      ins.dataset.adFormat = 'auto';
      ins.dataset.fullWidthResponsive = 'true';
      slot.append(label, ins);
      window.adsbygoogle.push({});
    }
  }

  function banner() {
    const box = document.createElement('div');
    box.className = 'consent';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Preferência de anúncios');
    box.innerHTML = `
      <p>Este site se mantém com anúncios do Google. Você pode permitir anúncios personalizados
      (usam cookies) ou ver apenas anúncios não personalizados.
      <a href="privacidade.html">Saiba mais</a>.</p>
      <div class="actions">
        <button type="button" class="btn btn-ghost btn-sm" data-choice="non-personalized">Só não personalizados</button>
        <button type="button" class="btn btn-primary btn-sm" data-choice="personalized">Aceitar</button>
      </div>`;
    box.addEventListener('click', (e) => {
      const choice = e.target.closest('[data-choice]')?.dataset.choice;
      if (!choice) return;
      write(choice);
      box.remove();
      loadAdsense(choice === 'personalized');
    });
    document.body.append(box);
  }

  // Link "Preferências de anúncios" no rodapé.
  for (const btn of document.querySelectorAll('[data-ad-prefs]')) {
    if (!client) { btn.hidden = true; continue; }
    btn.addEventListener('click', () => {
      try { localStorage.removeItem(KEY); } catch { /* ok */ }
      location.reload();
    });
  }

  if (!client) {
    slots.forEach(houseAd);
    return;
  }
  slots.forEach(houseAd); // até o visitante escolher
  const choice = read();
  if (choice === 'personalized' || choice === 'non-personalized') loadAdsense(choice === 'personalized');
  else banner();
})();
