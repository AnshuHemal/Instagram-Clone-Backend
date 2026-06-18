<h1 align="center">
  <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/e/e7/Instagram_logo_2016.svg/132px-Instagram_logo_2016.svg.png" width="40" />
  Instagram Clone — Backend API
</h1>

<p align="center">
  A production-grade REST + WebSocket API powering an Instagram-like mobile app.<br/>
  Built with <strong>NestJS</strong> · <strong>Prisma + Neon DB</strong> · <strong>Cloudinary</strong> · <strong>Upstash Redis</strong> · <strong>Socket.IO</strong>
</p>

<p align="center">
  <img alt="NestJS" src="https://img.shields.io/badge/NestJS-10-E0234E?style=for-the-badge&logo=nestjs" />
  <img alt="Prisma" src="https://img.shields.io/badge/Prisma-5-2D3748?style=for-the-badge&logo=prisma" />
  <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-Neon-336791?style=for-the-badge&logo=postgresql" />
  <img alt="Redis" src="https://img.shields.io/badge/Redis-Upstash-DC382D?style=for-the-badge&logo=redis" />
  <img alt="Cloudinary" src="https://img.shields.io/badge/Cloudinary-HLS-3448C5?style=for-the-badge" />
  <img alt="Socket.IO" src="https://img.shields.io/badge/Socket.IO-4-010101?style=for-the-badge&logo=socket.io" />
  <img alt="Deployed" src="https://img.shields.io/badge/Deployed-Vercel-000000?style=for-the-badge&logo=vercel" />
