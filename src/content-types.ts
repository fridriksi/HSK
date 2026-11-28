/**
 * Efnistegundir í vefumsjón. Hver tegund lýsir töflu, reitum og hverjir mega breyta.
 * Nýrri efnistegund er bætt við með því að bæta við færslu hér (og töflu í migrations/).
 */

export type FieldType = 'text' | 'textarea' | 'richtext' | 'date' | 'datetime' | 'select' | 'multiselect' | 'image' | 'file' | 'number' | 'url' | 'email' | 'club' | 'event' | 'album';

export type Field = {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  help?: string;
  options?: Record<string, string>;
  /** Reitir sem aðeins starfsfólk HSK sér (ekki félagsaðgangur) */
  staffOnly?: boolean;
  wide?: boolean;
};

export type ContentType = {
  key: string;           // slóð í vefumsjón: /stjorn/<key>
  table: string;
  label: string;         // fleirtala
  singular: string;
  titleField: string;
  dateField?: string;
  order: string;
  fields: Field[];
  /** Hefur slug-dálk sem er búinn til úr titli */
  slug?: boolean;
  /** Hefur status-dálk (drög/birt) */
  status?: boolean;
  /** Formenn aðildarfélaga mega senda inn efni sem bíður samþykktar */
  clubSubmit?: boolean;
  /** Formenn mega breyta eigin færslu (t.d. eigið félag) án samþykktar */
  clubOwnRecord?: boolean;
  publicUrl?: (row: Record<string, unknown>) => string;
  listColumns: { field: string; label: string; format?: 'date' | 'datetime' | 'status' | 'option' }[];
  searchFields: string[];
};

export const SPORTS = ['Almenningsíþróttir', 'Blak', 'Borðtennis', 'Bogfimi', 'Fimleikar', 'Frjálsíþróttir', 'Glíma', 'Golf', 'Handknattleikur', 'Hestaíþróttir', 'Júdó', 'Knattspyrna', 'Körfuknattleikur', 'Motocross', 'Pílukast', 'Skák', 'Skotíþróttir', 'Starfsíþróttir', 'Sund', 'Taekwondo', 'Annað'];
const sportOptions = Object.fromEntries(SPORTS.map((s) => [s, s]));

/** Flokkar metaskráa: hver flokkur er eitt spjald á síðunni HSK met */
export const RECORD_CATEGORIES: Record<string, string> = {
  utanhuss: 'Utanhúss', innanhuss: 'Innanhúss', oldungar_uti: 'Öldungar utanhúss', oldungar_inni: 'Öldungar innanhúss',
  fatladir: 'Fatlaðir', annad: 'Önnur met', reglur: 'Reglur og skýringar',
};

export const STATUS_LABELS: Record<string, string> = {
  draft: 'Drög', pending: 'Bíður samþykktar', published: 'Birt', rejected: 'Hafnað',
};

