#!/bin/sh
# Déploiement AF Peinture sur le VM OCI (lancer depuis /opt/apps/af) :
#   git pull -> build (docker node:22) -> précompression gzip+zstd.
# Le conteneur af-web sert ensuite dist/ tel quel (pas de restart nécessaire).
set -e
cd "$(dirname "$0")/.."

git pull --ff-only

# -u : le build appartient à l'utilisateur hôte (sinon dist/ serait à root
# et la précompression ci-dessous échouerait)
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD":/app -w /app node:22-alpine \
  sh -c "npm ci --no-audit --no-fund && npm run build"

# le build sur VM tourne sans assets/originals : il peut toucher des fichiers
# suivis (rapport d'images, favicons) — on remet la version du repo
git checkout -- images-a-verifier.md public src/data 2>/dev/null || true

# précompression : Caddy sert les .zst/.gz via file_server precompressed
find dist -type f \( -name '*.html' -o -name '*.css' -o -name '*.js' \
  -o -name '*.svg' -o -name '*.xml' -o -name '*.txt' -o -name '*.json' \) \
  | while read -r f; do
      gzip -9 -kf "$f"
      zstd -19 -q -f "$f" -o "$f.zst"
    done

echo "Déploiement AF terminé — dist/ servi par af-web."
