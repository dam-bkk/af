import manifest from '../data/images-manifest.json';

export interface ImgEntry {
  width: number;
  height: number;
  ratio: number;
  widths: number[];
  dominant: string;
  lqip: string;
  /** PNG détouré (fond supprimé) : rendu sans cadre, ombre au contour */
  alpha?: boolean;
}

const data = manifest as Record<string, ImgEntry & { stamp: number; files: string[] }>;

export function img(slug: string): ImgEntry {
  const e = data[slug];
  if (!e) throw new Error(`Image manquante dans le manifest : ${slug} — lancer \`npm run images\``);
  return e;
}

export function srcset(slug: string, ext: 'avif' | 'webp', max = Infinity): string {
  return img(slug)
    .widths.filter((w) => w <= max)
    .map((w) => `/images/oeuvres/${slug}-${w}.${ext} ${w}w`)
    .join(', ');
}

export function src(slug: string, w: number, ext: 'avif' | 'webp' | 'jpg' = 'webp'): string {
  return `/images/oeuvres/${slug}-${w}.${ext}`;
}

export function ogImage(slug: string): string {
  return `/images/oeuvres/${slug}-og.jpg`;
}
