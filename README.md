# Rising Star Backend

Node.js + Express backend for Rising Star task content.

## What it does

- Stores task records in MongoDB.
- Seeds `Music`, `Ads`, and `Art` task data.
- Exposes task API for frontend consumption.
- Resolves media URLs from local public assets by default.
- Supports Cloudinary-hosted media via a generated media map.

## Setup

1. Install dependencies:
   - `npm install`
2. Create env file:
   - `copy .env.example .env`
3. Start MongoDB locally (or use remote URI in `.env`).
4. Seed tasks:
   - `npm run seed:tasks`
5. Start server:
   - `npm run dev`

## Cloudinary (Ads, Arts, Music, Profile Photos)

1. Add Cloudinary credentials in backend `.env`:
   - `CLOUDINARY_CLOUD_NAME`
   - `CLOUDINARY_API_KEY`
   - `CLOUDINARY_API_SECRET`
   - Optional: `CLOUDINARY_FOLDER` (default: `risingstar`)
2. Upload frontend media and generate URL map:
   - `npm run upload:cloudinary`
3. Reseed tasks so Music/Ads media fields are refreshed from mapped assets:
   - `npm run seed:tasks`

The uploader writes `src/data/cloudinary-media-map.json`. Task responses automatically use Cloudinary URLs when mappings exist. Profile photo uploads use the same Cloudinary credentials at request time and store the returned secure URL on the user record.

## API

- `GET /health`
- `GET /api/tasks`
- `POST /api/tasks/seed`
- `GET /api/music`
- `GET /api/ads`
- `POST /api/sync` body: `{ "force": false }`
