FROM node:20-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv build-essential python3-dev \
    && rm -rf /var/lib/apt/lists/*
COPY backend/package*.json ./
RUN npm install --omit=dev
COPY backend/ ./
COPY scraper/requirements.txt /scraper/requirements.txt
RUN python3 -m venv /scraper/.venv \
    && /scraper/.venv/bin/pip install --no-cache-dir -r /scraper/requirements.txt
COPY db/ /db/

FROM node:20-bookworm-slim AS run
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app ./
COPY --from=build /scraper/.venv /scraper/.venv
COPY scraper/ /scraper/
COPY db/ /db/
ENV PYTHON_BIN=/scraper/.venv/bin/python
ENV PORT=4000
EXPOSE 4000
CMD ["node", "server.js"]