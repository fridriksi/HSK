// Umsókn um styrk úr Verkefnasjóði HSK: reitir formsins, staðfesting og vistun
import type { Env } from './lib';
import { slugify, getSetting } from './lib';
import { notifyAdmins } from './mail';

export type GrantFieldType = 'text' | 'email' | 'tel' | 'textarea' | 'number' | 'date' | 'select' | 'checkbox' | 'file';
export type GrantField = { name: string; label: string; type?: GrantFieldType; required?: boolean; help?: string; half?: boolean; options?: string[] };

export const GRANT_FIELD_TYPES: Record<GrantFieldType, string> = {
  text: 'Texti (ein lína)', textarea: 'Texti (margar línur)', number: 'Tala / upphæð', email: 'Netfang', tel: 'Sími', date: 'Dagsetning',
  select: 'Fellilisti', checkbox: 'Hak (já/nei)', file: 'Fylgiskjal',
};

/** Reitir sem kerfið notar (heiti umsóknar, upphæð, tölvupóstur til umsækjanda). Ekki hægt að eyða þeim eða breyta tegund. */
export const GRANT_CORE: Record<string, GrantFieldType> = { felag: 'text', verkefni: 'text', upphaed: 'number', netfang: 'email' };

export const GRANT_FIELDS: GrantField[] = [
  { name: 'felag', label: 'Nafn félags', required: true },
  { name: 'kennitala', label: 'Kennitala félags', required: true, help: 'Tíu tölustafir, án bandstriks', half: true },
  { name: 'banki', label: 'Banka- og reikningsnúmer', required: true, half: true },
  { name: 'heimili', label: 'Heimilisfang', required: true },
  { name: 'postnumer', label: 'Póstnúmer og staður', required: true },
  { name: 'abyrgdarmadur', label: 'Ábyrgðarmaður', required: true },
  { name: 'simi', label: 'Sími', type: 'tel', required: true, half: true },
  { name: 'netfang', label: 'Netfang', type: 'email', required: true, half: true },
  { name: 'verkefni', label: 'Heiti verkefnis', required: true },
  { name: 'lysing', label: 'Lýsing á verkefninu og fyrirhugaðri ráðstöfun styrksins', type: 'textarea', required: true },
  { name: 'fjarhagsaaetlun', label: 'Fjárhagsáætlun', type: 'textarea', required: true },
  { name: 'upphaed', label: 'Styrkupphæð sem sótt er um (kr.)', type: 'number', required: true },
];

export const GRANT_FILES = [
  { name: 'skjal1', label: 'Nánari lýsing verkefnis (valfrjálst)' },
  { name: 'skjal2', label: 'Tekju- og kostnaðaráætlun (valfrjálst)' },
];

/** Sjálfgefið form: reitirnir ásamt fylgiskjölunum */
export const DEFAULT_GRANT_FORM: GrantField[] = [...GRANT_FIELDS, ...GRANT_FILES.map((f) => ({ ...f, type: 'file' as const }))];

/** Reitir umsóknarformsins eins og þeir eru stilltir í vefumsjón (sjálfgefið formið ef engu hefur verið breytt) */
export async function grantForm(db: D1Database): Promise<GrantField[]> {
  try {
    const raw = await getSetting(db, 'grant_form_fields', '');
    const list = raw ? JSON.parse(raw) as GrantField[] : null;
    if (Array.isArray(list) && list.length) return list;
  } catch { /* ógild stilling: nota sjálfgefið */ }
  return DEFAULT_GRANT_FORM;
}

const FILE_TYPES = /^(application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet)|application\/vnd\.ms-excel|application\/vnd\.oasis\.opendocument\.(text|spreadsheet)|image\/(jpeg|png))$/;
const MAX_FILE = 10 * 1024 * 1024;

