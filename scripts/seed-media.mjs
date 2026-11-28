// Setur myndir úr seed/media í staðbundna R2-geymslu (aðeins fyrir þróun)
import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
for (const f of readdirSync('seed/media')) {
  const type = f.endsWith('.png') ? 'image/png' : 'image/jpeg';
  execFileSync('npx', ['wrangler', 'r2', 'object', 'put', `hsk-media/seed/${f}`, '--file', `seed/media/${f}`, '--content-type', type, '--local'], { stdio: 'inherit' });
}
