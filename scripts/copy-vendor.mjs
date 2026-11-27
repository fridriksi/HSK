// Afritar TinyMCE (MIT-leyfi, útgáfa 6) í public/vendor svo ritillinn sé hýstur á vefnum sjálfum.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
const src = 'node_modules/tinymce';
const dest = 'public/vendor/tinymce';
if (!existsSync(src)) { console.error('Keyrðu fyrst: npm install'); process.exit(1); }
mkdirSync(dest, { recursive: true });
for (const p of ['tinymce.min.js', 'icons', 'models', 'plugins', 'skins', 'themes', 'license.txt']) {
  cpSync(`${src}/${p}`, `${dest}/${p}`, { recursive: true });
}
console.log('TinyMCE afritað í', dest);
