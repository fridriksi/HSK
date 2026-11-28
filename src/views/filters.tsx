import type { Child } from 'hono/jsx';

export function FilterField({ id, label, children }: { id: string; label: string; children: Child }) {
  return <div class="filter-field"><label for={id}>{label}</label>{children}</div>;
}

export function YearFilter({ id, years, year, all = '' }: { id: string; years: readonly (string | number)[]; year?: string | number; all?: string }) {
  return <FilterField id={id} label="Ár">
    <select id={id} name="ar">
      <option value={all}>Öll ár</option>
      {years.map((value) => <option value={value} selected={String(value) === String(year)}>{value}</option>)}
    </select>
  </FilterField>;
}
