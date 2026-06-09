# Instagram Reels Backend API

Production-level NestJS backend for zero-delay Instagram Reels.

**Stack:** NestJS · Cloudinary (HLS + CDN) · Neon DB · Upstash Redis · Prisma

---

## Architecture

```
Mobile App
    │
    ▼
NestJS API (this service)
    ├── Neon DB (Prisma) ──── stores reel metadata
    ├── Upstash Redis ──────── caches feed + batches views/likes
    └── Cloudinary ──────────── stores videos, transcodes HLS, serves via CDN
```

**Zero-delay reel playback** is achieved by:
1. **HLS streaming** — video plays before fully downloaded
2. **Predictive pre-fetch** — client downloads next 2-3 reels in background
3. **Cloudinary CDN** — 200+ global edge nodes serve video from nearby location

---

## Quick Start

### 1. Copy and fill in environment variables
```bash
cp .env.example .env
# Edit .env with your Neon DB, Cloudinary, and Upstash credentials
```

### 2. Install dependencies
```bash
npm install
```

### 3. Push the Prisma schema to Neon DB
```bash
npm run prisma:push
# or for production migrations:
npm run prisma:migrate
```

### 4. Start the dev server
```bash
npm run start:dev
```

### 5. Open Swagger docs
```
http://localhost:3000/docs
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/api/health` | Health check |
| `POST` | `/api/reels/upload-signature` | Generate Cloudinary signed upload params |
| `POST` | `/api/reels` | Create reel record (after Cloudinary upload) |
| `GET`  | `/api/reels/feed?cursor=&limit=10` | Cursor-paginated reel feed |
| `GET`  | `/api/reels/:id` | Get single reel |
| `POST` | `/api/reels/:id/like` | Toggle like |
| `POST` | `/api/reels/:id/view` | Record view event |
| `GET`  | `/api/reels/sse/:id` | SSE stream for reel processing status |
| `DELETE` | `/api/reels/:id` | Delete reel (owner only) |
| `POST` | `/api/webhooks/cloudinary` | Cloudinary processing webhook |

---

## Mobile Client Upload Flow

```
1. Client calls POST /api/reels/upload-signature
   → Gets { signature, apiKey, timestamp, folder, ... }

2. Client uploads video DIRECTLY to Cloudinary using those params
   → Cloudinary starts HLS transcoding automatically (sp_hd profile)
   → Video NEVER passes through our NestJS server

3. Client calls POST /api/reels with { cloudinaryPublicId, caption, ... }
   → Creates reel record in Neon DB with status=PROCESSING

4. Client subscribes to GET /api/reels/sse/:reelId
   → Waits for server-sent event

5. Cloudinary fires POST /api/webhooks/cloudinary when HLS is ready
   → Our service validates the signature
   → Updates reel status to READY, saves HLS URL in Neon DB
   → Emits SSE event to the client

6. Client receives SSE event → starts HLS playback via Cloudinary CDN
```

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Neon DB **pooler** connection string (from Neon dashboard) |
| `CLOUDINARY_CLOUD_NAME` | Your Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret |
| `CLOUDINARY_WEBHOOK_URL` | Public URL for Cloudinary webhook (e.g. `https://your-api.com/api/webhooks/cloudinary`) |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token |
| `JWT_SECRET` | 64+ character random string for JWT signing |

---

## Caching Strategy

| Cache Key | TTL | Contents |
|-----------|-----|----------|
| `feed:global:{cursor}` | 5 min | Paginated feed array |
| `reel:meta:{id}` | 30 min | Full reel object |
| `reel:pending_views:{id}` | ephemeral | Pending view count (flushed every 30s) |
| `user:liked:{userId}:{reelId}` | 60s | User's like state |

---

## Production Deployment

```bash
# Build Docker image
docker build -t insta-reels-api .

# Run with Docker Compose
docker compose up -d

# Or deploy to Railway/Render using the Dockerfile
```

> ⚠️ **Always** use the Neon DB **PgBouncer pooler** connection string (not the direct URL) to prevent connection exhaustion.
