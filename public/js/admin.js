// Vefumsjón HSK: ritill, upphleðsla með sjálfvirkri minnkun mynda, albúm og staðfestingar
(() => {
  const MAX_SIDE = 2000;   // lengsta hlið myndar eftir minnkun
  const QUALITY = 0.85;

  /** Minnkar stórar myndir í vafranum áður en þær eru sendar */
  async function shrink(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 400 * 1024) return file;
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
      if (scale === 1 && file.size < 2.5 * 1024 * 1024) return file;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bmp.width * scale);
      canvas.height = Math.round(bmp.height * scale);
      canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
      const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
      const blob = await new Promise((r) => canvas.toBlob(r, type, QUALITY));
      if (!blob || blob.size >= file.size) return file;
      const name = file.name.replace(/\.[^.]+$/, '') + (type === 'image/png' ? '.png' : '.jpg');
      return new File([blob], name, { type });
    } catch {
      return file;
    }
  }

  async function upload(file) {
    const fd = new FormData();
    fd.append('file', await shrink(file));
    const res = await fetch('/stjorn/upload', { method: 'POST', body: fd, credentials: 'same-origin' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Upphleðsla mistókst');
    return json.location;
  }

  // Ritill (TinyMCE 6)
  if (window.tinymce && document.querySelector('textarea.rte')) {
    const base = {
      menubar: false,
      branding: false,
      promotion: false,
      license_key: 'gpl',
      language: 'is_IS',
      language_url: document.querySelector('script[data-tinymce-is]')?.dataset.tinymceIs || '/js/tinymce-is.js',
      content_style: 'ul.link-list{list-style:none;padding:0;border-top:1px solid #e3e8f2} ul.link-list li{border-bottom:1px solid #e3e8f2;padding:8px 0;font-weight:600} body{font-family:"Source Sans 3",system-ui,sans-serif;font-size:17px;line-height:1.6;color:#16203f;max-width:760px;margin:16px auto} table{border-collapse:collapse} td,th{border:1px solid #e3e8f2;padding:6px 8px} img{max-width:100%;height:auto}',
      convert_urls: false,
      entity_encoding: 'raw',
      relative_urls: false,
      paste_data_images: true,
      images_upload_handler: (blobInfo) => upload(new File([blobInfo.blob()], blobInfo.filename(), { type: blobInfo.blob().type })),
      file_picker_types: 'file image',
      file_picker_callback: (cb, _value, meta) => {
        const input = document.createElement('input');
        input.type = 'file';
        if (meta.filetype === 'image') input.accept = 'image/*';
        input.onchange = async () => {
          const f = input.files[0];
          if (!f) return;
          try { cb(await upload(f), { text: f.name, alt: '' }); } catch (e) { alert(e.message); }
        };
        input.click();
      },
      link_default_target: '',
      table_default_attributes: {},
      table_default_styles: { width: '100%' },
      block_formats: 'Málsgrein=p; Fyrirsögn=h2; Undirfyrirsögn=h3; Smáfyrirsögn=h4',
      // Listi af tenglum birtist sem snyrtilegur tenglalisti á vefnum (eins og á Lög og reglugerðir)
      style_formats: [{ title: 'Tenglalisti', selector: 'ul', classes: 'link-list' }],
      style_formats_autohide: true,
    };
    tinymce.init({
      ...base,
      selector: 'textarea.rte:not(.rte-small)',
      height: 520,
      plugins: 'lists link image table autolink media code wordcount',
      toolbar: 'blocks styles | bold italic | bullist numlist | link image media table | blockquote alignleft aligncenter | removeformat code',
    });
    tinymce.init({ ...base, selector: 'textarea.rte-small', height: 160, plugins: 'link autolink', toolbar: 'bold italic link | removeformat' });
  }

  // Mynda- og skjalareitir
  document.querySelectorAll('.upload-field').forEach((box) => {
    const text = box.querySelector('input[type=text]');
    const file = box.querySelector('input[type=file]');
    const preview = box.querySelector('img.preview');
    const sync = () => { if (preview) { preview.src = text.value; preview.hidden = !text.value; } };
    text.addEventListener('input', sync);
    box.querySelector('[data-clear]').addEventListener('click', () => { text.value = ''; sync(); });
    file.addEventListener('change', async () => {
      if (!file.files[0]) return;
      box.classList.add('busy');
      try { text.value = await upload(file.files[0]); sync(); } catch (e) { alert(e.message); }
      box.classList.remove('busy');
      file.value = '';
    });
  });

  const recordForm = document.querySelector('form[data-record-import]');
  if (recordForm) {
    const attachment = recordForm.elements.namedItem('file');
    const sheets = recordForm.elements.namedItem('record_sheets');
    const status = recordForm.querySelector('[data-record-status]');
    let preparedFor = '';
    let working = false;
    const message = (text, error = false) => {
      status.hidden = !text;
      status.textContent = text;
      status.className = error ? 'flash err' : 'muted';
    };
    recordForm.addEventListener('submit', async (event) => {
      if (working || recordForm.querySelector('.upload-field.busy')) {
        event.preventDefault();
        message(working ? 'Útbý vef­töflu…' : 'Bíddu þar til upphleðslan klárast.');
        return;
      }
      const source = attachment.value.trim();
      if (source !== preparedFor) sheets.value = '';
      if (!/^\/media\/uploads\/\d{4}\/\d{2}\/[\w-]+\.xlsx$/i.test(source) || source === recordForm.dataset.recordReady || source === preparedFor) return;
      event.preventDefault();
      working = true;
      message('Útbý vef­töflu…');
      try {
        const { importRecordBook } = await import(recordForm.dataset.recordImport);
        const file = await fetch(source);
        if (!file.ok) throw new Error('Excel-skráin fannst ekki. Hladdu henni upp aftur.');
        const data = await importRecordBook(await file.blob());
        if (attachment.value.trim() !== source) {
          message('Metaskránni var breytt. Vistaðu aftur til að lesa nýju skrána.');
          return;
        }
        sheets.value = data;
        preparedFor = source;
        working = false;
        recordForm.requestSubmit(event.submitter || undefined);
      } catch (error) {
        message(error instanceof Error ? error.message : 'Ekki tókst að útbúa vef­töflu.', true);
      } finally {
        working = false;
      }
    });
  }

  // Fjölupphleðsla: myndasafn og albúm
  document.querySelectorAll('.upload-drop:not([data-doc-upload])').forEach((drop) => {
    const input = drop.querySelector('input[type=file]');
    const bar = drop.querySelector('progress');
    const albumId = drop.dataset.album;
    async function handle(files) {
      files = [...files];
      if (!files.length) return;
      bar.hidden = false; bar.max = files.length; bar.value = 0;
      const errors = [];
      for (const f of files) {
        try {
          const src = await upload(f);
          if (albumId) {
            const r = await fetch(`/stjorn/myndasofn/${albumId}/baeta`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ src }) });
            if (!r.ok) throw new Error('Ekki tókst að bæta mynd í albúm');
          }
        } catch (e) { errors.push(`${f.name}: ${e.message}`); }
        bar.value += 1;
      }
      if (errors.length) alert('Sumar skrár fóru ekki upp:\n' + errors.join('\n'));
      location.reload();
    }
    input.addEventListener('change', () => handle(input.files));
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); handle(e.dataTransfer.files); });
  });

  // Úrslit: þegar mót er valið úr „Mót og viðburðir“ fyllast heiti, dagsetning og grein út.
  // Reitum sem notandinn hefur sjálfur breytt er ekki skrifað yfir.
  const resEvent = document.getElementById('f_event_id');
  if (resEvent && location.pathname.startsWith('/stjorn/urslit')) {
    const targets = { title: 'f_title', date: 'f_date', sport: 'f_sport' };
    const auto = {};
    for (const [k, id] of Object.entries(targets)) { const el = document.getElementById(id); if (el) auto[k] = el.value; }
    resEvent.addEventListener('change', () => {
      const o = resEvent.selectedOptions[0];
      if (!o || !o.dataset.title) return;
      for (const [k, id] of Object.entries(targets)) {
        const el = document.getElementById(id);
        const val = o.dataset[k] || '';
        if (!el || !val || (el.value && el.value !== auto[k])) continue;
        if (el.tagName === 'SELECT' && ![...el.options].some((x) => x.value === val)) continue;
        el.value = val;
        auto[k] = val;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.closest('.field')?.classList.add('ai-filled');
      }
    });
  }

  // „Hætta við“: aftur á fyrri lista. Ef komið var af listanum er farið til baka svo síur og blaðsíða haldist.
  document.querySelectorAll('a[data-back]').forEach((a) => {
    a.addEventListener('click', (e) => {
      let ref = null;
      try { ref = document.referrer ? new URL(document.referrer) : null; } catch { ref = null; }
      if (ref && ref.origin === location.origin && ref.pathname === a.getAttribute('href') && history.length > 1) {
        e.preventDefault();
        history.back();
      }
    });
  });

  // Samskipti: ritill fyrir útsendingu (sjálfvirk vistun, flipar, viðtakendur, staðfesting)
  const camp = document.querySelector('form.camp-editor');
  if (camp) {
    const id = camp.dataset.campaign;
    const savedEl = camp.querySelector('[data-saved]');
    const countEl = camp.querySelector('[data-aud-count]');
    const sendBtn = camp.querySelector('[data-send]');
    const fmt = (n) => Number(n).toLocaleString('de-DE');
    let timer = null;
    let saving = Promise.resolve();
    const save = () => {
      if (camp.querySelector('[name=subject]')?.disabled) return saving;
      window.tinymce?.triggerSave?.();
      saving = fetch(`/stjorn/samskipti/${id}/vista`, { method: 'POST', body: new FormData(camp), credentials: 'same-origin' })
        .then((r) => r.ok ? r.json() : null)
        .then((d) => {
          if (!d) return;
          savedEl.textContent = `Vistað kl. ${d.saved}`;
          countEl.textContent = d.empty ? 'Enginn hópur valinn' : `${fmt(d.total)} í hópi · ${fmt(d.sendable)} hægt að senda á`;
          if (sendBtn && !sendBtn.textContent.startsWith('Senda til')) sendBtn.textContent = `Senda á ${fmt(d.sendable)} viðtakendur`;
          if (sendBtn) sendBtn.dataset.confirmClick = `Senda á ${d.sendable} viðtakendur?`;
        }).catch(() => {});
      return saving;
    };
    const schedule = () => { clearTimeout(timer); savedEl.textContent = 'Óvistaðar breytingar…'; timer = setTimeout(save, 1200); };
    camp.addEventListener('input', (e) => { if (!e.target.closest('.aud-search')) schedule(); });
    camp.addEventListener('change', (e) => { if (!e.target.closest('.aud-search') && e.target.name !== 'source') schedule(); });
    window.tinymce?.on?.('AddEditor', ({ editor }) => editor.on('input change', schedule));

    // Skrifa / Forskoða
    camp.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', async () => {
      camp.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === b));
      camp.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== b.dataset.tab; });
      if (b.dataset.tab === 'forskoda') {
        await save();
        const frame = camp.querySelector('.camp-preview');
        frame.src = frame.dataset.src + '?t=' + Date.now();
      }
    }));

    // Leit í félögum og Allir / Fjarlægja
    const search = camp.querySelector('.aud-search');
    const items = [...camp.querySelectorAll('.aud-list .check')];
    search?.addEventListener('input', () => { const q = search.value.trim().toLowerCase(); items.forEach((l) => { l.hidden = !!q && !l.dataset.name.includes(q); }); });
    camp.querySelector('[data-aud-all]')?.addEventListener('click', () => { items.filter((l) => !l.hidden).forEach((l) => { l.querySelector('input').checked = true; }); schedule(); });
    camp.querySelector('[data-aud-none]')?.addEventListener('click', () => { items.forEach((l) => { l.querySelector('input').checked = false; }); schedule(); });

    // Staðfesting á hnöppum (sending, eyðing, sækja efni). Vistar fyrst svo ekkert glatist.
    camp.addEventListener('submit', (e) => {
      const b = e.submitter;
      window.tinymce?.triggerSave?.();
      if (b?.dataset.confirmClick && !confirm(b.dataset.confirmClick)) e.preventDefault();
    });
    // Enter í reit á ekki að senda formið (sjálfvirk vistun sér um það)
    camp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); save(); } });
    camp.querySelector('[data-aud-csv]')?.addEventListener('click', async (e) => { e.preventDefault(); await save(); location.href = e.target.href; });
  }

  // Hnappar með data-confirm-btn biðja um staðfestingu áður en formið er sent (t.d. hafna umsókn)
  document.addEventListener('submit', (e) => {
    const msg = e.submitter?.dataset?.confirmBtn;
    if (msg && !confirm(msg)) e.preventDefault();
  });

  // Umsóknarform Verkefnasjóðs: bæta við, færa og eyða reitum
  const ffList = document.querySelector('[data-ff-list]');
  if (ffList) {
    const tpl = document.querySelector('[data-ff-template]');
    const wire = (row) => {
      const type = row.querySelector('[data-ff-type]');
      const opts = row.querySelector('[data-ff-options]');
      type?.addEventListener('change', () => { opts.hidden = type.value !== 'select'; });
      row.querySelector('[data-ff-up]').addEventListener('click', () => { if (row.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling); });
      row.querySelector('[data-ff-down]').addEventListener('click', () => { if (row.nextElementSibling) row.parentNode.insertBefore(row.nextElementSibling, row); });
      row.querySelector('[data-ff-remove]')?.addEventListener('click', () => { if (confirm('Fjarlægja reitinn úr forminu?')) row.remove(); });
    };
    ffList.querySelectorAll('[data-ff-row]').forEach(wire);
    document.querySelector('[data-ff-add]').addEventListener('click', () => {
      const row = tpl.content.firstElementChild.cloneNode(true);
      ffList.append(row);
      wire(row);
      row.querySelector('input[name=field_label]').focus();
    });
  }

  // Röðun með því að draga línur (t.d. stjórnir og nefndir); örvar fyrir síma og lyklaborð. Vistast strax.
  document.querySelectorAll('tbody[data-sortable]').forEach((body) => {
    const status = document.querySelector('[data-sort-status]');
    let dragged = null;
    const save = async () => {
      const ids = [...body.querySelectorAll('tr[data-id]')].map((tr) => tr.dataset.id);
      if (status) status.textContent = 'Vista röð…';
      try {
        const r = await fetch(body.dataset.sortable, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
        if (!r.ok) throw new Error();
        if (status) status.textContent = 'Röð vistuð.';
      } catch { if (status) status.textContent = 'Ekki tókst að vista röðina. Endurhlaðið síðuna og reynið aftur.'; }
    };
    body.addEventListener('dragstart', (e) => {
      dragged = e.target.closest('tr[data-id]');
      if (!dragged) return;
      dragged.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragged.dataset.id);
    });
    body.addEventListener('dragover', (e) => {
      if (!dragged) return;
      e.preventDefault();
      const over = e.target.closest('tr[data-id]');
      if (!over || over === dragged) return;
      const box = over.getBoundingClientRect();
      over.parentNode.insertBefore(dragged, e.clientY > box.top + box.height / 2 ? over.nextSibling : over);
    });
    body.addEventListener('drop', (e) => e.preventDefault());
    body.addEventListener('dragend', () => {
      if (!dragged) return;
      dragged.classList.remove('dragging');
      dragged = null;
      save();
    });
    body.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-move]');
      if (!btn) return;
      const tr = btn.closest('tr');
      const other = btn.dataset.move === '-1' ? tr.previousElementSibling : tr.nextElementSibling;
      if (!other) return;
      if (btn.dataset.move === '-1') tr.parentNode.insertBefore(tr, other);
      else tr.parentNode.insertBefore(other, tr);
      btn.focus();
      save();
    });
  });

  // Myndir og skjöl: eyða einni skrá eða mörgum völdum, með staðfestingu
  const mediaForm = document.querySelector('form[data-media-delete]');
  if (mediaForm) {
    const bar = mediaForm.querySelector('.media-select-bar');
    const count = mediaForm.querySelector('[data-selected-count]');
    const boxes = () => [...mediaForm.querySelectorAll('input[name=keys]:checked')];
    const update = () => {
      const n = boxes().length;
      bar.hidden = n === 0;
      count.textContent = n === 1 ? '1 valin' : `${n} valdar`;
      mediaForm.querySelectorAll('input[name=keys]').forEach((b) => b.closest('figure').classList.toggle('selected', b.checked));
    };
    mediaForm.addEventListener('change', (e) => { if (e.target.name === 'keys') update(); });
    mediaForm.querySelector('[data-select-none]').addEventListener('click', () => { boxes().forEach((b) => { b.checked = false; }); update(); });
    mediaForm.addEventListener('submit', (e) => {
      const btn = e.submitter;
      const msg = btn && btn.name === 'key'
        ? `Eyða „${btn.dataset.name}“? Það er ekki hægt að afturkalla.`
        : `Eyða ${boxes().length} völdum skrám? Það er ekki hægt að afturkalla.`;
      if (!confirm(msg)) e.preventDefault();
    });
    update();
  }

  // Síðutré: sýna/fela kafla undir yfirsíðu
  document.querySelectorAll('[data-unfold]').forEach((btn) => {
    const label = btn.textContent;
    btn.addEventListener('click', () => {
      const rows = document.querySelectorAll('tr.' + btn.dataset.unfold);
      const open = btn.getAttribute('aria-expanded') !== 'true';
      rows.forEach((r) => { r.hidden = !open; });
      btn.setAttribute('aria-expanded', String(open));
      btn.textContent = open ? 'Fela kafla' : label;
    });
  });


  // Héraðsþing: þinggögn sem röð af skjölum (hlaða upp mörgum, breyta heiti, raða, fjarlægja)
  const docRows = document.querySelector('[data-doc-rows]');
  if (docRows) {
    const tpl = document.getElementById('doc-row-tpl');
    const wire = (row) => {
      row.querySelector('[data-doc-remove]').addEventListener('click', () => row.remove());
      row.querySelector('[data-doc-up]').addEventListener('click', () => { if (row.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling); });
      row.querySelector('[data-doc-down]').addEventListener('click', () => { if (row.nextElementSibling) row.parentNode.insertBefore(row.nextElementSibling, row); });
    };
    docRows.querySelectorAll('.doc-row').forEach(wire);
    const drop = document.querySelector('[data-doc-upload]');
    const input = drop.querySelector('input[type=file]');
    const bar = drop.querySelector('progress');
    const add = async (files) => {
      files = [...files];
      if (!files.length) return;
      bar.hidden = false; bar.max = files.length; bar.value = 0;
      for (const f of files) {
        try {
          const url = await upload(f);
          const row = tpl.content.firstElementChild.cloneNode(true);
          row.querySelector('input[name=doc_title]').value = f.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ');
          row.querySelector('input[name=doc_file]').value = url;
          const a = row.querySelector('.doc-file'); a.href = url; a.textContent = f.name;
          docRows.appendChild(row); wire(row);
          row.closest('form').dispatchEvent(new Event('input', { bubbles: true }));
        } catch (e) { alert(`${f.name}: ${e.message}`); }
        bar.value += 1;
      }
      bar.hidden = true; input.value = '';
    };
    input.addEventListener('change', () => add(input.files));
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); add(e.dataTransfer.files); });
  }

  // Fellilisti með gátreitum (t.d. íþróttagreinar félags)
  document.querySelectorAll('details[data-multi]').forEach((d) => {
    const label = d.querySelector('[data-multi-label]');
    d.addEventListener('change', () => {
      const picked = [...d.querySelectorAll('input:checked')].map((i) => i.value);
      label.textContent = picked.length ? picked.join(', ') : label.dataset.empty;
    });
    document.addEventListener('click', (e) => { if (d.open && !d.contains(e.target)) d.open = false; });
  });

  // Mót og viðburðir: líma inn texta (boðsbréf, tölvupóst) og fylla reitina út eftir reglum. Allt gerist í vafranum.
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'maí', 'jún', 'júl', 'ágú', 'sep', 'okt', 'nóv', 'des'];
  const SPORT_WORDS = [
    [/frjáls|langstökk|hástökk|kúluvarp|spjótkast|kringlukast|hlaup/i, 'Frjálsíþróttir'], [/\bsund/i, 'Sund'], [/glím/i, 'Glíma'],
    [/golf/i, 'Golf'], [/knattspyrn|fótbolt/i, 'Knattspyrna'], [/körfu/i, 'Körfuknattleikur'], [/handknatt|handbolt/i, 'Handknattleikur'],
    [/blak/i, 'Blak'], [/borðtenn/i, 'Borðtennis'], [/bogfim/i, 'Bogfimi'], [/fimleik/i, 'Fimleikar'], [/hesta|reiðmennsk|tölt/i, 'Hestaíþróttir'],
    [/júdó/i, 'Júdó'], [/motocross/i, 'Motocross'], [/pílu/i, 'Pílukast'], [/\bskák/i, 'Skák'], [/skotfimi|skotíþrótt/i, 'Skotíþróttir'],
    [/starfsíþrótt/i, 'Starfsíþróttir'], [/taekwondo/i, 'Taekwondo'], [/almenningshlaup|almenningsíþrótt|hreyfivika/i, 'Almenningsíþróttir'],
  ];
  const PLACES = ['Selfoss', 'Hveragerði', 'Þorlákshöfn', 'Hella', 'Hellu', 'Hvolsvöll', 'Laugarvatn', 'Flúðum', 'Flúðir', 'Reykholt', 'Borg',
    'Árnes', 'Stokkseyri', 'Eyrarbakka', 'Laugaland', 'Aratung', 'Þjórsárver', 'Brautarholt', 'Sandvík', 'Kirkjubæjarklaustr', 'Vík', 'Hvoli', 'Vesturbyggð'];
  const pad = (n) => String(n).padStart(2, '0');
  const escHtml = (t) => t.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

  // Allar dagsetningar í línu: „14. mars 2027“, „14.–15. mars“, „14.3.2027“, „14/3“
  function datesIn(line) {
    const out = [];
    const monthRe = /(\d{1,2})\.?\s*(?:[–-]\s*(\d{1,2})\.?\s*)?(jan|feb|mar|apr|maí|mai|jún|jun|júl|jul|ágú|ag|sep|okt|nóv|nov|des)[a-zúíáéóöæþð]*\.?(?:\s+(\d{4}))?/gi;
    let m;
    while ((m = monthRe.exec(line))) {
      const key = m[3].toLowerCase().replace('mai', 'maí').replace('jun', 'jún').replace('jul', 'júl').replace(/^ag$/, 'ágú').replace('nov', 'nóv');
      const mo = MONTHS.indexOf(key.slice(0, 3)) + 1;
      if (mo) out.push({ day: +m[1], end: m[2] ? +m[2] : 0, month: mo, year: m[4] ? +m[4] : 0, at: m.index });
    }
    const numRe = /\b(\d{1,2})[./](\d{1,2})(?:[./](\d{4}))?\b(?!\s*(?:km|m\b|ára|kr))/g;
    while ((m = numRe.exec(line))) {
      if (+m[2] >= 1 && +m[2] <= 12 && +m[1] >= 1 && +m[1] <= 31 && (m[3] || /[./]/.test(m[0]))) {
        if (!m[3] && /kl\.?\s*$/i.test(line.slice(0, m.index))) continue; // „kl. 10.30“ er tími
        out.push({ day: +m[1], end: 0, month: +m[2], year: m[3] ? +m[3] : 0, at: m.index });
      }
    }
    return out.sort((a, b) => a.at - b.at);
  }
  function isoDate(d, today) {
    let y = d.year || today.getFullYear();
    if (!d.year && new Date(y, d.month - 1, d.day) < new Date(today.getFullYear(), today.getMonth(), today.getDate())) y++;
    return `${y}-${pad(d.month)}-${pad(d.day)}`;
  }
  const timeIn = (line) => {
    const m = line.match(/(?:kl\.?|klukkan)\s*(\d{1,2})(?:[.:](\d{2}))?/i) || line.match(/\b(\d{1,2})[:](\d{2})\b/);
    return m && +m[1] < 24 ? `${pad(m[1])}:${m[2] || '00'}` : '';
  };

  function parseEvent(text, clubs) {
    const today = new Date();
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const f = {};
    const label = (re) => { for (const l of lines) { const m = l.match(new RegExp('^(?:' + re + ')\\s*[:–-]\\s*(.+)$', 'i')); if (m) return m[1].trim(); } return ''; };

    // Heiti: fyrsta lína ef hún er stutt, annars fyrsta setning
    const first = lines[0] || '';
    f.title = (first.length <= 90 ? first : first.split(/[.!?](\s|$)/)[0]).replace(/[.:]$/, '').slice(0, 120);

    // Dagsetningar: skráningarfrestur úr línu sem nefnir skráningu/frest, annars fyrsta dagsetning er upphaf
    let start = null; let deadline = null; let startLine = '';
    for (const l of lines) {
      const ds = datesIn(l);
      if (!ds.length) continue;
      if (/skráning\w*\s*(lýkur|frest)|frest\w*|skrá\w* (fyrir|í síðasta lagi|eigi síðar)|síðasti skráningardagur/i.test(l)) { if (!deadline) deadline = ds[ds.length - 1]; continue; }
      if (!start) { start = ds[0]; startLine = l; if (ds[1] && !start.end) start.endDate = ds[1]; }
    }
    if (start) {
      const t = timeIn(startLine) || timeIn(label('tími|klukkan|hefst|keppni hefst'));
      f.starts_at = `${isoDate(start, today)}T${t || '00:00'}`;
      const endD = start.end ? { ...start, day: start.end } : start.endDate;
      if (endD) {
        const ts = startLine.match(/(\d{1,2})(?:[.:](\d{2}))?\s*[–-]\s*(\d{1,2})(?:[.:](\d{2}))?/);
        f.ends_at = `${isoDate({ ...endD, year: endD.year || start.year }, today)}T${ts && +ts[3] < 24 && !start.end ? pad(ts[3]) + ':' + (ts[4] || '00') : '00:00'}`;
      } else {
        const range = startLine.match(/(?:kl\.?|klukkan)\s*\d{1,2}(?:[.:]\d{2})?\s*[–-]\s*(\d{1,2})(?:[.:](\d{2}))?/i);
        if (range && +range[1] < 24) f.ends_at = `${isoDate(start, today)}T${pad(range[1])}:${range[2] || '00'}`;
      }
    }
    if (deadline) f.reg_deadline = isoDate(deadline, today);

    // Tengill: helst sá sem tengist skráningu
    const urls = text.match(/https?:\/\/[^\s<>()"]+[^\s<>()".,;:!?]/gi) || [];
    const www = text.match(/\bwww\.[^\s<>()"]+[^\s<>()".,;:!?]/gi) || [];
    const all = [...urls, ...www.map((u) => 'https://' + u)];
    f.url = all.find((u) => /skra|skraning|sportabler|netskraning|abler|forms|mot/i.test(u)) || all[0] || '';

    // Tegund og íþróttagrein
    f.kind = /námskeið|fundur|fundi|þing\b|ársþing|héraðsþing|ráðstefn|hátíð|fyrirlest|vinnustof|æfingabúð/i.test(f.title)
      ? 'vidburdur' : /mót|keppni|leikar|meistara|bikar|hlaup|deild/i.test(text) ? 'mot' : 'vidburdur';
    const sport = SPORT_WORDS.find(([re]) => re.test(f.title)) || SPORT_WORDS.find(([re]) => re.test(text));
    f.sport = sport ? sport[1] : '';

    // Staður: merktur reitur, annars „í/á <Staður>“ eða þekkt staðarheiti
    f.location = label('staður|staðsetning|keppnisstaður|vettvangur');
    if (!f.location) {
      const m = text.match(/(?:haldi[nð]\w*|fer fram|verður)\s[^.\n]*?\s(?:í|á)\s+((?:[A-ZÁÐÉÍÓÚÝÞÆÖ][\wáðéíóúýþæö-]*)(?:\s+(?:[A-ZÁÐÉÍÓÚÝÞÆÖ][\wáðéíóúýþæö-]*|á|í|við))*)/);
      if (m) f.location = m[1].replace(/\s+(á|í|við)$/, '');
      else { const p = PLACES.find((pl) => new RegExp('\\b' + pl, 'i').test(text)); if (p) f.location = text.match(new RegExp('\\b' + p + '\\w*', 'i'))[0]; }
    }

    // Aldursflokkar
    f.age_groups = label('aldur|aldursflokk\\w*|keppnisflokk\\w*|flokkar');
    if (!f.age_groups) {
      const ages = [...text.matchAll(/\b\d{1,2}\s*(?:[–-]\s*\d{1,2}\s*)?ára(?:\s+og\s+(?:eldri|yngri))?|\bU-?\d{2}\b|fullorðn\w*|öldung\w*|\d{1,2}\.\s*flokk\w*/gi)].map((m) => m[0].replace(/\s+/g, ' '));
      f.age_groups = [...new Set(ages.map((a) => a.toLowerCase()))].slice(0, 6).join(', ');
    }

    // Félag og mótshaldari
    const norm = (s) => s.toLowerCase().replace(/ungmennafélagið|ungmennafélag|umf\.?|íþróttafélagið|íf\.?|golfklúbburinn|gk\.?|hestamannafélagið|hmf\.?/g, '').replace(/[^a-záðéíóúýþæö0-9 ]/g, '').trim();
    const lower = text.toLowerCase();
    const club = clubs.find((c) => lower.includes(c.label.toLowerCase()))
      || clubs.find((c) => { const n = norm(c.label); return n.length > 3 && new RegExp('(umf\\.?|ungmennafélag\\w*|íþróttafélag\\w*|golfklúbb\\w*|hestamannafélag\\w*|félag\\w*)\\s+' + n.replace(/ /g, '\\s+') + '\\b', 'i').test(text); });
    f.club_id = club ? club.value : '';
    f.organizer = label('mótshaldari|umsjón|skipuleggjandi|framkvæmd|haldari') || (club ? club.label : /\bHSK\b|Héraðssamband/i.test(text) ? 'HSK' : '');

    // Lýsing: allur textinn sem málsgreinar, tenglar virkir
    f.description = text.trim().split(/\n\s*\n/).map((p) => '<p>' + escHtml(p.trim()).replace(/\n/g, '<br>')
      .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1">$1</a>') + '</p>').join('\n');
    return f;
  }

  const evForm = document.querySelector('form.edit-form[action^="/stjorn/vidburdir/"]');
  if (evForm && document.getElementById('f_starts_at')) {
    const isNew = evForm.getAttribute('action').endsWith('/nytt');
    const panel = document.createElement('details');
    panel.className = 'ai-fill';
    panel.open = isNew;
    panel.innerHTML = '<summary>Lesa úr texta</summary>'
      + '<p class="help">Límdu inn boðsbréf, tölvupóst eða frétt um mótið. Kerfið les dagsetningar, tíma, stað, skráningarfrest, tengla, íþróttagrein og félag úr textanum og fyllir út reitina hér fyrir neðan. Farðu yfir allt áður en þú vistar.</p>'
      + '<textarea rows="7" placeholder="Límdu textann hér…"></textarea>'
      + '<div class="ai-fill-row"><button type="button" class="btn">Fylla út reiti</button><span class="ai-fill-msg" role="status"></span></div>';
    evForm.prepend(panel);
    const area = panel.querySelector('textarea');
    const msg = panel.querySelector('.ai-fill-msg');
    panel.querySelector('button').addEventListener('click', () => {
      const text = area.value.trim();
      msg.className = 'ai-fill-msg';
      if (!text) { msg.textContent = 'Límdu fyrst inn texta.'; return; }
      const clubSel = document.getElementById('f_club_id');
      const clubs = clubSel ? [...clubSel.options].filter((o) => o.value).map((o) => ({ value: o.value, label: o.textContent.trim() })) : [];
      const fields = parseEvent(text, clubs);
      document.querySelectorAll('.field.ai-filled').forEach((el) => el.classList.remove('ai-filled'));
      let n = 0;
      for (const [name, value] of Object.entries(fields)) {
        if (!value) continue;
        const el = document.getElementById('f_' + name);
        if (!el) continue;
        if (name === 'description' && window.tinymce?.get('f_description')) window.tinymce.get('f_description').setContent(value);
        else if (el.tagName === 'SELECT') { if (![...el.options].some((o) => o.value === value)) continue; el.value = value; }
        else el.value = value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        (el.closest('.field') || el).classList.add('ai-filled');
        n++;
      }
      msg.classList.add(n ? 'ok' : 'bad');
      msg.textContent = n ? `${n} reitir fylltir út og merktir með gulu. Farðu yfir þá, lagaðu ef þarf og vistaðu.` : 'Engar upplýsingar fundust í textanum.';
    });
  }

  // Síur í listum uppfærast strax þegar valið er
  document.querySelectorAll('select[data-autosubmit]').forEach((sel) => sel.addEventListener('change', () => sel.form.submit()));

  // Skrá nýtt met: sýna gilt met í völdum flokki svo rangt heiti greinar eða aldursflokks sjáist strax
  const recEvent = document.getElementById('f_event');
  const recGroup = document.getElementById('f_age_group');
  const recCat = document.getElementById('f_category');
  const recDate = document.getElementById('f_date');
  if (recEvent && recGroup && recCat && location.pathname.startsWith('/stjorn/ny-met')) {
    const box = document.createElement('div');
    box.className = 'record-check';
    box.setAttribute('role', 'status');
    recGroup.closest('.field').after(box);
    const self = (location.pathname.match(/\/ny-met\/(\d+)/) || [])[1] || '';
    const toKey = (iso) => iso ? Number(iso.replaceAll('-', '')) : 0;
    const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    let timer;
    const check = async () => {
      const params = new URLSearchParams({ grein: recEvent.value, flokkur: recCat.value, aldur: recGroup.value, id: self });
      if (!recEvent.value.trim()) { box.hidden = true; return; }
      const res = await fetch('/stjorn/met-gild?' + params, { credentials: 'same-origin' });
      const d = await res.json().catch(() => ({}));
      box.hidden = false;
      box.className = 'record-check';
      if (d.status === 'ny-grein') {
        box.classList.add('warn');
        box.innerHTML = '<strong>Greinin finnst ekki í metaskrám.</strong> Athugaðu stafsetningu og veldu heiti úr listanum, t.d. „60 m hlaup“. Ef þetta er ný grein má vista samt.';
      } else if (d.status === 'enginn-flokkur') {
        box.classList.add('warn');
        box.innerHTML = '<strong>Ekkert met finnst í þessum aldursflokki.</strong> ' + (d.groups.length
          ? 'Aldursflokkar sem til eru í þessari grein og flokki: ' + d.groups.map((g) => `<button type="button" class="linklike" data-pick-group="${esc(g)}">${esc(g)}</button>`).join(', ') + '.'
          : 'Engin met eru í þessari grein í völdum flokki.');
        box.querySelectorAll('[data-pick-group]').forEach((b) => b.addEventListener('click', () => { recGroup.value = b.dataset.pickGroup; check(); }));
      } else if (d.status === 'til') {
        const newKey = toKey(recDate && recDate.value);
        const latest = Math.max(0, ...d.current.map((r) => r.dateKey || 0));
        const list = d.current.map((r) => `<li><strong>${esc(r.result)}</strong> – ${esc(r.athlete || 'nafn vantar')}${r.date ? ', ' + esc(r.date) : ''}${r.place ? ', ' + esc(r.place) : ''}</li>`).join('');
        const verdict = !newKey ? '' : newKey > latest
          ? '<p class="ok">Nýja metið verður gilt met og það eldra fer úr síunni „Aðeins gild met“.</p>'
          : '<p class="bad">Dagsetning nýja metsins er ekki síðari en gilda metsins, svo það verður ekki gilt met. Athugaðu dagsetninguna.</p>';
        box.classList.add(newKey && newKey <= latest ? 'warn' : 'info');
        box.innerHTML = `<strong>Gilt met núna:</strong><ul>${list}</ul>${verdict}`;
      } else box.hidden = true;
    };
    const later = () => { clearTimeout(timer); timer = setTimeout(check, 300); };
    [recEvent, recGroup].forEach((el) => el.addEventListener('input', later));
    [recEvent, recGroup, recCat, recDate].forEach((el) => el && el.addEventListener('change', check));
    check();
  }

  // Afrita slóð
  document.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const url = location.origin + btn.dataset.copy;
      try { await navigator.clipboard.writeText(url); btn.textContent = 'Afritað!'; } catch { prompt('Slóð:', url); }
    });
  });

  // Staðfesting fyrir eyðingu o.fl.
  document.querySelectorAll('form[data-confirm]').forEach((f) => {
    f.addEventListener('submit', (e) => { if (!confirm(f.dataset.confirm)) e.preventDefault(); });
  });

  // Slóð búin til úr titli á nýrri síðu
  const src = document.querySelector('[data-slug-source]');
  const target = document.querySelector('[data-slug-target]');
  if (src && target && !target.value) {
    const map = { á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ý: 'y', ð: 'd', þ: 'th', æ: 'ae', ö: 'o' };
    let touched = false;
    target.addEventListener('input', () => { touched = true; });
    src.addEventListener('input', () => {
      if (touched) return;
      target.value = src.value.toLowerCase().replace(/[áéíóúýðþæö]/g, (c) => map[c]).normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    });
  }

  // Vara við ef farið er af síðu með óvistuðum breytingum
  const form = document.querySelector('form.edit-form');
  if (form) {
    let dirty = false;
    form.addEventListener('input', () => { dirty = true; });
    window.tinymce?.on?.('AddEditor', ({ editor }) => editor.on('change', () => { dirty = true; }));
    form.addEventListener('submit', () => { dirty = false; });
    window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
  }
})();
