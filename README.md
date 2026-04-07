# Rising Star Backend

Node.js + Express backend for Rising Star task content.

## What it does

- Stores task records in MongoDB.
- Seeds dummy `Music`, `Ads`, and `Art` task data with image covers.
- Exposes task API for frontend consumption.
- Uses image URLs like `/images/*` and `/arts/*` (served by frontend public assets).

## Setup

1. Install dependencies:
   - `npm install`
2. Create env file:
   - `copy .env.example .env`
3. Start MongoDB locally (or use remote URI in `.env`).
4. Seed dummy tasks:
   - `npm run seed:tasks`
5. Start server:
   - `npm run dev`

## API

- `GET /health`
- `GET /api/tasks`
- `POST /api/tasks/seed`
- `GET /api/music`
- `GET /api/ads`
- `POST /api/sync` body: `{ "force": false }`
