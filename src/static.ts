import { FILES } from './static-files';

const cache = new Map<string, Uint8Array>();

/** Skilar fastri skrá úr public/ (sjá scripts/build-static.mjs) */
export function staticFile(path: string): Response | null {
  const f = FILES[path];
  if (!f) return null;
  let bytes = cache.get(path);
  if (!bytes) {
    bytes = Uint8Array.from(atob(f.b64), (ch) => ch.charCodeAt(0));
    cache.set(path, bytes);
  }
  return new Response(bytes, { headers: { 'content-type': f.type, 'cache-control': 'public, max-age=31536000, immutable' } });
}

/** Slóð með útgáfu (t.d. /js/site.js?v=ab12) svo vafrar sæki nýja útgáfu eftir breytingar */
export function asset(path: string): string {
  const f = FILES[path];
  return f ? `${path}?v=${f.v}` : path;
}
