import type { Child } from 'hono/jsx';

export function FilterField({ id, label, children }: { id: string; label: string; children: Child }) {
  return <div class="filter-field"><label for={id}>{label}</label>{children}</div>;
}

export function FilterOptions({ label, children }: { label: string; children: Child }) {
  return <nav class="filter-options" aria-label={label}>
    <span class="filter-label" aria-hidden="true">{label}</span>
    <div>{children}</div>
  </nav>;
}
