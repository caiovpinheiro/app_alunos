FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY public ./public
COPY server ./server

# EasyPanel faz proxy para a porta 80 do container.
# Variáveis de banco/Supabase devem ir em Environment (runtime), não como build-args.
ENV NODE_ENV=production

EXPOSE 80

CMD ["sh", "-c", "PORT=80 node server/index.js"]
