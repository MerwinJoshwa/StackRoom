FROM node:20-slim

# Install system dependencies for running user projects
RUN apt-get update && apt-get install -y \
  python3 \
  python3-pip \
  default-jdk \
  curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy server package files and install
COPY server/package*.json ./server/
RUN cd server && npm install --omit=dev

# Copy client package files and build
COPY client/package*.json ./client/
RUN cd client && npm install

COPY client/ ./client/
RUN cd client && npm run build

# Copy server source
COPY server/ ./server/

# Move built client into server's public folder
RUN mkdir -p server/public && cp -r client/dist/* server/public/

WORKDIR /app/server

EXPOSE 4000

CMD ["node", "index.js"]
