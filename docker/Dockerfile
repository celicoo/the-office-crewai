# Build from the repo root:
#   docker compose -f docker/docker-compose.yml up --build

FROM node:22-bookworm AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* frontend/bun.lock* ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim-bookworm AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    OFFICE_PORT=8780 \
    OFFICE_READ_ONLY=true \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    OFFICE_CONFIG=/app/config/office.yml \
    OFFICE_STORAGE_DIR=/app/data/blackboard \
    COMPANY_WORKSPACE=/app/workspace \
    OFFICE_WORKSPACE=/app/workspace

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential \
      g++ \
      python3-dev \
      curl \
      ca-certificates \
      fonts-liberation \
      libasound2 \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libcups2 \
      libdbus-1-3 \
      libdrm2 \
      libgbm1 \
      libgtk-3-0 \
      libnspr4 \
      libnss3 \
      libx11-xcb1 \
      libxcomposite1 \
      libxdamage1 \
      libxfixes3 \
      libxkbcommon0 \
      libxrandr2 \
      xdg-utils \
      gosu \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# hnswlib (EpochDB) compiles from source and needs g++ / build-essential.
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --upgrade pip \
 && pip install -r /app/backend/requirements.txt

RUN playwright install --with-deps chromium

COPY backend /app/backend
COPY config /app/config
COPY --from=frontend /app/frontend/dist /app/frontend/dist

COPY docker/entrypoint.sh /usr/local/bin/office-entrypoint.sh

RUN mkdir -p /app/data/blackboard /app/workspace \
      /app/workspace/artigos /app/workspace/pautas \
      /app/workspace/aprovacoes /app/workspace/publicacao \
      /app/workspace/publicacoes /app/workspace/pesquisas \
 && useradd --create-home --uid 10001 office \
 && chown -R office:office /app /ms-playwright \
 && chmod +x /usr/local/bin/office-entrypoint.sh

WORKDIR /app/backend
ENTRYPOINT ["office-entrypoint.sh"]
EXPOSE 8780

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8780/api/health || exit 1

CMD ["python", "main.py"]
