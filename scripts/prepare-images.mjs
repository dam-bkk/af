/**
 * Pipeline d'images AF — lit assets/originals/, rogne les marges de mur,
 * corrige légèrement les niveaux si terne, génère AVIF + WebP en 5 largeurs,
 * extrait couleur dominante + LQIP, écrit un manifest JSON.
 *
 * Prudence de recadrage : le rognage est estimé sur les 4 coins (couleur du mur) ;
 * si le résultat est suspect (trop ou trop peu rogné), l'image est listée dans
 * images-a-verifier.md et publiée avec une marge de sécurité.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const ORIGINALS = path.join(ROOT, 'assets/originals');
const OUT = path.join(ROOT, 'public/images/oeuvres');
const MANIFEST = path.join(ROOT, 'src/data/images-manifest.json');
const REPORT = path.join(ROOT, 'images-a-verifier.md');

const DRY = process.argv.includes('--dry');
const DRYDIR = path.join(ROOT, '.crop-preview');
if (DRY) fs.mkdirSync(DRYDIR, { recursive: true });

const WIDTHS = [400, 800, 1200, 1600, 2400];
const AVIF = { quality: 58, chromaSubsampling: '4:4:4', effort: 4 };
const WEBP = { quality: 74 };
const SAFETY = 0.008; // marge de sécurité réintroduite autour du rognage (0.8%)

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });

// --- fiches -> mapping référence / fichier image -------------------------
const fiches = fs.readdirSync(path.join(ROOT, 'src/content/oeuvres'))
  .filter((f) => f.endsWith('.md'))
  .map((f) => {
    const raw = fs.readFileSync(path.join(ROOT, 'src/content/oeuvres', f), 'utf8');
    const get = (k) => raw.match(new RegExp(`^${k}: "?([^"\\n]+)"?$`, 'm'))?.[1] ?? null;
    return { slug: f.replace('.md', ''), reference: get('reference'), image: get('image'), titre: get('titre') };
  });

const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {};
const report = [];

// --- détection du cadre de l'œuvre (bbox par texture) --------------------
// Le mur est lisse (même avec un dégradé d'éclairage), la peinture est
// texturée : on borne la zone riche en micro-contrastes. L'ombre portée,
// lisse elle aussi, est naturellement exclue.
export async function detectCrop(img, frame) {
  const W = 600;
  const { data, info } = await img.clone().greyscale().blur(0.6).resize(W).raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const g = (x, y) => data[(y * width + x) * channels];
  // énergie de gradient locale
  const edge = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++)
    for (let x = 1; x < width - 1; x++)
      edge[y * width + x] = Math.abs(g(x + 1, y) - g(x - 1, y)) + Math.abs(g(x, y + 1) - g(x, y - 1));
  const THR = 11;
  const rowFrac = (y) => { let n = 0; for (let x = 1; x < width - 1; x++) if (edge[y * width + x] > THR) n++; return n / (width - 2); };
  const colFrac = (x) => { let n = 0; for (let y = 1; y < height - 1; y++) if (edge[y * width + x] > THR) n++; return n / (height - 2); };
  const MIN = 0.12;
  // la jonction mur/étagère forme une ligne fine sur toute la largeur :
  // dans le quart bas, on saute ces lignes quasi pleines au lieu de s'y arrêter
  const ligneEtagere = (y, frac) => frac > 0.82 && y > height * 0.72;
  let top = 1, bottom = height - 2, left = 1, right = width - 2;
  while (top < height / 2) { const f = rowFrac(top); if (f >= MIN && !ligneEtagere(top, f)) break; top++; }
  while (bottom > height / 2) { const f = rowFrac(bottom); if (f >= MIN && !ligneEtagere(bottom, f)) break; bottom--; }
  while (left < width / 2 && colFrac(left) < MIN) left++;
  while (right > width / 2 && colFrac(right) < MIN) right--;

  // --- 2e passe : expansion couleur locale --------------------------------
  // La bbox texture est une graine sûre MAIS elle rase les zones peintes
  // lisses (ciel plat, lavis pâle). On étend chaque bord tant que la ligne
  // suivante diffère du mur voisin (comparaison locale, insensible au
  // gradient d'éclairage global).
  const color = await img.clone().blur(0.6).resize(W).raw().toBuffer({ resolveWithObject: true });
  const ch = color.info.channels;
  const cpx = (x, y) => {
    const i = (y * width + x) * ch;
    return [color.data[i], color.data[i + 1], color.data[i + 2]];
  };
  const medOf = (arr) => arr.sort((a, b) => a - b)[arr.length >> 1];
  const medColor = (pxs) => [0, 1, 2].map((c) => medOf(pxs.map((p) => p[c])));
  const cdist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  // ligne (row/col) -> couleur médiane sur l'étendue de la graine
  const ligne = (side, pos) => {
    const pxs = [];
    if (side === 'top' || side === 'bottom') for (let x = left; x <= right; x += 2) pxs.push(cpx(x, pos));
    else for (let y = top; y <= bottom; y += 2) pxs.push(cpx(pos, y));
    return medColor(pxs);
  };
  const etend = (side) => {
    const vertical = side === 'top' || side === 'bottom';
    const limite = vertical ? height : width;
    const cur = { top, bottom, left, right }[side];
    const dir = side === 'top' || side === 'left' ? -1 : 1;
    // zone mur de référence : 5 à 12 % au-delà du bord courant
    const span = Math.round(limite * 0.07);
    const debut = cur + dir * Math.round(limite * 0.05);
    const zone = [];
    for (let k = 0; k <= span; k++) {
      const pos = debut + dir * k;
      if (pos < 0 || pos >= limite) break;
      zone.push(ligne(side, pos));
    }
    if (zone.length < 4) return { edge: cur, incertain: false }; // pas assez de mur
    const wallMed = medColor(zone.flatMap((l) => [l]));
    const bruit = zone.map((l) => cdist(l, wallMed)).sort((a, b) => a - b);
    const thr = Math.max(16, bruit[Math.floor(bruit.length * 0.9)] * 1.6);
    let edge = cur, misses = 0;
    for (let pos = cur + dir; pos >= 0 && pos < limite; pos += dir) {
      if (cdist(ligne(side, pos), wallMed) > thr) { edge = pos; misses = 0; }
      else if (++misses >= 4) break;
    }
    // doute « pâle sur pâle » : si l'intérieur du bord ressemble au mur, le
    // bord réel de la toile est peut-être plus loin -> on élargit et on signale
    const interieur = [];
    for (let k = 2; k <= 4; k++) {
      const pos = edge - dir * k;
      if (pos >= 0 && pos < limite) interieur.push(cdist(ligne(side, pos), wallMed));
    }
    const dMoy = interieur.reduce((a, b) => a + b, 0) / (interieur.length || 1);
    if (dMoy < thr * 1.5) {
      const pousse = Math.round(limite * 0.05);
      return { edge: Math.max(0, Math.min(limite - 1, edge + dir * pousse)), incertain: true };
    }
    return { edge, incertain: false };
  };
  const cotesIncertains = [];
  for (const side of ['top', 'bottom', 'left', 'right']) {
    const { edge, incertain } = etend(side);
    if (side === 'top') top = edge; else if (side === 'bottom') bottom = edge;
    else if (side === 'left') left = edge; else right = edge;
    if (incertain) cotesIncertains.push({ top: 'haut', bottom: 'bas', left: 'gauche', right: 'droit' }[side]);
  }

  // marge de sécurité : on rend un peu de mur pour ne jamais mordre la peinture
  const mx = Math.round(width * SAFETY), my = Math.round(height * SAFETY);
  top = Math.max(0, top - my); bottom = Math.min(height - 1, bottom + my);
  left = Math.max(0, left - mx); right = Math.min(width - 1, right + mx);
  const scale = frame.width / width;
  const box = {
    left: Math.round(left * scale),
    top: Math.round(top * scale),
    width: Math.min(frame.width, Math.round((right - left + 1) * scale)),
    height: Math.min(frame.height, Math.round((bottom - top + 1) * scale)),
  };
  const areaRatio = (box.width * box.height) / (frame.width * frame.height);
  const shape = box.width / box.height;
  // garde-fou : résultat improbable -> on ne rogne pas, revue manuelle
  if (areaRatio < 0.25 || shape < 0.3 || shape > 3.4) return { box: null, areaRatio, raison: 'suspect', cotesIncertains };
  return { box, areaRatio, raison: null, cotesIncertains };
}

// --- retouche par image : exposition, contraste, saturation ---------------
// Plafonds volontairement bas : la fidélité des couleurs prime sur le punch.
async function retouch(img) {
  const stats = await img.clone().greyscale().stats();
  const { mean, stdev } = stats.channels[0];
  // exposition : on éclaircit une photo sombre, on n'assombrit jamais une œuvre pâle
  const brightness = Math.min(1.14, Math.max(0.97, 126 / mean));
  const saturation = 1.07; // les photos en lumière plate désaturent légèrement
  const a = Math.min(1.15, Math.max(1, 58 / stdev)); // contraste
  let out = img.modulate({ brightness, saturation });
  if (a > 1.01) out = out.linear(a, 128 * (1 - a));
  const applied = brightness !== 1 || a > 1.01;
  return { img: out, applied, note: `expo ×${brightness.toFixed(2)}, contraste ×${a.toFixed(2)}` };
}

for (const fiche of fiches) {
  // un PNG détouré (fond supprimé) prime sur la photo JPG d'origine
  const pngPath = path.join(ORIGINALS, fiche.image.replace(/\.jpe?g$/i, '.png'));
  const alpha = fs.existsSync(pngPath);
  const src = alpha ? pngPath : path.join(ORIGINALS, fiche.image);
  if (!fs.existsSync(src)) { report.push(`- **${fiche.reference}** : fichier source introuvable (${fiche.image})`); continue; }
  const slug = fiche.reference.toLowerCase();
  // recadrage manuel : assets/crops/<slug>.json (cf. scripts/crop-tool.mjs) — inutile en PNG détouré
  const manuelPath = path.join(ROOT, 'assets/crops', `${slug}.json`);
  const manuel = !alpha && fs.existsSync(manuelPath) ? JSON.parse(fs.readFileSync(manuelPath, 'utf8')) : null;
  const manuelSig = manuel ? JSON.stringify(manuel) : alpha ? 'png-detoure' : null;
  const stamp = fs.statSync(src).mtimeMs;
  const entry = manifest[slug];
  if (!DRY && entry && entry.stamp === stamp && (entry.manuel ?? null) === manuelSig && entry.files.every((f) => fs.existsSync(path.join(OUT, f)))) {
    console.log(`= ${slug} (à jour)`); continue;
  }

  let img = sharp(src, { limitInputPixels: false }).rotate(); // EXIF
  if (alpha) {
    // rogne la bordure transparente autour de l'œuvre détourée
    img = sharp(await img.trim().toBuffer(), { limitInputPixels: false });
  } else if (manuel?.rotate) {
    img = sharp(await img.toBuffer(), { limitInputPixels: false }).rotate(manuel.rotate, { background: '#b0a898' });
  }
  const frame = await sharp(await img.toBuffer(), { limitInputPixels: false }).metadata();

  let box = null, areaRatio = 1, raison = null, cotesIncertains = [];
  if (manuel && Number.isFinite(manuel.left) && Number.isFinite(manuel.width)) {
    box = { left: manuel.left, top: manuel.top, width: manuel.width, height: manuel.height };
    areaRatio = (box.width * box.height) / (frame.width * frame.height);
  } else if (!alpha) {
    ({ box, areaRatio, raison, cotesIncertains } = await detectCrop(img, frame));
  }
  let flagged = null;
  if (alpha || manuel) flagged = null; // détouré ou validé à l'œil, rien à signaler
  else if (raison === 'suspect') flagged = `rognage improbable (œuvre = ${Math.round(areaRatio * 100)}% du cadre) — publiée SANS rognage, recadrer à la main`;
  else if (areaRatio > 0.96) flagged = 'aucun bord détecté (photo plein cadre ?) — publiée telle quelle, confirmer œuvre entière vs détail';
  else if (areaRatio < 0.35) flagged = `rognage fort (œuvre = ${Math.round(areaRatio * 100)}% du cadre) — vérifier que rien n'est coupé`;
  else if (cotesIncertains?.length) flagged = `œuvre pâle : bord(s) ${cotesIncertains.join(', ')} incertain(s), marge élargie — vérifier le cadrage`;

  if (DRY) {
    // aperçu du cadre détecté, sans encodage
    const pw = 420, ph = Math.round(pw * frame.height / frame.width);
    const s = pw / frame.width;
    const rect = box
      ? `<rect x="${box.left * s}" y="${box.top * s}" width="${box.width * s}" height="${box.height * s}" fill="none" stroke="${manuel ? '#00ff44' : 'red'}" stroke-width="3"/>`
      : `<text x="10" y="30" fill="red" font-size="24">SANS ROGNAGE</text>`;
    await img.clone().resize(pw).composite([{ input: Buffer.from(`<svg width="${pw}" height="${ph}">${rect}</svg>`) }])
      .jpeg({ quality: 80 }).toFile(path.join(DRYDIR, `${slug}.jpg`));
    console.log(`◻ ${slug} — ${raison ?? 'ok'} (${Math.round(areaRatio * 100)}%)${flagged ? ' ⚑' : ''}`);
    continue;
  }

  if (box && (manuel || areaRatio <= 0.96)) img = img.extract(box);

  // pas de retouche sur les PNG détourés : linear/modulate toucheraient l'alpha,
  // et l'outil de détourage a déjà ajusté les niveaux
  if (!alpha) {
    const { img: leveled, applied, note } = await retouch(img);
    img = leveled;
    if (applied) console.log(`  ~ retouche ${slug} : ${note}`);
  }

  const master = await img.toBuffer();
  const masterMeta = await sharp(master).metadata();

  const files = [];
  for (const w of WIDTHS) {
    if (w > masterMeta.width) continue;
    const base = sharp(master).resize(w);
    await base.clone().avif(AVIF).toFile(path.join(OUT, `${slug}-${w}.avif`));
    await base.clone().webp(WEBP).toFile(path.join(OUT, `${slug}-${w}.webp`));
    files.push(`${slug}-${w}.avif`, `${slug}-${w}.webp`);
  }
  // dérivé JPEG pour Open Graph (compat scrapers) — aplati sur le fond charbon du site
  await sharp(master).resize(1200).flatten({ background: '#0e0f13' }).jpeg({ quality: 80 }).toFile(path.join(OUT, `${slug}-og.jpg`));
  files.push(`${slug}-og.jpg`);

  const { dominant } = await sharp(master).flatten({ background: '#16181d' }).stats();
  const lqipBuf = await sharp(master).resize(20).webp({ quality: 30 }).toBuffer();

  manifest[slug] = {
    stamp,
    manuel: manuelSig,
    alpha,
    source: fiche.image,
    width: masterMeta.width,
    height: masterMeta.height,
    ratio: +(masterMeta.width / masterMeta.height).toFixed(4),
    widths: WIDTHS.filter((w) => w <= masterMeta.width),
    dominant: `rgb(${dominant.r} ${dominant.g} ${dominant.b})`,
    lqip: `data:image/webp;base64,${lqipBuf.toString('base64')}`,
    files,
  };
  if (flagged) report.push(`- **${fiche.reference}** (${fiche.image}, « ${fiche.titre} ») : ${flagged}`);
  console.log(`✓ ${slug} — ${masterMeta.width}×${masterMeta.height} (œuvre = ${Math.round(areaRatio * 100)}% du cadre)`);
}

fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
fs.writeFileSync(
  REPORT,
  `# Images à vérifier\n\nGénéré par \`scripts/prepare-images.mjs\` le ${new Date().toISOString().slice(0, 10)}.\n\n` +
  (report.length ? report.join('\n') + '\n' : 'Aucun problème détecté.\n') +
  `\n## Rappels (constat manuel)\n\n- IMG_1907 : floue au centre — nouvelle photo souhaitable si œuvre entière\n- IMG_1965 : floue (le plan large IMG_1964 est net)\n- IMG_1931 : légèrement floue — doublon net conservé : IMG_1940\n- Gros plans non catalogués : IMG_1907, IMG_1934, IMG_1965, IMG_1970, IMG_2000 ; doublons : IMG_1931, IMG_1968\n`
);
console.log(`\nManifest : ${Object.keys(manifest).length} œuvres. Rapport : images-a-verifier.md`);
