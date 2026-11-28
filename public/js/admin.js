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

  // Mót og viðburðir: líma inn texta (boðsbréf, tölvupóst) og láta gervigreind fylla út reitina
  const evForm = document.querySelector('form.edit-form[action^="/stjorn/vidburdir/"]');
  if (evForm && document.getElementById('f_starts_at')) {
    const isNew = evForm.getAttribute('action').endsWith('/nytt');
    const panel = document.createElement('details');
    panel.className = 'ai-fill';
    panel.open = isNew;
    panel.innerHTML = '<summary>Lesa úr texta</summary>'
      + '<p class="help">Límdu inn boðsbréf, tölvupóst eða frétt um mótið. Gervigreind les textann og fyllir út reitina hér fyrir neðan. Farðu yfir allt áður en þú vistar.</p>'
      + '<textarea rows="7" placeholder="Límdu textann hér…"></textarea>'
      + '<div class="ai-fill-row"><button type="button" class="btn">Fylla út reiti</button><span class="ai-fill-msg" role="status"></span></div>';
    evForm.prepend(panel);
    const area = panel.querySelector('textarea');
    const btn = panel.querySelector('button');
    const msg = panel.querySelector('.ai-fill-msg');
    btn.addEventListener('click', async () => {
      const text = area.value.trim();
      if (!text) { msg.textContent = 'Límdu fyrst inn texta.'; return; }
      btn.disabled = true;
      msg.className = 'ai-fill-msg';
      msg.textContent = 'Les textann… þetta tekur nokkrar sekúndur.';
      try {
        const res = await fetch('/stjorn/vidburdir/lesa', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
        const d = await res.json().catch(() => ({ error: 'Óvænt svar frá þjóninum.' }));
        if (!res.ok || !d.fields) throw new Error(d.error || 'Ekki tókst að lesa textann.');
        let n = 0;
        for (const [name, value] of Object.entries(d.fields)) {
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
        msg.classList.add('ok');
        msg.textContent = n ? `${n} reitir fylltir út og merktir. Farðu yfir þá og vistaðu.` : 'Engar upplýsingar fundust í textanum.';
      } catch (e) {
        msg.classList.add('bad');
        msg.textContent = e.message;
      } finally { btn.disabled = false; }
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