export const contentTypes: ContentType[] = [
  {
    key: 'frettir', table: 'news', label: 'Fréttir og greinar', singular: 'frétt', titleField: 'title', dateField: 'published_at',
    order: 'coalesce(published_at, created_at) DESC', slug: true, status: true, clubSubmit: true,
    publicUrl: (r) => `/frett/${r.slug}`,
    fields: [
      { name: 'title', label: 'Fyrirsögn', type: 'text', required: true, wide: true },
      { name: 'kind', label: 'Tegund', type: 'select', options: { frett: 'Frétt', grein: 'Grein', adsend: 'Aðsend grein' }, staffOnly: true },
      { name: 'published_at', label: 'Birtingartími', type: 'datetime', help: 'Ef tíminn er í framtíðinni birtist fréttin þá.', staffOnly: true },
      { name: 'image', label: 'Forsíðumynd', type: 'image' },
      { name: 'excerpt', label: 'Inngangur', type: 'textarea', help: 'Stutt samantekt sem birtist í fréttalistum. Ef tómt er byrjun textans notuð.', wide: true },
      { name: 'body', label: 'Texti', type: 'richtext', wide: true },
      { name: 'author', label: 'Höfundur', type: 'text' },
      { name: 'club_id', label: 'Aðildarfélag', type: 'club', staffOnly: true },
      { name: 'album_id', label: 'Tengt myndaalbúm', type: 'album' },
    ],
    listColumns: [{ field: 'title', label: 'Fyrirsögn' }, { field: 'published_at', label: 'Birt', format: 'datetime' }, { field: 'status', label: 'Staða', format: 'status' }],
    searchFields: ['title', 'body'],
  },
  {
    key: 'vidburdir', table: 'events', label: 'Mót og viðburðir', singular: 'mót eða viðburð', titleField: 'title', dateField: 'starts_at',
    order: 'starts_at DESC', status: true, clubSubmit: true,
    publicUrl: (r) => `/vidburdur/${r.id}`,
    fields: [
      { name: 'title', label: 'Heiti', type: 'text', required: true, wide: true },
      { name: 'kind', label: 'Tegund', type: 'select', options: { mot: 'Mót', vidburdur: 'Viðburður' }, help: 'Mót eru merkt með bláu í „Mót og viðburðir“ á vefnum.' },
      { name: 'sport', label: 'Íþróttagrein', type: 'select', options: { '': '—', ...sportOptions } },
      { name: 'starts_at', label: 'Hefst', type: 'datetime', required: true },
      { name: 'ends_at', label: 'Lýkur', type: 'datetime' },
      { name: 'location', label: 'Staðsetning', type: 'text' },
      { name: 'age_groups', label: 'Aldursflokkar', type: 'text', help: 'T.d. 11–14 ára, fullorðnir' },
      { name: 'organizer', label: 'Mótshaldari', type: 'text' },
      { name: 'reg_deadline', label: 'Skráningarfrestur', type: 'date' },
      { name: 'url', label: 'Tengill á skráningu eða nánari upplýsingar', type: 'url', wide: true },
      { name: 'image', label: 'Mynd', type: 'image' },
      { name: 'attachment', label: 'Boðsbréf / reglugerð (PDF)', type: 'file' },
      { name: 'description', label: 'Lýsing', type: 'richtext', wide: true },
      { name: 'club_id', label: 'Aðildarfélag', type: 'club', staffOnly: true },
    ],
    listColumns: [{ field: 'title', label: 'Heiti' }, { field: 'kind', label: 'Tegund', format: 'option' }, { field: 'starts_at', label: 'Hefst', format: 'datetime' }, { field: 'status', label: 'Staða', format: 'status' }],
    searchFields: ['title', 'location', 'sport'],
  },
  {
    key: 'urslit', table: 'results', label: 'Úrslit', singular: 'úrslit', titleField: 'title', dateField: 'date',
    order: 'date DESC', status: true, publicUrl: (r) => `/urslit/${r.id}`,
    fields: [
      { name: 'title', label: 'Heiti móts', type: 'text', required: true, wide: true },
      { name: 'date', label: 'Dagsetning', type: 'date', required: true },
      { name: 'sport', label: 'Íþróttagrein', type: 'select', options: { '': '—', ...sportOptions } },
      { name: 'event_id', label: 'Tengt mót', type: 'event' },
      { name: 'body', label: 'Úrslit', type: 'richtext', help: 'Hægt er að líma töflu beint úr Excel inn í ritilinn.', wide: true },
      { name: 'attachment', label: 'Úrslit sem PDF', type: 'file' },
    ],
    listColumns: [{ field: 'title', label: 'Mót' }, { field: 'sport', label: 'Grein' }, { field: 'date', label: 'Dags.', format: 'date' }, { field: 'status', label: 'Staða', format: 'status' }],
    searchFields: ['title', 'sport'],
  },
  {
    key: 'met', table: 'records', label: 'HSK met', singular: 'metaskrá', titleField: 'title', order: "CASE category WHEN 'reglur' THEN 0 ELSE 1 END, year DESC, category, title",
    fields: [
      { name: 'title', label: 'Heiti', type: 'text', required: true, help: 'T.d. HSK metaskrá öldunga í frjálsum innanhúss 2027', wide: true },
      { name: 'category', label: 'Flokkur', type: 'select', required: true, options: RECORD_CATEGORIES, help: 'Ræður á hvaða spjaldi skráin birtist á síðunni HSK met.' },
      { name: 'year', label: 'Ár', type: 'number', help: 'Nýjasta árið birtist efst á spjaldinu.' },
      { name: 'file', label: 'Metaskrá (skjal)', type: 'file', help: 'Hladdu upp .xlsx-skrá og vistaðu til að birta metin sem töflu á vefnum.' },
      { name: 'sport', label: 'Íþróttagrein', type: 'select', options: { '': '—', ...sportOptions } },
      { name: 'body', label: 'Texti', type: 'richtext', help: 'Aðeins fyrir flokkinn „Reglur og skýringar“, eða ef metin eru sett inn sem tafla í stað skjals.', wide: true },
    ],
    listColumns: [{ field: 'title', label: 'Heiti' }, { field: 'category', label: 'Flokkur', format: 'option' }, { field: 'year', label: 'Ár' }],
    searchFields: ['title'],
  },
  {
    key: 'felog', table: 'clubs', label: 'Aðildarfélög', singular: 'félag', titleField: 'name', order: 'name', slug: true, clubOwnRecord: true,
    publicUrl: (r) => `/felag/${r.slug}`,
    fields: [
      { name: 'name', label: 'Nafn félags', type: 'text', required: true, wide: true, staffOnly: true },
      { name: 'logo', label: 'Merki', type: 'image' },
      { name: 'sports', label: 'Íþróttagreinar', type: 'multiselect', options: sportOptions, help: 'Hakaðu við allar greinar sem félagið býður upp á.' },
      { name: 'area', label: 'Svæði / sveitarfélag', type: 'text' },
      { name: 'contact_name', label: 'Formaður / tengiliður', type: 'text' },
      { name: 'email', label: 'Netfang', type: 'email' },
      { name: 'phone', label: 'Sími', type: 'text' },
      { name: 'website', label: 'Vefsíða', type: 'url' },
      { name: 'facebook', label: 'Facebook', type: 'url' },
      { name: 'description', label: 'Um félagið', type: 'richtext', wide: true },
    ],
    listColumns: [{ field: 'name', label: 'Félag' }, { field: 'sports', label: 'Greinar' }, { field: 'updated_at', label: 'Uppfært', format: 'datetime' }],
    searchFields: ['name', 'sports', 'area'],
  },
  {
    key: 'nefndir', table: 'committees', label: 'Stjórn, nefndir og ráð', singular: 'nefnd', titleField: 'name', order: 'sort, name',
    fields: [
      { name: 'name', label: 'Heiti', type: 'text', required: true, wide: true },
      { name: 'sort', label: 'Röð', type: 'number' },
      { name: 'body', label: 'Fólk og hlutverk', type: 'richtext', wide: true },
    ],
    listColumns: [{ field: 'name', label: 'Heiti' }, { field: 'updated_at', label: 'Uppfært', format: 'datetime' }],
    searchFields: ['name', 'body'],
  },
  {
    key: 'skjol', table: 'documents', label: 'Fundargerðir og skjöl', singular: 'skjal', titleField: 'title', dateField: 'date', order: 'date DESC',
    fields: [
      { name: 'title', label: 'Heiti', type: 'text', required: true, wide: true },
      { name: 'category', label: 'Flokkur', type: 'select', options: { fundargerd: 'Fundargerð', arsskyrsla: 'Ársskýrsla', eydublad: 'Eyðublað', aaetlun: 'Stefna eða áætlun', annad: 'Annað' }, help: 'Lög og reglugerðir eru settar inn sem síður, og metaskrár undir HSK met.' },
      { name: 'date', label: 'Dagsetning', type: 'date', required: true },
      { name: 'file', label: 'Skjal', type: 'file' },
      { name: 'body', label: 'Lýsing eða texti', type: 'richtext', help: 'Ef skjal fylgir birtist textinn sem stutt lýsing undir heiti þess.', wide: true },
    ],
    listColumns: [{ field: 'title', label: 'Heiti' }, { field: 'category', label: 'Flokkur', format: 'option' }, { field: 'date', label: 'Dags.', format: 'date' }],
    searchFields: ['title'],
  },
  {
    key: 'styrktaradilar', table: 'sponsors', label: 'Styrktaraðilar', singular: 'styrktaraðila', titleField: 'name', order: 'sort, name',
    fields: [
      { name: 'name', label: 'Nafn', type: 'text', required: true },
      { name: 'tier', label: 'Flokkur', type: 'select', options: { adalstyrktaradili: 'Aðalstyrktaraðili', styrktaradili: 'Styrktaraðili', samstarfsadili: 'Samstarfsaðili' } },
      { name: 'logo', label: 'Merki', type: 'image', help: 'Helst SVG eða PNG með gegnsæjum bakgrunni.' },
      { name: 'url', label: 'Vefsíða', type: 'url' },
      { name: 'sort', label: 'Röð', type: 'number' },
      { name: 'active_from', label: 'Birtist frá', type: 'date' },
      { name: 'active_to', label: 'Birtist til', type: 'date', help: 'Tómt = ótímabundið' },
    ],
    listColumns: [{ field: 'name', label: 'Nafn' }, { field: 'tier', label: 'Flokkur', format: 'option' }, { field: 'active_to', label: 'Til', format: 'date' }],
    searchFields: ['name'],
  },
  {
    key: 'myndasofn', table: 'albums', label: 'Myndasöfn', singular: 'albúm', titleField: 'title', dateField: 'date', order: 'date DESC', slug: true,
    publicUrl: (r) => `/album/${r.slug}`,
    fields: [
      { name: 'title', label: 'Heiti', type: 'text', required: true, wide: true },
      { name: 'date', label: 'Dagsetning', type: 'date', required: true },
      { name: 'event_id', label: 'Tengt mót / viðburður', type: 'event' },
      { name: 'cover', label: 'Forsíðumynd', type: 'image', help: 'Ef tómt er fyrsta myndin notuð.' },
      { name: 'description', label: 'Lýsing', type: 'richtext', wide: true },
    ],
    listColumns: [{ field: 'title', label: 'Heiti' }, { field: 'date', label: 'Dags.', format: 'date' }],
    searchFields: ['title'],
  },
];

export function getType(key: string) {
  return contentTypes.find((t) => t.key === key);
}
