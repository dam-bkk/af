/**
 * Outil de recadrage manuel — itération visuelle par œuvre.
 *
 * Usage :
 *   node scripts/crop-tool.mjs <slug> --grille   → .crop-preview/<slug>-grille.jpg
 *       image pleine (après rotation EXIF + rotation manuelle éventuelle)
 *       avec grille tous les 10 % annotée en pixels réels.
 *   node scripts/crop-tool.mjs <slug>            → .crop-preview/<slug>-manuel.jpg
 *       résultat du recadrage défini dans assets/crops/<slug>.json.
 *   node scripts/crop-tool.mjs <slug> --bords    → .crop-preview/<slug>-bords.jpg
 *       les 4 bords du recadrage agrandis (haut, bas, gauche, droit) pour
 *       vérifier qu'aucun liseré de mur ne subsiste.
 *
 * assets/crops/<slug>.json :
 *   { "rotate": -0.6, "left": 120, "top": 300, "width": 2800, "height": 3600 }
 *   rotate en degrés (optionnel, sens horaire positif) ; left/top/width/height
 *   en pixels du cadre APRÈS rotation (EXIF puis manuelle).
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const slug = process.argv[2];
const grille = process.argv.includes('--grille');
if (!slug) { console.error('usage: crop-tool.mjs <slug> [--grille]'); process.exit(1); }

const fiche = fs.readFileSync(path.join(ROOT, 'src/content/oeuvres', `${slug}.md`), 'utf8');
const image = fiche.match(/^image: "?([^"\n]+)"?$/m)?.[1];
const src = path.join(ROOT, 'assets/originals', image);
const cropPath = path.join(ROOT, 'assets/crops', `${slug}.json`);
const crop = fs.existsSync(cropPath) ? JSON.parse(fs.readFileSync(cropPath, 'utf8')) : null;
const OUTDIR = path.join(ROOT, '.crop-preview');
fs.mkdirSync(OUTDIR, { recursive: true });

let img = sharp(src, { limitInputPixels: false }).rotate(); // EXIF
if (crop?.rotate) {
  img = sharp(await img.toBuffer(), { limitInputPixels: false }).rotate(crop.rotate, { background: '#b0a898' });
}
const frame = await sharp(await img.toBuffer(), { limitInputPixels: false }).metadata();
console.log(`${slug} — cadre après rotation : ${frame.width} × ${frame.height} px${crop?.rotate ? ` (rotation ${crop.rotate}°)` : ''}`);

if (grille) {
  const W = 800;
  const H = Math.round(W * frame.height / frame.width);
  const lines = [];
  for (let i = 1; i < 10; i++) {
    const x = Math.round((W * i) / 10), y = Math.round((H * i) / 10);
    lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="#00e5ff" stroke-width="1" opacity="0.75"/>`);
    lines.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="#00e5ff" stroke-width="1" opacity="0.75"/>`);
    lines.push(`<text x="${x + 3}" y="14" fill="#ff2d78" font-size="13" font-family="Helvetica">${Math.round((frame.width * i) / 10)}</text>`);
    lines.push(`<text x="3" y="${y - 4}" fill="#ff2d78" font-size="13" font-family="Helvetica">${Math.round((frame.height * i) / 10)}</text>`);
  }
  if (crop) {
    const s = W / frame.width;
    lines.push(`<rect x="${crop.left * s}" y="${crop.top * s}" width="${crop.width * s}" height="${crop.height * s}" fill="none" stroke="#00ff44" stroke-width="2"/>`);
  }
  await sharp(await img.toBuffer(), { limitInputPixels: false })
    .resize(W)
    .composite([{ input: Buffer.from(`<svg width="${W}" height="${H}">${lines.join('')}</svg>`) }])
    .jpeg({ quality: 82 })
    .toFile(path.join(OUTDIR, `${slug}-grille.jpg`));
  console.log(`→ .crop-preview/${slug}-grille.jpg`);
} else if (process.argv.includes('--bords')) {
  if (!crop) { console.error(`pas de assets/crops/${slug}.json`); process.exit(1); }
  const buf = await sharp(await img.toBuffer(), { limitInputPixels: false })
    .extract({ left: crop.left, top: crop.top, width: crop.width, height: crop.height })
    .toBuffer();
  const th = Math.max(24, Math.round(crop.height * 0.03)); // épaisseur bande h/b
  const tw = Math.max(24, Math.round(crop.width * 0.03)); // épaisseur bande g/d
  const W = 900, BH = 110, GAP = 26;
  const strips = [];
  const defs = [
    ['HAUT', { left: 0, top: 0, width: crop.width, height: th }],
    ['BAS', { left: 0, top: crop.height - th, width: crop.width, height: th }],
    ['GAUCHE', { left: 0, top: 0, width: tw, height: crop.height }],
    ['DROIT', { left: crop.width - tw, top: 0, width: tw, height: crop.height }],
  ];
  for (const [nom, region] of defs) {
    // extraction isolée : dans un même pipeline sharp, rotate passerait AVANT extract
    let strip = await sharp(buf).extract(region).toBuffer();
    if (nom === 'GAUCHE') strip = await sharp(strip).rotate(90).toBuffer(); // verticale -> horizontale
    if (nom === 'DROIT') strip = await sharp(strip).rotate(-90).toBuffer();
    strips.push([nom, await sharp(strip).resize(W, BH, { fit: 'fill' }).toBuffer()]);
  }
  const H = (BH + GAP) * 4;
  const labels = strips.map(([nom], i) =>
    `<text x="4" y="${i * (BH + GAP) + BH + 18}" fill="#00e5ff" font-size="15" font-family="Helvetica">${nom} (bord extérieur en haut de la bande)</text>`);
  await sharp({ create: { width: W, height: H, channels: 3, background: '#111' } })
    .composite([
      ...strips.map(([, b], i) => ({ input: b, left: 0, top: i * (BH + GAP) })),
      { input: Buffer.from(`<svg width="${W}" height="${H}">${labels.join('')}</svg>`), left: 0, top: 0 },
    ])
    .jpeg({ quality: 85 })
    .toFile(path.join(OUTDIR, `${slug}-bords.jpg`));
  console.log(`→ .crop-preview/${slug}-bords.jpg`);
} else {
  if (!crop) { console.error(`pas de assets/crops/${slug}.json`); process.exit(1); }
  await sharp(await img.toBuffer(), { limitInputPixels: false })
    .extract({ left: crop.left, top: crop.top, width: crop.width, height: crop.height })
    .resize(640, 640, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toFile(path.join(OUTDIR, `${slug}-manuel.jpg`));
  console.log(`→ .crop-preview/${slug}-manuel.jpg`);
}
