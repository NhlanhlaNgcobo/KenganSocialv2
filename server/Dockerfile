# Node.js Express Server Dockerfile
FROM node:20-slim

# Install FFmpeg (requested for some background jobs)
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (production only)
RUN npm install --production

# Copy source code
COPY . .

# Build step if using TypeScript (since we use tsx in dev, we might need to pre-build for prod)
# Actually, we can use tsx in prod or build with tsc.
# For simplicity and speed in this specific project context, we'll use tsx for now 
# but pre-installing glob and other deps.

EXPOSE 5000

ENV NODE_ENV=production

CMD ["npx", "tsx", "server.js"]