/** Skilar villuboðum eða null ef umsóknin var vistuð */
export async function saveGrant(env: Env, form: FormData): Promise<{ error?: string; values: Record<string, string> }> {
  const fields = await grantForm(env.DB);
  const inputs = fields.filter((f) => f.type !== 'file');
  const values: Record<string, string> = {};
  for (const f of inputs) {
    const v = f.type === 'checkbox' ? (form.get(f.name) ? 'Já' : '') : String(form.get(f.name) ?? '').trim().slice(0, 5000);
    values[f.name] = f.type === 'select' && f.options?.length && v && !f.options.includes(v) ? '' : v;
  }
  // Ruslpóstvörn: falinn reitur sem fólk fyllir ekki út, og einfalt reikningsdæmi
  if (String(form.get('vefsida') ?? '')) return { error: 'Umsóknin var ekki send.', values };
  if (String(form.get('daemi') ?? '').trim() !== '5') return { error: 'Svarið við reikningsdæminu er ekki rétt.', values };
  const missing = inputs.filter((f) => f.required && !values[f.name]).map((f) => f.label);
  if (missing.length) return { error: `Vinsamlegast fylltu út: ${missing.join(', ')}.`, values };
  if ('kennitala' in values && values.kennitala) {
    values.kennitala = values.kennitala.replace(/\D/g, '');
    if (values.kennitala.length !== 10) return { error: 'Kennitala þarf að vera tíu tölustafir.', values };
  }
  for (const f of inputs) {
    if (f.type === 'email' && values[f.name] && !/^\S+@\S+\.\S+$/.test(values[f.name])) return { error: `${f.label}: netfangið virðist ekki rétt.`, values };
    if (f.type === 'number') values[f.name] = values[f.name].replace(/[^\d]/g, '');
  }
  const files: { file: File; label: string }[] = [];
  for (const def of fields.filter((f) => f.type === 'file')) {
    const f = form.get(def.name);
    if (!(f instanceof File) || f.size === 0) {
      if (def.required) return { error: `Vinsamlegast láttu fylgja: ${def.label}.`, values };
      continue;
    }
    if (f.size > MAX_FILE) return { error: `${def.label}: skráin er of stór (hámark 10 MB).`, values };
    if (!FILE_TYPES.test(f.type)) return { error: `${def.label}: sendu PDF-, Word- eða Excel-skjal.`, values };
    files.push({ file: f, label: def.label });
  }
  const title = [values.felag, values.verkefni].filter(Boolean).join(' – ') || 'Umsókn í Verkefnasjóð';
  const res = await env.DB.prepare('INSERT INTO applications (kind, title, data) VALUES (?, ?, ?) RETURNING id')
    .bind('verkefnasjodur', title, JSON.stringify(values)).first<{ id: number }>();
  const id = res!.id;
  const stored: { key: string; name: string; type: string; label: string }[] = [];
  for (const [i, { file: f, label }] of files.entries()) {
    const safe = slugify(f.name.replace(/\.[^.]+$/, '')) + (f.name.match(/\.[a-zA-Z0-9]+$/)?.[0].toLowerCase() ?? '');
    // Skrár umsókna eru utan opinbera myndasafnsins og aðeins aðgengilegar innskráðu starfsfólki
    const key = `private/umsoknir/${id}/${i + 1}-${safe}`;
    await env.MEDIA.put(key, f.stream(), { httpMetadata: { contentType: f.type } });
    stored.push({ key, name: f.name, type: f.type, label });
  }
  if (stored.length) await env.DB.prepare('UPDATE applications SET files = ? WHERE id = ?').bind(JSON.stringify(stored), id).run();
  await notifyAdmins(env, `Ný umsókn í Verkefnasjóð: ${title}`,
    `Ný umsókn hefur borist í Verkefnasjóð HSK.\n\n${title}${values.upphaed ? `\nUpphæð: ${values.upphaed} kr.` : ''}\n\nSjá umsóknina: ${env.SITE_URL}/stjorn/umsoknir/${id}`);
  return { values };
}
