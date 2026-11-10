// Página Apoie: se nenhuma forma de doação estiver configurada em config.js, avisa em vez de
// mostrar uma página vazia.
(() => {
  const cards = [...document.querySelectorAll('[data-donate-card]')];
  if (cards.length && cards.every((c) => c.hidden)) document.getElementById('no-donate').hidden = false;
})();
