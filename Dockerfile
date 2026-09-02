FROM node:24-alpine

RUN apk add --no-cache libc6-compat

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY public ./public
COPY server ./server

RUN mkdir -p /data/planos-estudos

# EasyPanel faz proxy para a porta 80 do container.
# Variáveis de banco/Supabase devem ir em Environment (runtime), não como build-args.
# Monte /data/planos-estudos como volume persistente no EasyPanel.
ENV NODE_ENV=production
ENV PLAN_IMAGE_OUTPUT_DIR=/data/planos-estudos

EXPOSE 80

CMD ["sh", "-c", "PORT=80 node server/index.js"]
