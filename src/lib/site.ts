// Coordonnées centralisées — pas de formulaire de contact (choix sécurité) :
// tout passe par un simple mailto.
// TODO : remplacer par l'adresse réelle d'Annick avant mise en ligne.
export const EMAIL = 'contact@annickfleury.example';

export const mailto = (sujet?: string) =>
  `mailto:${EMAIL}${sujet ? `?subject=${encodeURIComponent(sujet)}` : ''}`;
