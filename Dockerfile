# syntax=docker/dockerfile:1

# Image de base epinglee a une version precise. Jamais de tag "latest" : un rebuild
# six mois plus tard doit produire exactement la meme base, sinon un deploiement
# routinier devient une mise a jour surprise de l'environnement d'execution.
ARG NODE_IMAGE=node:24.19.0-bookworm-slim

# ---------------------------------------------------------------------------
# Etage 1 : dependances
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app

# npm ci exige package-lock.json et installe exactement les versions verrouillees.
COPY package.json package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------------------
# Etage 2 : construction
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Les migrations ne doivent PAS tourner ici : src/instrumentation.ts se garde de la
# phase de build, ou le volume /data n'existe pas encore.
RUN npm run build

# ---------------------------------------------------------------------------
# Etage 3 : execution
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# La base vit dans le volume monte, jamais dans l'image : une image se remplace a
# chaque deploiement, les donnees doivent lui survivre.
ENV DATABASE_PATH=/data/budget.db

# L'image node fournit deja un utilisateur non root "node" (uid 1000).
# Le repertoire de donnees lui appartient, sans quoi le conteneur ne pourrait pas
# creer le fichier SQLite au premier demarrage.
RUN mkdir -p /data && chown -R node:node /data

# output: 'standalone' produit un serveur autonome, avec le strict necessaire de
# node_modules deja trace. Aucun module natif a recompiler ici : le driver SQLite est
# node:sqlite, integre au binaire Node.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

USER node

EXPOSE 3000
VOLUME ["/data"]

# La sonde interroge la route qui touche reellement la base. Un simple test de port
# ouvert declarerait le conteneur sain alors que le volume peut etre inaccessible.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
