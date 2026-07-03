/**
 * Génère les favicons depuis le monogramme AF (assets/af-monogram.svg),
 * dégradé de marque conservé (#FF003D → #D24CC5), fond charbon pour les
 * icônes opaques, plus la carte Open Graph depuis assets/af-logo-card.svg.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const CHARBON = '#0e0f13';

const brut = fs.readFileSync(path.join(ROOT, 'assets/af-monogram.svg'), 'utf8');
// dégradé d'origine conservé + viewBox élargi (le tracé touche les bords)
const icone = brut.replace(/viewBox="0 0 721 790"/, 'viewBox="-80 -80 881 950"');

fs.writeFileSync(path.join(ROOT, 'public/favicon.svg'), icone);

const raster = (size, fond) =>
  sharp(Buffer.from(icone), { density: 300 })
    .resize(size, size, { fit: 'contain', background: fond ?? { r: 0, g: 0, b: 0, alpha: 0 } })
    .flatten(fond ? { background: fond } : false)
    .png();

await raster(96).toFile(path.join(ROOT, 'public/favicon-96.png'));
await raster(192).toFile(path.join(ROOT, 'public/icon-192.png'));
await raster(512).toFile(path.join(ROOT, 'public/icon-512.png'));
await raster(180, CHARBON).toFile(path.join(ROOT, 'public/apple-touch-icon.png'));

// carte de partage par défaut (og:image 1200×630, PNG — SVG refusé par les scrapers)
await sharp(path.join(ROOT, 'assets/af-logo-card.svg'), { density: 220 })
  .resize(1200, 630, { fit: 'cover' })
  .png()
  .toFile(path.join(ROOT, 'public/og-card.png'));

console.log('Favicons (dégradé de marque) + og-card.png générés.');
