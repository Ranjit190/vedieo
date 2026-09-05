# Build stage: compile TypeScript and install dependencies. mediasoup tries a
# prebuilt worker binary first; when none matches the host (e.g. a very new
# kernel) it compiles the worker from source, which needs python3/pip and a
# C++ toolchain — hence the build tools here. They are NOT in the final image.
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip python-is-python3 build-essential \
    && rm -rf /var/lib/apt/lists/*
# Debian marks its Python as externally managed (PEP 668); mediasoup's worker
# build installs its build driver via pip, which this flag permits.
ENV PIP_BREAK_SYSTEM_PACKAGES=1
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
RUN npm prune --omit=dev

# Runtime stage: no toolchain needed — the compiled worker binary ships
# inside node_modules copied from the build stage.
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
EXPOSE 4000
CMD ["node", "dist/index.js"]
