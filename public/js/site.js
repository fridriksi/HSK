// Valmynd á farsíma, sía á félögum og myndaskoðari
(() => {
  const toggle = document.querySelector('.menu-toggle');
  const nav = document.getElementById('valmynd');
  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });
  }

  document.querySelectorAll('[data-filter]').forEach((input) => {
    const items = [...document.querySelectorAll(input.dataset.filter)];
    const empty = input.dataset.empty ? document.querySelector(input.dataset.empty) : null;
    // Öll orð í leitinni þurfa að koma fyrir (hástafir skipta ekki máli)
    const norm = (t) => t.toLowerCase().replace(/\s+/g, ' ');
    const filter = () => {
      const words = norm(input.value).trim().split(' ').filter(Boolean);
      let shown = 0;
      items.forEach((el) => {
        const text = norm(el.dataset.text || el.textContent);
        el.hidden = !words.every((w) => text.includes(w));
        if (!el.hidden) shown++;
        // Felligluggar sem passa við leit opnast; þeir lokast aftur þegar leitin er hreinsuð
        if (el.tagName === 'DETAILS') {
          if (words.length && !el.hidden && !el.open) { el.open = true; el.dataset.autoOpened = '1'; }
          if (!words.length && el.dataset.autoOpened) { el.open = false; delete el.dataset.autoOpened; }
        }
      });
      if (empty) empty.hidden = shown > 0;
    };
    input.addEventListener('input', filter);
    if (input.value) filter();
  });

  // Finndu félag: val á íþróttagrein leitar strax
  document.querySelectorAll('select[data-fill-q]').forEach((sel) => {
    sel.addEventListener('change', () => { if (sel.value) { sel.form.q.value = sel.value; sel.form.submit(); } });
  });

  // Síur sem uppfærast strax þegar valið er
  document.querySelectorAll('select[data-autosubmit]').forEach((sel) => sel.addEventListener('change', () => sel.form.submit()));

  // Opna fellikafla sem vísað er á með # (t.d. eldra héraðsþing)
  const openHash = () => { const el = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1))); if (el && el.tagName === 'DETAILS') { el.open = true; el.scrollIntoView(); } };
  openHash(); window.addEventListener('hashchange', openHash);
  // Opinn felligluggi fær eigin slóð (#kafli) svo hægt sé að deila honum
  document.querySelectorAll('details.acc[id]').forEach((d) => d.addEventListener('toggle', () => {
    if (d.open) history.replaceState(null, '', '#' + d.id);
    else if (location.hash === '#' + d.id) history.replaceState(null, '', location.pathname + location.search);
  }));

  const gallery = document.querySelector('[data-gallery]');
  if (gallery) {
    const links = [...gallery.querySelectorAll('a')];
    let idx = 0;
    let box = null;
    const show = (i) => {
      idx = (i + links.length) % links.length;
      box.querySelector('img').src = links[idx].href;
      box.querySelector('img').alt = links[idx].dataset.caption || '';
      box.querySelector('p').textContent = links[idx].dataset.caption || '';
    };
    const close = () => { box?.remove(); box = null; links[idx]?.focus(); };
    gallery.addEventListener('click', (e) => {
      const a = e.target.closest('a');
      if (!a) return;
      e.preventDefault();
      box = document.createElement('div');
      box.className = 'lightbox';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-label', 'Myndaskoðari');
      const svg = (d) => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
      box.innerHTML = `<img alt=""><p></p><button class="lb-close" aria-label="Loka">${svg('M6 6l12 12M18 6L6 18')}</button><button class="lb-prev" aria-label="Fyrri mynd">${svg('M15 6l-6 6 6 6')}</button><button class="lb-next" aria-label="Næsta mynd">${svg('M9 6l6 6-6 6')}</button>`;
      box.querySelector('.lb-close').onclick = close;
      box.querySelector('.lb-prev').onclick = () => show(idx - 1);
      box.querySelector('.lb-next').onclick = () => show(idx + 1);
      box.addEventListener('click', (ev) => { if (ev.target === box) close(); });
      document.body.appendChild(box);
      show(links.indexOf(a));
      box.querySelector('.lb-close').focus();
    });
    document.addEventListener('keydown', (e) => {
      if (!box) return;
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft') show(idx - 1);
      if (e.key === 'ArrowRight') show(idx + 1);
    });
  }
})();
