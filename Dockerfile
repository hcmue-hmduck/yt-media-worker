FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt ./
RUN python3 -m venv /opt/media && /opt/media/bin/pip install --no-cache-dir -r requirements.txt
ENV PATH="/opt/media/bin:${PATH}"
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY --chown=node:node . .
ENV NODE_ENV=production PORT=8080
USER node
EXPOSE 8080
CMD ["node", "index.js"]
