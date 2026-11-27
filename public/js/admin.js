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
      language_url: '/js/tinymce-is.js',
      content_style: 'body{font-family:"Source Sans 3",system-ui,sans-serif;font-size:17px;line-height:1.6;color:#16203f;max-width:760px;margin:16px auto} table{border-collapse:collapse} td,th{border:1px solid #e3e8f2;padding:6px 8px} img{max-width:100%;height:auto}',
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
    };
    tinymce.init({
      ...base,
      selector: 'textarea.rte:not(.rte-small)',
      height: 520,
      plugins: 'lists link image table autolink media code wordcount',
      toolbar: 'blocks | bold italic | bullist numlist | link image media table | blockquote alignleft aligncenter | removeformat code',
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

  // Fjölupphleðsla: myndasafn og albúm
  document.querySelectorAll('.upload-drop').forEach((drop) => {
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
