# Usa imagem oficial do Bun
FROM oven/bun:1.2.0-alpine AS base

# Instala dependências necessárias
RUN apk add --no-cache nodejs npm

WORKDIR /app

# Copia arquivos de configuração
COPY package.json bun.lock turbo.json tsconfig.json bunfig.toml ./

# Copia workspaces
COPY packages ./packages
COPY apps/tools-api ./apps/tools-api

# Instala dependências
RUN bun install

# Build do projeto
RUN bun run build

# Stage de produção
FROM oven/bun:1.2.0-alpine

RUN apk add --no-cache nodejs

WORKDIR /app

# Copia apenas os arquivos necessários para produção
COPY --from=base /app/package.json ./
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/packages ./packages
COPY --from=base /app/apps/tools-api/dist ./apps/tools-api/dist
COPY --from=base /app/apps/tools-api/package.json ./apps/tools-api/

# Variáveis de ambiente padrão
ENV NODE_ENV=production
ENV PORT=3333

# Expõe a porta da API
EXPOSE 3333

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3333/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Comando para iniciar a API
CMD ["bun", "run", "start:api"]
