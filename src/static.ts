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
  return new Response(bytes, { headers: { 'content-type': f.type, 'cache-control': 'public, max-age=3600' } });
}
