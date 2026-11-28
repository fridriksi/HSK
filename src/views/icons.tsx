import type { FC } from 'hono/jsx';

/**
 * Eitt táknasett fyrir allan vefinn og vefumsjón.
 * Öll tákn eru teiknuð með sömu línuþykkt og fá lit úr CSS (.icon), svo þau eru alls staðar eins á litinn.
 */
const PATHS = {
  chevronRight: <path d="M9 6l6 6-6 6" />,
  chevronLeft: <path d="M15 6l-6 6 6 6" />,
  chevronUp: <path d="M6 15l6-6 6 6" />,
  chevronDown: <path d="M6 9l6 6 6-6" />,
  calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="1.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  pin: <><path d="M12 21s-6.5-6.2-6.5-11.2a6.5 6.5 0 0113 0C18.5 14.8 12 21 12 21z" /><circle cx="12" cy="9.8" r="2.3" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  file: <><path d="M14 3.5H7a1.5 1.5 0 00-1.5 1.5v14A1.5 1.5 0 007 20.5h10a1.5 1.5 0 001.5-1.5V8z" /><path d="M14 3.5V8h4.5" /></>,
  download: <><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5" /><path d="M4.5 19.5h15" /></>,
  external: <><path d="M14 4.5h5.5V10M19.5 4.5L11 13" /><path d="M17 14v4.5a1.5 1.5 0 01-1.5 1.5h-10A1.5 1.5 0 014 18.5v-10A1.5 1.5 0 015.5 7H10" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6" /><path d="M15 15l5 5" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  mail: <><rect x="3.5" y="5.5" width="17" height="13" rx="1.5" /><path d="M4 7l8 6 8-6" /></>,
  phone: <path d="M5 4.5h3.5l1.5 4-2 1.3a10 10 0 005.2 5.2l1.3-2 4 1.5V18a1.5 1.5 0 01-1.6 1.5A15 15 0 013.5 6.1 1.5 1.5 0 015 4.5z" />,
  image: <><rect x="3.5" y="4.5" width="17" height="15" rx="1.5" /><circle cx="9" cy="10" r="1.8" /><path d="M20.5 16l-5-5-8.5 8.5" /></>,
  facebook: <path d="M14.5 8.5H16V5h-2a4 4 0 00-4 4v2.5H8V15h2v6h3.5v-6H16l.5-3.5h-3V9.5a1 1 0 011-1z" />,
  instagram: <><rect x="3.5" y="3.5" width="17" height="17" rx="4.5" /><circle cx="12" cy="12" r="4" /><circle cx="17.2" cy="6.8" r=".6" /></>,
  youtube: <><rect x="2.5" y="5.5" width="19" height="13" rx="3.5" /><path d="M10 9.2v5.6l4.8-2.8z" /></>,
  tiktok: <path d="M13.5 3.5v11.2a3.3 3.3 0 11-3.3-3.3M13.5 3.5c.4 2.6 2.2 4.3 5 4.5" />,
  globe: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.2 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.2-3.5-8.5s1.1-6.1 3.5-8.5z" /></>,
} as const;

export type IconName = keyof typeof PATHS;

export const Icon: FC<{ name: IconName; label?: string; class?: string }> = ({ name, label, class: cls }) => (
  <svg class={cls ? `icon ${cls}` : 'icon'} viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
    stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden={label ? undefined : 'true'} role={label ? 'img' : undefined} aria-label={label}>
    {PATHS[name]}
  </svg>
);
