# 🛠️ Developer Guide — LottoBot

> **สำหรับ:** Developer ที่ต้อง maintain / debug / ขยายระบบ
> **เวอร์ชั่น:** 1.0

---

## 📋 สารบัญ

1. [Architecture Overview](#1-architecture-overview)
2. [Tech Stack](#2-tech-stack)
3. [Codebase Structure](#3-codebase-structure)
4. [Deployment Architecture](#4-deployment-architecture)
5. [Data Flow](#5-data-flow)
6. [Local Development](#6-local-development)
7. [Deployment Procedures](#7-deployment-procedures)
8. [Capacity & Scaling](#8-capacity--scaling)
9. [Troubleshooting](#9-troubleshooting)
10. [Common Tasks](#10-common-tasks)
11. [Security](#11-security)

---

## 1. Architecture Overview

### High-Level Diagram

```
┌────────────────────────────────────────────────────────────┐
│                       INTERNET                              │
└────────────────────────────────────────────────────────────┘
        │                      │                       │
        ▼                      ▼                       ▼
┌──────────────┐      ┌──────────────┐        ┌──────────────┐
│   Vercel     │      │ VPS Vultr    │        │ LINE Server  │
│ (Next.js)    │◄────►│ (Singapore)  │◄──────►│ (ga2.line)   │
│              │      │              │        │              │
│ - Dashboard  │      │ - server.js  │        │ - Thrift API │
│ - API Routes │      │ - linejs     │        │ - Webhook    │
│ - Cron Jobs  │      │ - FileStorage│        │ - Reply API  │
└──────────────┘      └──────────────┘        └──────────────┘
        │                                              │
        ▼                                              ▼
┌──────────────┐                            ┌──────────────┐
│  Supabase    │                            │  LINE OA     │
│ (PostgreSQL) │                            │ (LottoBot)   │
└──────────────┘                            └──────────────┘
```

### Component Responsibilities

| Component | Host | Role |
|-----------|------|------|
| **Next.js App** | Vercel | Dashboard UI, API routes, cron triggers |
| **Unofficial Endpoint** | VPS Vultr | LINE Thrift client (send "." via linejs) |
| **Supabase** | Supabase Cloud | Database (results, groups, settings, logs) |
| **LINE OA** | LINE Platform | Receive "." via webhook → Reply lottery result (free) |
| **LINE Thrift API** | gd2/ga2.line.naver.jp | LINE's internal API for personal account sends |

---

## 2. Tech Stack

### Vercel (Frontend + API)
- **Framework:** Next.js 14.2 (App Router)
- **Language:** TypeScript 5
- **Styling:** Tailwind CSS 3
- **Database Client:** @supabase/supabase-js
- **Runtime:** Node.js 20

### VPS Vultr (Backend)
- **OS:** Ubuntu 22.04
- **Runtime:** Node.js 20
- **Process Manager:** PM2 5
- **Framework:** Express 4
- **LINE Library:** @evex/linejs (via `@jsr/evex__linejs` npm proxy)
- **Session Storage:** linejs FileStorage → disk

### Database
- **Supabase PostgreSQL** (free tier)
- Tables: `lotteries`, `results`, `line_groups`, `send_logs`, `bot_settings`, `scrape_sources`

### External Services
- **Telegram Bot API** — Admin log channel
- **LINE Messaging API** — OA webhook receive + Reply
- **LINE Thrift API** — Send "." via personal account
- **Yahoo Finance API** — Stock index for lottery calculations

---

## 3. Codebase Structure

```
lottobot/
├── src/
│   ├── app/
│   │   ├── (admin)/           # Dashboard pages
│   │   │   ├── dashboard/     # Overview + stats
│   │   │   ├── results/       # Manual result entry
│   │   │   ├── history/       # Send logs history
│   │   │   └── settings/      # Bot settings + PIN login
│   │   ├── api/
│   │   │   ├── cron/
│   │   │   │   ├── scrape/    # Main cron (every 1 min) — scrapes + sends
│   │   │   │   ├── countdown/ # Countdown notifications
│   │   │   │   └── stats/     # Historical stats
│   │   │   ├── line/
│   │   │   │   ├── webhook/   # LINE OA webhook receiver
│   │   │   │   ├── trigger/   # Send "." to groups
│   │   │   │   └── login/     # PIN login proxy
│   │   │   └── results/       # Manual result CRUD
│   │   └── layout.tsx
│   ├── lib/
│   │   ├── messaging-service.ts  # Proxy to VPS unofficial endpoint
│   │   ├── line-reply.ts         # LINE Reply API helper
│   │   ├── scraper.ts            # Web scraping
│   │   ├── stock-fetcher.ts      # Yahoo Finance
│   │   ├── formatter.ts          # Message formatting
│   │   └── supabase.ts           # DB client + getSettings()
│   └── types/index.ts
│
├── unofficial-endpoint/          # VPS Node.js server
│   ├── server.js                 # Main server (Express + linejs)
│   ├── package.json              # deps: express, @evex/linejs, dotenv
│   ├── ecosystem.config.cjs      # PM2 config
│   ├── .env                      # Tokens (NOT committed)
│   └── .npmrc                    # JSR registry config
│
├── scripts/
│   └── pin-login.ts              # Standalone Deno script for PIN login
│
├── docs/
│   ├── USER_MANUAL.md            # For non-tech users
│   └── DEV_GUIDE.md              # This file
│
├── CLAUDE.md                     # Project instructions for AI
└── schema.sql                    # DB schema
```

---

## 4. Deployment Architecture

### Current Production Setup

```
┌──────────────────────────────────────────────────┐
│                    VERCEL                         │
│  lottobot-chi.vercel.app                          │
│  - Auto-deploys on main branch push               │
│  - Cron jobs via vercel.json                      │
│  - Env vars: SUPABASE_URL, SUPABASE_KEY, ...      │
└──────────────────────────────────────────────────┘
               │
               │ HTTPS (POST /send)
               ▼
┌──────────────────────────────────────────────────┐
│             VPS VULTR SINGAPORE                   │
│  45.77.240.100:8080                               │
│  - Ubuntu 22.04, 1GB RAM                          │
│  - Node 20, PM2                                   │
│  - /opt/lottobot/unofficial-endpoint/             │
│  - Env in .env file                               │
│  - Session at /opt/lottobot/sessions/             │
└──────────────────────────────────────────────────┘
               │
               │ Thrift (POST /S4)
               ▼
┌──────────────────────────────────────────────────┐
│         LINE INTERNAL API                         │
│  gd2.line.naver.jp / ga2.line.naver.jp            │
└──────────────────────────────────────────────────┘
```

### Why VPS instead of Render?

- **Render free tier spins down after 15 min inactivity** → linejs session lost → V3_TOKEN_CLIENT_LOGGED_OUT
- **VPS is always-on** → session persists + FileStorage survives restart
- **VPS is cheaper than Render paid tier** ($6 vs $7)

---

## 5. Data Flow

### 5.1 Automatic Lottery Send Flow

```
1. Vercel Cron (every 1 min)
   GET /api/cron/scrape
      │
      ├─ Check lotteries in time window
      │
      ├─ For each lottery:
      │  ├─ Scrape result (CSS selectors / stock API / browser)
      │  ├─ Save to DB (results table)
      │  ├─ Send to Telegram (admin log)
      │  └─ If line_send_mode = 'trigger':
      │     │
      │     └─ POST /api/line/trigger
      │        │
      │        └─ For each active group (with 500-1000ms delay):
      │           │
      │           └─ sendText(mid, ".", officialId)
      │              │
      │              └─ POST VPS /send
      │                 │
      │                 └─ Anti-ban checks:
      │                    - Circuit breaker
      │                    - Rate limits (day/hour/min)
      │                    - Human-like delay (3-8s)
      │                 │
      │                 └─ client.base.talk.sendMessage({ to, text: "." })
      │                    │
      │                    └─ LINE Thrift API → group gets "."
      │
      └─ Insert send_logs (trigger_send)

2. LINE OA receives "." via webhook
   POST https://lottobot-chi.vercel.app/api/line/webhook
      │
      ├─ Verify signature (HMAC-SHA256 with channel secret)
      ├─ Dedup check (in-memory event ID)
      │
      ├─ If event.message.text === "." && source.type === "group":
      │  │
      │  ├─ Query pending results (not yet replied today)
      │  ├─ Format message(s) via formatter.ts
      │  │
      │  └─ POST LINE Reply API (FREE!)
      │     │
      │     └─ LINE OA replies in group with formatted result
      │
      └─ Insert send_logs (trigger_reply)
```

### 5.2 Manual Result Flow

```
Admin opens /results page
   │
   ├─ Enter numbers (top/bottom/full)
   ├─ POST /api/results
   │
   ├─ Upsert results table
   ├─ Send Telegram (admin log)
   │
   └─ If line_send_mode = 'trigger':
      └─ POST /api/line/trigger
         (same as automatic flow)
```

### 5.3 Login Flow (PIN)

```
Settings page: User clicks "PIN Login"
   │
   ├─ POST /api/line/login (email, password)
   │
   ├─ Vercel proxies to VPS:
   │  POST http://45.77.240.100:8080/login
   │
   ├─ VPS calls linejs loginWithPassword:
   │  │
   │  ├─ linejs sends auth request to LINE
   │  ├─ LINE returns PIN code
   │  ├─ pincallback → returns PIN to Vercel
   │  └─ Vercel displays PIN to user
   │
   ├─ User opens LINE app on mobile → verifies PIN
   │
   ├─ VPS's loginWithPassword resumes:
   │  ├─ Client instance created
   │  ├─ Token saved to LINE_AUTH_TOKEN (memory + file)
   │  └─ Session saved via FileStorage
   │
   └─ Status: clientReady = true
```

---

## 6. Local Development

### 6.1 Next.js Dashboard

```bash
cd lottobot
npm install
cp .env.example .env.local
# Fill in Supabase + Telegram tokens

npm run dev
# http://localhost:3000
```

### 6.2 VPS Server Local Testing

```bash
cd lottobot/unofficial-endpoint
npm install
cp .env.example .env
# Fill in tokens

node server.js
# http://localhost:8080/health
```

### 6.3 Testing Endpoints

```bash
# Health check
curl http://localhost:8080/health

# Send test message (with auth)
curl -X POST http://localhost:8080/debug-send \
  -H "Content-Type: application/json" \
  -d '{"to":"cxxxxxxx","text":"test"}'

# Get groups list
curl -H "Authorization: Bearer $UNOFFICIAL_AUTH_TOKEN" \
  http://localhost:8080/groups
```

---

## 7. Deployment Procedures

### 7.1 Deploy Next.js (Vercel)

Automatic on `git push origin main`. Check deployment at:
https://vercel.com/panat-chueprasertsaks-projects/lottobot

**Branches:**
- `main` → production
- `claude/*` → feature branches (PR → main)

### 7.2 Deploy VPS Server

```bash
# SSH to VPS
ssh root@45.77.240.100

# Pull latest code
cd /opt/lottobot
git pull origin main

# Install deps (if changed)
cd unofficial-endpoint
npm install

# Restart PM2
pm2 restart lottobot --update-env

# Verify
curl http://localhost:8080/health
pm2 logs lottobot --lines 20 --nostream
```

### 7.3 Update Environment Variables

**Vercel:** Project Settings → Environment Variables → Update → Redeploy

**VPS:**
```bash
nano /opt/lottobot/unofficial-endpoint/.env
# Edit values
pm2 restart lottobot --update-env
```

### 7.4 Database Migrations

```bash
# Connect to Supabase SQL Editor
# Run migration SQL files from migrations/ folder
```

---

## 8. Capacity & Scaling

### 8.1 Current Capacity (1 bot account)

| Metric | Value |
|--------|-------|
| **Max groups per bot** | 10-15 (recommended), 20 (max) |
| **Max messages/day per bot** | 500 (safe), 1000 (risky) |
| **Max subscribers per group** | 500 (LINE limit) |
| **Theoretical max users** | 10 groups × 50 members = 500 users |
| **Safe daily sends** | ~430 messages |

### 8.2 Anti-Ban Configuration

In `unofficial-endpoint/server.js` or via env vars:

```javascript
const ANTI_BAN = {
  MAX_MSG_PER_DAY: 500,        // LINE flags at ~1000+
  MAX_MSG_PER_HOUR: 50,        // Burst protection
  MAX_MSG_PER_MINUTE: 5,       // Per-minute limit
  MIN_DELAY_MS: 3000,          // Min 3 sec between sends
  MAX_DELAY_MS: 8000,          // Max 8 sec
  CIRCUIT_BREAKER_THRESHOLD: 5, // Open after 5 failures
  CIRCUIT_BREAKER_COOLDOWN_MS: 300000, // 5 min cooldown
}
```

**Tune via env:** `MAX_MSG_PER_DAY=1000 pm2 restart lottobot --update-env`

### 8.3 Scaling Strategies

#### Vertical Scaling (1 bot, more groups)
- ⚠️ Not recommended > 20 groups per bot
- Risk of LINE ban increases exponentially

#### Horizontal Scaling (multiple bots)

**Option A: Multiple bot accounts on 1 VPS**
1. Run multiple `server.js` instances on different ports
2. Each with its own `LINE_AUTH_TOKEN` env
3. Load balance groups across bots

```bash
# Bot 1: port 8080
pm2 start server.js --name bot1 --env-var PORT=8080 LINE_AUTH_TOKEN=...

# Bot 2: port 8081
pm2 start server.js --name bot2 --env-var PORT=8081 LINE_AUTH_TOKEN=...
```

**Option B: Separate VPS per bot**
- Each VPS runs 1 bot account
- Most isolated, safest
- Cost scales linearly

**Option C: Add groups to LINE OA instead**
- LINE OA Messaging API Reply is FREE (no quota)
- Only limitation is LINE OA friend count (no hard limit)
- But requires LINE OA subscription for push (which is paid)

### 8.4 Scaling Math

**Target: 100 groups, 500 users/group = 50K users**

- 100 groups × 43 lotteries/day = 4,300 sends/day
- Safe per bot: 500 sends/day
- **Need: ~10 bots minimum** (with buffer)

**Infrastructure cost:**
- 10 VPS × $6 = $60/month
- Or: 1 VPS with 10 bot instances = $6/month (but shared IP = higher ban risk)

---

## 9. Troubleshooting

### 9.1 Common Issues

#### `clientReady: false` in /health
**Cause:** linejs session expired or init failed
**Fix:** Customer does PIN Login via Settings page

#### `V3_TOKEN_CLIENT_LOGGED_OUT` in logs
**Cause:** LINE Desktop was opened with same account, or session invalidated
**Fix:**
1. Ensure LINE Desktop is closed
2. PIN Login again
3. Check for suspicious activity

#### `ABUSE_BLOCK` error
**Cause:** LINE detected bot-like behavior
**Fix:**
1. Increase `MIN_DELAY_MS` to 5000+
2. Reduce groups per bot
3. Wait 24h before retrying
4. Consider new bot account

#### `HTTP 429` (Official API)
**Cause:** LINE Official API monthly push limit hit
**Fix:**
- Don't rely on Official Push (use Trigger mode)
- Monthly quota resets on 1st of each month
- Clear flag in DB: `UPDATE bot_settings SET value='' WHERE key='line_monthly_limit_month'`

#### Circuit breaker open
**Cause:** 5 consecutive send failures
**Fix:**
- Wait 5 min for auto-cooldown
- Or manually reset:
```bash
curl -X POST http://45.77.240.100:8080/anti-ban/reset \
  -H "Authorization: Bearer $UNOFFICIAL_AUTH_TOKEN"
```

### 9.2 Debugging Tools

#### Check VPS logs
```bash
pm2 logs lottobot --lines 100 --nostream
pm2 logs lottobot --err --lines 50  # errors only
```

#### Check /health endpoint (exposes all state)
```bash
curl http://45.77.240.100:8080/health | jq
```

Response includes:
- `clientReady` - linejs ready
- `tokenDebug` - JWT decoded
- `antiBan.counters` - current rate limit usage
- `antiBan.circuitBreaker` - breaker state

#### Check Vercel logs
Go to Vercel Dashboard → Project → Functions → Select function → Logs

#### Check Supabase
```sql
-- Recent send logs
SELECT created_at, msg_type, status, error_message
FROM send_logs
WHERE created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;

-- Active groups
SELECT id, name, is_active, line_group_id, unofficial_group_id
FROM line_groups;

-- Settings
SELECT key, value FROM bot_settings ORDER BY key;
```

---

## 10. Common Tasks

### 10.1 Add New Lottery

```sql
INSERT INTO lotteries (name, flag, country, result_time, close_time, ...)
VALUES ('หวยใหม่', '🇹🇭', 'ไทย', '15:00', '14:45', ...);
```

Or via Dashboard: `/lotteries` → Add

### 10.2 Clear Old Send Logs

```sql
DELETE FROM send_logs WHERE created_at < NOW() - INTERVAL '30 days';
```

### 10.3 Rotate LINE Bot Account

1. Sign up new LINE account with new phone number
2. Set email + password in LINE
3. Invite new account to groups (also keep @LottoBot in groups)
4. Go to Settings → PIN Login with new credentials
5. Old bot account can be disabled/removed

### 10.4 Backup Session Token

```bash
# On VPS
cat /opt/lottobot/sessions/line-auth-token.txt > ~/token-backup-$(date +%s).txt
```

### 10.5 Change Anti-Ban Limits

Edit `/opt/lottobot/unofficial-endpoint/.env`:
```
MAX_MSG_PER_DAY=300
MAX_MSG_PER_HOUR=30
MIN_DELAY_MS=5000
MAX_DELAY_MS=10000
```

```bash
pm2 restart lottobot --update-env
```

### 10.6 Deploy Hotfix

```bash
# Local
git checkout -b hotfix/urgent-fix
# make changes
git commit -am "Hotfix: ..."
git push origin hotfix/urgent-fix
# Create PR → merge → Vercel auto-deploys

# VPS
ssh root@45.77.240.100
cd /opt/lottobot
git pull origin main
cd unofficial-endpoint
npm install
pm2 restart lottobot
```

---

## 11. Security

### 11.1 Secrets Management

**Vercel:**
- Environment variables in project settings
- Never commit to git

**VPS:**
- `.env` file (chmod 600)
- Token in `/opt/lottobot/sessions/line-auth-token.txt` (chmod 600)
- SSH key auth only (disable password after setup)

**Rotation schedule:**
- VPS root password: every 3 months
- Supabase service key: if leaked only
- LINE bot account password: if compromised

### 11.2 Known Security Considerations

1. **Settings API has no auth** — add Supabase auth or CRON_SECRET
2. **Webhook signature verification** — MUST be enabled in production
3. **UNOFFICIAL_AUTH_TOKEN** protects VPS `/send` endpoint from random access
4. **LINE_AUTH_TOKEN** is session-based, expires every 7 days (auto-refreshes)

### 11.3 Incident Response

If token leaked:
1. Immediately revoke via Settings → Reset
2. Change LINE account password
3. Force new PIN login
4. Check LINE account for suspicious activity
5. Consider creating new account

If VPS compromised:
1. Stop PM2: `pm2 stop lottobot`
2. Investigate logs: `/var/log/auth.log`
3. Change root password
4. Rotate all tokens
5. Consider rebuild from scratch

---

## 📞 Contacts

- **Repository:** https://github.com/panatch1992-cell/lottobot
- **Dashboard:** https://lottobot-chi.vercel.app
- **VPS:** 45.77.240.100 (Vultr Singapore)
- **Database:** Supabase project

---

**Last Updated:** 2026-04-10
**Version:** v3.0 (VPS + linejs + Anti-ban + FileStorage)
