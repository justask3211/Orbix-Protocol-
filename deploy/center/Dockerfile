# Orbix Center — API + prebuilt SPA in one image, one origin.
#
# The SPA is built before deployment (`cd web && npm install && npx vite build`) and shipped
# in the image, so the runtime image needs no Node toolchain and cannot fail on an npm
# install inside a constrained container. FastAPI serves both /api/center/v1 and the SPA
# at /center/*, which removes CORS and any proxy from the path.

FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    CENTER_WEB_DIST=/srv/web \
    CENTER_DB=/data/center.db \
    PORT=8080
WORKDIR /srv

RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

COPY deploy/center/requirements.txt ./requirements.txt
RUN pip install -r requirements.txt

COPY center/ ./center/
COPY web/dist/ ./web/

RUN mkdir -p /data

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
    CMD curl -fsS "http://127.0.0.1:${PORT}/api/center/v1/health/live" || exit 1

# One worker: the in-process scheduler and the room registry must be authoritative,
# and SQLite in WAL mode on the mounted volume is the durable store.
CMD ["sh", "-c", "uvicorn center.api:create_app --factory --host 0.0.0.0 --port ${PORT} --workers 1"]
