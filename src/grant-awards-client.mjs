import { GrantAwardResults } from './views/grant-awards';

const form = document.querySelector('.grant-awards-filter');
const results = document.getElementById('grant-results');
// Úthlutanir samþykktar í vefumsjón (bætast við gögnin úr gamla vefnum)
let extra = [];
try { extra = JSON.parse(document.getElementById('grant-extra')?.textContent || '[]'); } catch { extra = []; }

if (form && results) {
  const search = form.elements.namedItem('q');
  const year = form.elements.namedItem('ar');
  const round = form.elements.namedItem('uthlutun');
  const sort = form.elements.namedItem('rodun');
  const order = form.elements.namedItem('att');
  const clear = form.querySelector('a');
  const status = results.querySelector('[role="status"]');
  const template = document.createElement('template');
  let timer;

  function refresh() {
    clearTimeout(timer);
    const params = Object.fromEntries(new FormData(form));
    const detailsOpen = results.querySelector('details').open;
    // Use the same escaping, totals and links as the initial server-rendered table.
    template.innerHTML = GrantAwardResults({ params, extra }).toString();
    const nextStatus = template.content.querySelector('[role="status"]');
    status.textContent = nextStatus.textContent;
    nextStatus.remove();
    template.content.querySelector('details').open = detailsOpen;
    while (status.nextSibling) status.nextSibling.remove();
    results.append(template.content);

    clear.hidden = !(search.value.trim() || year.value || round.value);
    const url = new URL(location.href);
    url.searchParams.delete('sida');
    for (const [key, value] of Object.entries(params)) {
      if (value.trim()) url.searchParams.set(key, value.trim());
      else url.searchParams.delete(key);
    }
    history.replaceState(history.state, '', url);
  }

  function queueRefresh() {
    clearTimeout(timer);
    timer = setTimeout(refresh, 120);
  }

  search.addEventListener('input', (event) => { if (!event.isComposing) queueRefresh(); });
  search.addEventListener('compositionstart', () => clearTimeout(timer));
  search.addEventListener('compositionend', queueRefresh);
  year.addEventListener('change', refresh);
  round.addEventListener('change', refresh);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    refresh();
  });
  clear.addEventListener('click', (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    search.value = year.value = round.value = '';
    sort.value = 'year';
    order.value = 'desc';
    refresh();
    search.focus();
  });
  form.querySelector('button[type="submit"]').hidden = true;
}
