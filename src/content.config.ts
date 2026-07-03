import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const oeuvres = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/oeuvres' }),
  schema: z.object({
    titre: z.string(),
    titreAValider: z.boolean().default(true),
    reference: z.string(),
    technique: z.enum(['acrylique', 'aquarelle']),
    techniqueAValider: z.boolean().default(false),
    support: z.string().default('toile'),
    annee: z.number().nullable().default(null),
    dimensions: z.string().nullable().default(null),
    disponible: z.boolean().default(true),
    collection: z.enum(['acryliques', 'aquarelles']),
    image: z.string(),
    alt: z.string(),
    featured: z.boolean().default(false),
    ordre: z.number(),
    aVerifier: z.string().nullable().default(null),
  }),
});

export const collections = { oeuvres };