</p>

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Tech Stack](#-tech-stack)
- [Architecture](#-architecture)
- [Modules & API Reference](#-modules--api-reference)
- [Database Schema](#-database-schema)
- [Real-time Features](#-real-time-features)
- [Background Jobs & Caching](#-background-jobs--caching)
- [Security & Rate Limiting](#-security--rate-limiting)
- [Getting Started](#-getting-started)
- [Environment Variables](#-environment-variables)
- [Deployment](#-deployment)

---

## 🌟 Overview

This is a **production-level NestJS REST + WebSocket API** that serves an Instagram-clone mobile app. It covers the full feature surface of a social media platform:

- **Multi-step onboarding** with OTP email verification
- **Photo & Video Posts** with multi-image carousel support
- **Reels** — short-form video with Cloudinary HLS transcoding + CDN streaming
- **Stories** with 24-hour auto-expiry and view tracking
- **Story Highlights** — pinned story collections on profiles
- **Real-time Chat** (DMs + Group Chats) via Socket.IO WebSocket gateway
- **Follow System** — public/private accounts, follow requests, suggestions
- **Notifications** — in-app + Expo Push Notifications
- **Explore & Search** — users, posts, hashtags
- **Hashtag System** — trending hashtags, content linking
- **Feed** — unified ranked feed combining posts and reels
- **Redis Caching** — view/like count batching with 30-second cron flush
- **Swagger API Docs** — available in development at `/api/docs`

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | NestJS 10 (Express adapter) |
| **Language** | TypeScript 5 |
| **ORM** | Prisma 5 |
| **Database** | Neon DB (Serverless PostgreSQL) |
| **Cache** | Upstash Redis |
| **Media Storage** | Cloudinary (images + HLS video transcoding + CDN) |
| **Real-time** | Socket.IO 4 (WebSocket gateway) |
| **Auth** | JWT (Passport.js) + Refresh Token rotation |
| **Email** | Nodemailer (OTP delivery) |
| **Push Notifications** | Expo Push Notification Service |
| **Deployment** | Vercel (serverless) |
| **API Docs** | Swagger / OpenAPI |
| **Rate Limiting** | NestJS Throttler (burst + sustained) |
| **Scheduling** | NestJS Schedule (cron jobs) |
| **Events** | NestJS EventEmitter (SSE pub/sub) |

---

## 🏗 Architecture

```
┌────────────────────────────────────────────────────────────┐
│                     Mobile Client (Expo)                    │
└───────────────────────┬────────────────────────────────────┘
                        │ HTTP REST + WebSocket
┌───────────────────────▼────────────────────────────────────┐
│                   NestJS API Server                         │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Auth │ Posts │ Reels │ Stories │ Chat │ Notifications│  │
│  │  Feed │ Hashtags │ Webhooks │ Jobs │ Health          │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │ Prisma ORM │  │ Upstash Redis│  │   Cloudinary SDK   │  │
│  └─────┬──────┘  └──────┬───────┘  └─────────┬──────────┘  │
└────────│────────────────│──────────────────────│────────────┘
         │                │                      │
    ┌────▼────┐     ┌──────▼──────┐      ┌───────▼────────┐
    │ Neon DB │     │ Redis Cache │      │ Cloudinary CDN │
    │(Postgres)│     │(Stats Batch)│      │(HLS Streaming) │
    └─────────┘     └─────────────┘      └────────────────┘
```

### Key Architectural Decisions

- **Serverless-first** — deployed on Vercel with the Express adapter; state-free, scales to zero
- **Direct-to-CDN uploads** — Cloudinary signed uploads let mobile clients upload video/images directly to Cloudinary. The NestJS server is never a media proxy
- **Redis stat batching** — view/like counts are incremented in Redis and flushed to Neon DB every 30 seconds via a cron job, avoiding hot-row contention on high-traffic reels
- **HLS transcoding** — Cloudinary converts raw video to HLS (`.m3u8` playlist) for adaptive bitrate streaming. The backend gets notified via a webhook when transcoding completes
- **SSE for reel status** — after upload, clients subscribe to a Server-Sent Event stream to know when their reel transitions from `PROCESSING → READY`

---

## 📦 Modules & API Reference

All endpoints are prefixed with `/api`. JWT Bearer auth is required unless marked **public**.

### 🔐 Auth Module — `/api/auth`

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/auth/register/send-otp` | Public | Send OTP to email for new account |
| `POST` | `/auth/register/verify-otp` | Public | Verify OTP, receive `signupToken` |
| `POST` | `/auth/register/complete` | Public | Complete registration with profile |
| `GET` | `/auth/check-username` | Public | Check username availability |
| `POST` | `/auth/login` | Public | Login, receive JWT pair |
| `POST` | `/auth/refresh` | Public | Refresh JWT access token |
| `GET` | `/auth/profile` | JWT | Get current user profile |
| `PATCH` | `/auth/profile` | JWT | Update display name, bio, gender, etc. |
| `POST` | `/auth/profile/avatar` | JWT | Upload avatar image (multipart) |
| `GET` | `/auth/users/search?q=` | JWT | Search users by username / display name |
| `GET` | `/auth/users/suggestions` | JWT | Follow recommendations |
| `POST` | `/auth/users/:id/follow` | JWT | Follow user (or send follow request for private) |
| `DELETE` | `/auth/users/:id/follow` | JWT | Unfollow user |
| `GET` | `/auth/users/:id/follow-status` | JWT | Get follow status to a user |
| `GET` | `/auth/users/:id/profile` | JWT | Get any user's public profile |
| `GET` | `/auth/users/follow-requests` | JWT | Get incoming follow requests |
| `PATCH` | `/auth/users/follow-requests/:id/accept` | JWT | Accept a follow request |
| `PATCH` | `/auth/users/follow-requests/:id/decline` | JWT | Decline a follow request |
| `DELETE` | `/auth/users/:id/follow-request` | JWT | Cancel an outgoing follow request |
| `POST` | `/auth/users/follow-multiple` | JWT | Follow multiple users at once (onboarding) |
| `POST` | `/auth/push-token` | JWT | Register Expo push token for notifications |

### 📸 Posts Module — `/api/posts`

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/posts/upload-signature` | JWT | Get Cloudinary signed upload params |
| `POST` | `/posts` | JWT | Create post with media (after direct upload) |
| `GET` | `/posts/feed` | Public | Cursor-paginated home feed |
| `GET` | `/posts/saved` | JWT | Get saved/bookmarked posts |
| `GET` | `/posts/search?q=` | JWT | Search posts by caption or location |
| `GET` | `/posts/user/:userId` | Public | Get a user's posts |
| `GET` | `/posts/:id` | Public | Get single post |
| `PATCH` | `/posts/:id` | JWT | Edit post caption/location |
| `DELETE` | `/posts/:id` | JWT | Soft-delete own post |
| `POST` | `/posts/:id/like` | JWT | Toggle post like |
| `POST` | `/posts/:id/save` | JWT | Toggle post bookmark/save |
| `POST` | `/posts/:id/comment` | JWT | Add a comment |
| `GET` | `/posts/:id/comments` | Public | Get paginated comments |
| `POST` | `/posts/:id/comments/:commentId/reply` | JWT | Reply to a comment |
| `GET` | `/posts/:id/comments/:commentId/replies` | Public | Get comment replies |
| `POST` | `/posts/:id/comments/:commentId/like` | JWT | Toggle comment like |
| `DELETE` | `/posts/:id/comments/:commentId` | JWT | Delete own comment |

### 🎬 Reels Module — `/api/reels`

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/reels/upload-signature` | JWT | Get Cloudinary signed upload signature |
| `POST` | `/reels` | JWT | Create reel record (after direct video upload) |
| `GET` | `/reels/feed` | Public | Cursor-paginated reel feed (HLS URLs) |
| `GET` | `/reels/user/:userId` | Public | Get reels by a specific user |
| `GET` | `/reels/sse/:id` | Public | SSE stream for reel processing status |
| `GET` | `/reels/:id` | Public | Get single reel |
| `PATCH` | `/reels/:id` | JWT | Edit reel caption / audio name |
| `DELETE` | `/reels/:id` | JWT | Soft-delete own reel |
| `POST` | `/reels/:id/like` | JWT | Toggle reel like |
| `POST` | `/reels/:id/view` | JWT | Record view event (fire-and-forget, Redis-batched) |
| `POST` | `/reels/:id/comment` | JWT | Add a comment to reel |
| `GET` | `/reels/:id/comments` | Public | Get reel comments |

### 📖 Stories Module — `/api/stories`

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/stories` | JWT | Create a story (image/video, 24h expiry) |
| `GET` | `/stories` | JWT | Get active stories grouped by user |
| `POST` | `/stories/:id/view` | JWT | Mark story as viewed |
| `GET` | `/stories/archive` | JWT | Get all own stories (archive) |
| `POST` | `/stories/highlights` | JWT | Create a highlight collection |
| `GET` | `/stories/highlights/:userId` | JWT | Get user's highlights |
| `GET` | `/stories/highlights/:id/stories` | JWT | Get stories inside a highlight |
| `POST` | `/stories/highlights/:id/stories` | JWT | Add story to highlight |
| `DELETE` | `/stories/highlights/:id/stories/:storyId` | JWT | Remove story from highlight |
| `PATCH` | `/stories/highlights/:id` | JWT | Update highlight title/cover |
| `DELETE` | `/stories/highlights/:id` | JWT | Delete a highlight |

### 💬 Chat Module — `/api/chat` + WebSocket

#### REST Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/chat/conversations` | JWT | Get all conversations (inbox) |
| `POST` | `/chat/conversations` | JWT | Start a new DM or group chat |
| `GET` | `/chat/conversations/:id/messages` | JWT | Get paginated message history |

#### Socket.IO Events (WebSocket)

Connect with `Authorization: Bearer <token>` header or `?token=` query param.

| Event (Emit) | Payload | Description |
|---|---|---|
| `joinConversation` | `{ conversationId }` | Join a conversation room |
| `leaveConversation` | `{ conversationId }` | Leave a conversation room |
| `sendMessage` | `{ conversationId, text, mediaUrl?, referenceType?, referenceId?, storyId? }` | Send a message |
| `markAsRead` | `{ conversationId }` | Mark all messages as read |
| `typingStatus` | `{ conversationId, isTyping }` | Broadcast typing indicator |

| Event (Listen) | Payload | Description |
|---|---|---|
| `messageReceived` | Message object | New message in room |
| `inboxUpdated` | Inbox summary | Last message update for all participants |
| `messagesRead` | `{ conversationId, readerId }` | Read receipt broadcast |
| `typingStatusReceived` | `{ conversationId, senderId, isTyping }` | Typing indicator |
| `userOnlineStatus` | `{ userId, isOnline }` | User presence changes |
| `notificationReceived` | Notification object | Real-time in-app notification |

### 🔔 Notifications Module — `/api/notifications`

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/notifications` | JWT | Get paginated notifications |
| `PATCH` | `/notifications/:id/read` | JWT | Mark a notification as read |
| `PATCH` | `/notifications/read-all` | JWT | Mark all notifications as read |

**Notification types:** `FOLLOW`, `FOLLOW_REQUEST`, `FOLLOW_REQUEST_ACCEPTED`, `LIKE_POST`, `LIKE_REEL`, `COMMENT_POST`, `COMMENT_REEL`

### #️⃣ Hashtags Module — `/api/hashtags`

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/hashtags/search?q=` | Public | Search hashtags by prefix |
| `GET` | `/hashtags/trending` | Public | Get top 10 trending hashtags |
| `GET` | `/hashtags/:tag` | Public | Get posts for a hashtag (paginated) |

### 🌐 Feed Module — `/api/feed`

Provides a unified ranked feed combining posts and reels from followed users.

### 🔗 Webhooks Module — `/api/webhooks`

Receives Cloudinary upload completion callbacks to transition reel status from `PROCESSING → READY` and publish SSE events.

### ❤️ Health — `/api/health`

Returns `{ status: "ok" }` for uptime monitoring.

---

## 🗄 Database Schema

Built on **Neon DB** (serverless PostgreSQL) with **Prisma 5** ORM.

| Model | Description |
|---|---|
| `User` | Account, profile, auth, push token |
| `Follow` | Follower/following relationships |
| `FollowRequest` | Pending follow requests for private accounts |
| `Post` | Feed posts with multiple media items |
| `PostMedia` | Individual images/videos per post (carousel) |
| `PostLike` | Like toggle on posts |
| `PostComment` | Nested comments on posts |
| `SavedPost` | Bookmarked posts |
| `Reel` | Short-form video with HLS URL + processing status |
| `ReelLike` | Like toggle on reels |
| `ReelView` | View analytics per user per reel |
| `ReelComment` | Nested comments on reels |
| `CommentLike` | Likes on post or reel comments |
| `Story` | 24-hour expiring photo/video story |
| `StoryViewer` | Tracks who viewed each story |
| `Highlight` | Named pinned story collections |
| `HighlightStory` | Join table for stories in highlights |
| `Notification` | In-app notification records |
| `Conversation` | DM or group chat thread |
| `ConversationParticipant` | Members of a conversation |
| `Message` | Individual chat message (text/media/post ref) |
| `Hashtag` | Unique hashtag with post count |
| `ContentHashtag` | Polymorphic join (hashtag ↔ post/reel) |

---

## ⚡ Real-time Features

### WebSocket Chat Gateway
- JWT-authenticated on connect
- Room-based architecture (`conversationId` as room key)
- User presence tracking (`userOnlineStatus` events)
- Typing indicators (ephemeral, no DB write)
- Read receipts (`markAsRead` synced to DB + broadcast)
- In-app notification forwarding (`notificationReceived`)

### Expo Push Notifications
- Registered via `POST /auth/push-token`
- Sent for chat messages when recipient is **not** in the active socket room
- Sent for all social notification types (likes, comments, follows)

### Server-Sent Events (Reels)
- `GET /reels/sse/:id` — persistent SSE stream
- Client subscribes after uploading a reel; receives `reel.ready` event when HLS transcoding completes

---

## 🕐 Background Jobs & Caching

### Redis Stat Batching (Cron: every 30s)
- View counts incremented in **Upstash Redis** on each `POST /reels/:id/view`
- A cron job flushes accumulated Redis counts to Neon DB every 30 seconds
- Prevents hot-row DB contention on viral reels

### Story Expiry Cleanup (Cron)
- Stories have a `expiresAt` timestamp (24h from creation)
- Background job prunes expired stories from the database

### Redis Feed Cache (TTL: 5 minutes)
- Reel feed responses are cached in Redis with a 5-minute TTL
- Cache is invalidated on new reel creation

---

## 🔒 Security & Rate Limiting

- **Helmet** — HTTP security headers (CSP, HSTS, XSS protection)
- **CORS** — configurable origins (strict in production)
- **JWT Auth** — Passport.js JWT strategy, refresh token rotation
- **Rate Limiting** — dual-throttler:
  - Burst: 10 requests / 1 second
  - Sustained: 100 requests / 60 seconds
- **Input Validation** — NestJS `ValidationPipe` with class-validator DTOs, whitelist mode
- **Cloudinary Webhook Verification** — raw body preserved for signature validation
- **UUID Validation** — `ParseUUIDPipe` on all ID params

---

## 🚀 Getting Started

### Prerequisites

- Node.js 20+
- npm 9+
- A [Neon DB](https://neon.tech) database
- An [Upstash Redis](https://upstash.com) database
- A [Cloudinary](https://cloudinary.com) account

### Installation

```bash
# Clone the repository
git clone https://github.com/your-repo/instagram-clone.git
cd instagram-clone/insta-backend

# Install dependencies
npm install

# Set up environment variables (see below)
cp .env.example .env

# Generate Prisma client
npm run prisma:generate

# Push schema to database
npm run prisma:push

# Start in development mode
npm run start:dev
```

### Available Scripts

| Command | Description |
|---|---|
| `npm run start:dev` | Start with hot-reload (development) |
| `npm run build` | Generate Prisma client + compile TypeScript |
| `npm run start:prod` | Start compiled production build |
| `npm run prisma:studio` | Open Prisma Studio (DB browser) |
| `npm run prisma:migrate` | Run migrations in development |
| `npm run prisma:migrate:prod` | Deploy migrations in production |

---

## 🌍 Environment Variables

Create a `.env` file in the `insta-backend` root:

```env
# Server
NODE_ENV=development
PORT=3000
API_PREFIX=api

# Database (Neon DB)
DATABASE_URL=postgresql://user:password@ep-xxx.neon.tech/instagram?sslmode=require

# JWT
JWT_SECRET=your_jwt_secret_here
JWT_EXPIRES_IN=15m
JWT_REFRESH_SECRET=your_refresh_secret_here
JWT_REFRESH_EXPIRES_IN=30d

# Cloudinary
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
CLOUDINARY_WEBHOOK_SECRET=your_webhook_secret

# Upstash Redis
UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=your_upstash_token

# Email (Nodemailer)
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_USER=your@gmail.com
MAIL_PASS=your_app_password
MAIL_FROM=your@gmail.com

# CORS (comma-separated origins for production)
CORS_ORIGINS=https://your-app.com
```

---

## ☁️ Deployment

The backend is deployed as a **serverless function on Vercel** using the Express adapter.

### Vercel Configuration

The `main.ts` detects the `VERCEL` environment variable to export the `bootstrap` handler instead of starting a local HTTP server.

```bash
# Deploy to Vercel
vercel --prod
```

### Production Build

```bash
npm run build
# Output in ./dist
```

**API Base URL:** `https://instagram-clone-backend-web.vercel.app/api`

---

## 📚 API Documentation

Swagger UI is available in **development mode** at:

```
http://localhost:3000/api/docs
```

Features: Bearer JWT auth, request/response examples, live try-out interface.

---

## 📁 Project Structure

```
insta-backend/
├── prisma/
│   └── schema.prisma          # Database schema (all models)
├── src/
│   ├── app.module.ts           # Root module (all imports)
│   ├── main.ts                 # Bootstrap + Swagger + security config
│   ├── health.controller.ts    # Health check endpoint
│   ├── common/
│   │   ├── decorators/         # @CurrentUser, @SkipAuth
│   │   ├── filters/            # Global HTTP exception filter
│   │   ├── guards/             # JwtAuthGuard
│   │   └── interceptors/       # TransformInterceptor
│   └── modules/
│       ├── auth/               # Registration, login, profile, follow system
│       ├── posts/              # Feed posts, likes, comments, save
│       ├── reels/              # Short-form video, HLS, view tracking
│       ├── stories/            # 24h stories + highlights
│       ├── chat/               # WebSocket gateway + DM/group chat
│       ├── notifications/      # In-app + push notifications
│       ├── feed/               # Unified ranked feed
│       ├── hashtags/           # Hashtag extraction + search + trending
│       ├── webhooks/           # Cloudinary upload callbacks
│       ├── jobs/               # Cron: Redis stat flush, story cleanup
│       ├── cache/              # Upstash Redis service
│       ├── cloudinary/         # Cloudinary SDK wrapper
│       ├── database/           # Prisma service
│       └── mail/               # Nodemailer OTP emails
└── package.json
```

---

<p align="center">Made with ❤️ — Instagram Clone Backend</p>
