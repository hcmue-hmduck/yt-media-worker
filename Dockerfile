FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/ytdlp \
    && /opt/ytdlp/bin/pip install --no-cache-dir 'yt-dlp[default]'
ENV PATH="/opt/ytdlp/bin:${PATH}" NODE_ENV=production PORT=8080
WORKDIR /app
COPY --chown=node:node package.json index.js ./
USER node
EXPOSE 8080
CMD ["node", "index.js"]
