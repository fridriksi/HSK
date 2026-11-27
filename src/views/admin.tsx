import { asset } from '../static';
import type { Child, FC } from 'hono/jsx';
import type { User } from '../lib';
import type { Field } from '../content-types';
import { contentTypes } from '../content-types';

const ROLE_LABEL: Record<string, string> = { admin: 'Stjórnandi', editor: 'Ritstjóri', club: 'Félagsaðgangur' };

export const AdminLayout: FC<{ title: string; user: User | null; active?: string; flash?: string; error?: string; pending?: number; children?: Child }> = ({ title, user, active, flash, error, pending, children }) => {
  const staff = user && (user.role === 'admin' || user.role === 'editor');
  const link = (href: string, label: string, key: string, badge?: number) => (
    <li><a href={href} class={active === key ? 'on' : ''}>{label}{badge ? <span class="badge">{badge}</span> : null}</a></li>
  );
  return (
    <html lang="is">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex" />
        <title>{title} – Vefumsjón HSK</title>
        <link rel="icon" href="/img/hsk-merki.svg" type="image/svg+xml" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800&family=Source+Sans+3:wght@400;600;700&display=swap" />
        <link rel="stylesheet" href={asset('/css/admin.css')} />
      </head>
      <body>
        {user ? (
          <div class="admin">
            <aside class="side">
              <a class="side-brand" href="/stjorn"><img src="/img/hsk-merki.svg" alt="" width="28" />Vefumsjón HSK</a>
              <nav>
                <ul>
                  {link('/stjorn', 'Yfirlit', 'home', user.role === 'admin' ? pending : undefined)}
                  {staff && link('/stjorn/sidur', 'Síður og valmynd', 'sidur')}
                  {contentTypes.filter((t) => staff || t.clubSubmit || t.clubOwnRecord).map((t) =>
                    link(t.clubOwnRecord && !staff ? `/stjorn/${t.key}/${user.club_id ?? 0}` : `/stjorn/${t.key}`, !staff && t.clubOwnRecord ? 'Mitt félag' : t.label, t.key))}
                  {staff && link('/stjorn/umsoknir', 'Umsóknir', 'umsoknir')}
                  {link('/stjorn/skrar', 'Myndir og skjöl', 'skrar')}
                  {staff && link('/stjorn/stillingar', 'Forsíða og stillingar', 'stillingar')}
                  {user.role === 'admin' && link('/stjorn/notendur', 'Notendur', 'notendur')}
                </ul>
              </nav>
              <div class="side-user">
                <span>{user.name || user.email}</span>
                <small>{ROLE_LABEL[user.role]}</small>
                <div><a href="/" target="_blank">Skoða vef</a> · <form method="post" action="/stjorn/utskra" class="inline"><button class="linklike">Skrá út</button></form></div>
              </div>
            </aside>
            <main class="main">
              {flash && <div class="flash ok" role="status">{flash}</div>}
              {error && <div class="flash err" role="alert">{error}</div>}
              {children}
            </main>
          </div>
        ) : (
          <main class="login-main">{children}</main>
        )}
        <script src="https://cdn.jsdelivr.net/npm/tinymce@6.8.5/tinymce.min.js" referrerpolicy="origin"></script>
        <script src={asset('/js/admin.js')} data-tinymce-is={asset('/js/tinymce-is.js')}></script>
      </body>
    </html>
  );
};

function toInput(type: string, v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (type === 'datetime') return s.replace(' ', 'T').slice(0, 16);
  if (type === 'date') return s.slice(0, 10);
  return s;
}

export const FieldInput: FC<{ f: Field; value: unknown; options?: { id: number; label: string }[] }> = ({ f, value, options }) => {
  const id = 'f_' + f.name;
  const v = toInput(f.type, value);
  let input: Child;
  switch (f.type) {
    case 'textarea':
      input = <textarea id={id} name={f.name} rows={3} required={f.required}>{v}</textarea>;
      break;
    case 'richtext':
      input = <textarea id={id} name={f.name} class="rte" rows={14}>{v}</textarea>;
      break;
    case 'select':
      input = (
        <select id={id} name={f.name}>
          {Object.entries(f.options ?? {}).map(([k, l]) => <option value={k} selected={k === v}>{l}</option>)}
        </select>
      );
      break;
    case 'club':
    case 'event':
    case 'album':
      input = (
        <select id={id} name={f.name}>
          <option value="">— Ekkert —</option>
          {(options ?? []).map((o) => <option value={String(o.id)} selected={String(o.id) === v}>{o.label}</option>)}
        </select>
      );
      break;
    case 'image':
    case 'file':
      input = (
        <div class="upload-field" data-kind={f.type}>
          {f.type === 'image' && <img class="preview" src={v || undefined} alt="" hidden={!v} />}
          <div class="upload-row">
            <input id={id} name={f.name} type="text" value={v} placeholder={f.type === 'image' ? 'Slóð á mynd' : 'Slóð á skjal'} />
            <label class="btn small ghost">Hlaða upp<input type="file" accept={f.type === 'image' ? 'image/*' : '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,image/*'} hidden /></label>
            <button type="button" class="btn small ghost" data-clear>Fjarlægja</button>
          </div>
        </div>
      );
      break;
    default: {
      const t = { text: 'text', date: 'date', datetime: 'datetime-local', number: 'number', url: 'url', email: 'email' }[f.type] ?? 'text';
      input = <input id={id} name={f.name} type={t} value={v} required={f.required} />;
    }
  }
  return (
    <div class={f.wide || f.type === 'richtext' ? 'field wide' : 'field'}>
      <label for={id}>{f.label}{f.required && <span class="req" aria-hidden="true"> *</span>}</label>
      {input}
      {f.help && <small class="help">{f.help}</small>}
    </div>
  );
};

export const StatusPill: FC<{ status: string }> = ({ status }) => {
  const labels: Record<string, string> = { draft: 'Drög', pending: 'Bíður samþykktar', published: 'Birt', rejected: 'Hafnað' };
  return <span class={'pill ' + status}>{labels[status] ?? status}</span>;
};
