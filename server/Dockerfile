# KenganSocial API (Express + TypeScript via tsx)
# Runs FFmpeg jobs, and headless Chrome for Remotion launch videos and website capture.
FROM node:20-bookworm-slim

# FFmpeg (with libass for burned-in captions) and the libraries Chrome Headless Shell needs.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg ca-certificates fonts-dejavu-core \
    libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libgbm1 libasound2 libxrandr2 \
    libxkbcommon0 libxfixes3 libxcomposite1 libxdamage1 libpango-1.0-0 libcairo2 libcups2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
# tsx runs the TypeScript routes in production, so dev dependencies are installed too.
RUN npm ci

COPY . .

# Download Chrome Headless Shell for Remotion at build time instead of on the first render.
RUN node -e "require('@remotion/renderer').ensureBrowser().then(() => console.log('Chrome ready'))"

ENV NODE_ENV=production
EXPOSE 5000

CMD ["npx", "tsx", "server.js"]
