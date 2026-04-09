# LottoBot — Handover Report for Next Developer
**วันที่:** 9 เมษายน 2569 (2026)
**สถานะ:** ระบบทำงานได้บางส่วน — **Unofficial LINE API ยังไม่สำเร็จ**

---

## 1. ภาพรวมโปรเจค

LottoBot = ระบบส่งผลหวยต่างประเทศ 43 รายการ เข้ากลุ่ม LINE อัตโนมัติ
- **Frontend/Dashboard:** Next.js 14 + Tailwind CSS บน Vercel
- **Database:** Supabase PostgreSQL
- **Unofficial LINE Endpoint:** Express.js บน Render (ยังไม่ทำงาน)
- **Telegram Bot:** ทำงานปกติ (admin log)

---

## 2. สิ่งที่ทำงานได้แล้ว

- ✅ Admin Dashboard (CRUD 43 หวย, ประวัติส่ง, ตั้งค่า)
- ✅ Web Scraper (Cheerio + Axios + CSS selectors จาก DB)
- ✅ Stock Fetcher (Yahoo Finance → เลขหวยหุ้น)
- ✅ Telegram Bot (ส่งผล admin channel)
- ✅ LINE Official Messaging API (fallback — พร้อมใช้แต่มี quota จำกัด)
- ✅ Cron Jobs (scrape, countdown, stats, scheduled, heartbeat)
- ✅ Flow ข้อความ 8 ขั้นตอน (📢→📊→🖼️→⏰20→⏰10→⏰5→🔒→🎯)
- ✅ Smoke Test endpoint (/api/smoke-test)
- ✅ Config Guards (ทุก cron เช็ค config ก่อนทำงาน)
- ✅ Response Validation (ตรวจ Thrift response body)
- ✅ Quotation HTML + Manual v4.0

---

## 3. สิ่งที่ยังไม่สำเร็จ — Unofficial LINE API

### เป้าหมาย
ส่งข้อความ LINE ผ่าน personal account (ไม่ใช่ Official Account) เพื่อไม่มี quota จำกัด

### สถาปัตยกรรมปัจจุบัน

```
Vercel (Next.js) → calls → Render (unofficial-endpoint/server.js) → LINE Thrift API
                                    ↓ (fallback)
                              Official LINE Messaging API
```

### ไฟล์สำคัญ

| ไฟล์ | หน้าที่ |
|------|---------|
| `unofficial-endpoint/server.js` | Render server — custom Thrift encoder + send/health/groups |
| `src/lib/messaging-service.ts` | Vercel side — เรียก Render endpoint |
| `src/app/api/cron/scrape/route.ts` | Cron ดึงผล + ส่ง TG/LINE |
| `src/app/api/cron/countdown/route.ts` | Flow 8 ขั้นตอน |
| `src/lib/config-guard.ts` | Config validation ก่อน cron ทำงาน |
| `src/app/api/smoke-test/route.ts` | Integration smoke test |

### Credentials ลูกค้า (LINE)

- **Email:** onepnk1@gmail.com
- **Password:** Onepnk111
- **สถานะ:** ABUSE_BLOCK (login หลายครั้งเกินไป รอ LINE ปลดอัตโนมัติ)

### Render Environment Variables

| Key | สถานะ |
|-----|-------|
| `LINE_AUTH_TOKEN` | มี แต่ LOGGED_OUT — ต้องสร้างใหม่ |
| `LINE_CHANNEL_ACCESS_TOKEN` | ✅ ใช้ได้ (official fallback) |
| `UNOFFICIAL_AUTH_TOKEN` | ✅ auth guard สำหรับ endpoint |
| `PORT` | 8080 |

### Database (Supabase)

- `line_groups` มี 3 กลุ่ม
- `unofficial_group_id` ถูกตั้งค่าแล้ว (lowercase ของ `line_group_id`)
- **⚠️ ยังไม่ยืนยัน:** unofficial_group_id อาจไม่ตรง — official ID กับ unofficial ID อาจเป็นคนละค่า
- ต้องใช้ Thrift `getGroupIdsJoined` หรือ LINEJS `fetchJoinedChats()` ดึง MID จริง

---

## 4. ปัญหาที่พบ + สิ่งที่ลองแล้ว

### ปัญหาหลัก: TOKEN_CLIENT_LOGGED_OUT

Token ถูก LINE logout ทุกครั้งหลังสร้าง ไม่ว่าจะ:

| วิธี | ผล |
|------|-----|
| Email/password login → ใช้บน Render | LOGGED_OUT (IP data center) |
| Email/password login → ใช้บน PC localhost | LOGGED_OUT |
| QR login → ใช้บน PC localhost | QR scan ไม่สำเร็จ (timeout/error) |
| สร้างบัญชีใหม่ (เบอร์เสมือน) | ABUSE_BLOCK + ระงับสมัคร 60 วัน |
| เปลี่ยน IP (mobile hotspot) | ABUSE_BLOCK (block ที่บัญชี ไม่ใช่ IP) |

### สาเหตุที่วิเคราะห์ได้

1. **ไม่มี session persistence** — แค่ใช้ token ไม่มี polling/heartbeat → LINE เห็นว่า desktop client ไม่ active → logout
2. **ไม่ได้ register certificate** — LINEJS ต้องใช้ FileStorage + certificate เพื่อรักษา session
3. **Multiple login attempts** → ABUSE_BLOCK
4. **QR code delivery ลำบาก** — ลค อยู่คนละที่ ต้องส่ง QR ให้สแกน ซึ่ง timeout เร็ว

### แนวทางที่ยังไม่ได้ลอง

1. **LINEJS BaseClient + FileStorage + createPolling()** — เขียนเสร็จแล้ว (`deno-server.ts`) แต่ QR login ไม่สำเร็จ
2. **ลค นั่งข้างๆ สแกน QR จากจอตรงๆ** — ไม่ได้ลอง (อยู่คนละที่)
3. **รอ ABUSE_BLOCK หมดอายุ** แล้วลอง email/password login อีกครั้ง ด้วย BaseClient + polling
4. **ใช้ residential proxy** บน VPS/Render เพื่อ mask IP
5. **ใช้ LINE Desktop จริง** (ไม่ใช่ LINEJS) + automation tool ส่งข้อความ

---

## 5. Code ที่เตรียมไว้แต่ยังไม่ได้ทดสอบ

### `deno-server.ts` (PC local server ใช้ LINEJS)

อยู่ที่ `C:\Users\ASUS\Desktop\lottobot-server\deno-server.ts`

```typescript
import { BaseClient } from "jsr:@evex/linejs@2.3.7/base";
import { FileStorage } from "jsr:@evex/linejs@2.3.7/storage";

const storage = new FileStorage("./storage.json");
const client = new BaseClient({ device: "DESKTOPWIN", storage });

// QR login + event handlers + polling + HTTP server on :8080
// Endpoints: /health, /send, /groups
```

**วิธีรัน:**
```bash
cd C:\Users\ASUS\Desktop\lottobot-server
C:\Users\ASUS\deno\deno.exe run -A --node-modules-dir=auto deno-server.ts
```

**Dependencies:** `npm:node-bignumber@1.2.2` (ติดตั้งแล้ว)

### login.ts (QR login script)

อยู่ที่ `C:\Users\ASUS\Desktop\login.ts` — ใช้ `loginWithQR` ได้ QR URL ส่งให้ ลค สแกน

---

## 6. แนะนำสำหรับ dev คนถัดไป

### ถ้าจะทำ Unofficial ต่อ

1. **รอ ABUSE_BLOCK หมดอายุ** (1-24 ชม. หรือมากกว่า)
2. **นัด ลค มานั่งข้างๆ** — สแกน QR จากจอตรงๆ แก้ปัญหา timeout
3. **ใช้ BaseClient + FileStorage + createPolling()** ตาม official example
4. **Official example ที่ถูกต้อง:** https://github.com/evex-dev/linejs/blob/main/example/base-client/ping.ts
5. **API ส่งข้อความ:** `client.talk.sendMessage({ to, text, contentType: "NONE", e2ee: false })`
6. **ต้องรัน polling** (`client.createPolling().listenTalkEvents()`) เพื่อรักษา session
7. **ต้อง save token** ผ่าน `client.on("update:authtoken")` + FileStorage
8. **ดึง group MID จริง** ด้วย `client.fetchJoinedChats()` — อย่า lowercase จาก official ID
9. **ห้ามรัน login ซ้ำ** — โดน ABUSE_BLOCK
10. **ห้ามใส่ token ใน data center** (Render/Vercel) — LINE detect IP เปลี่ยน → logout

### ถ้าจะใช้ Official API แทน

- ระบบ fallback **พร้อมทำงานทันที**
- แก้ `messaging-service.ts` ให้ส่งผ่าน official เป็นหลัก
- Pricing: ฿0 (200 msg/เดือน), ฿750 (3,000 msg/เดือน)

---

## 7. Repository & Branches

- **Repo:** github.com/panatch1992-cell/lottobot
- **Branch:** `claude/develop-messaging-api-UID1X`
- **Production:** `main` (Vercel auto-deploy)
- **Render:** deploy จาก `main`

### Recent PRs

- #146: Fix toType + group MID fetch
- #148: sync-groups endpoint
- #150-#156: Various fixes (cron, auth, smoke test)

---

## 8. URLs

| Service | URL |
|---------|-----|
| Vercel Dashboard | https://lottobot-chi.vercel.app |
| Render Endpoint | https://lottobot-unofficial-endpoint.onrender.com |
| Smoke Test | https://lottobot-chi.vercel.app/api/smoke-test |
| Supabase | https://xsddkvriqitdwnzosihj.supabase.co |

---

## 9. ข้อควรระวัง

1. **ห้าม push ตรงไป `main`** — ใช้ `claude/*` branch → PR → merge
2. **ห้าม hardcode API keys** — ใช้ .env.local / Render env / Supabase settings
3. **ห้ามลบไฟล์** โดยไม่ถามก่อน
4. **UI ภาษาไทย** / Commit ภาษาอังกฤษ
5. **CSS selectors เก็บใน DB** — ห้าม hardcode
6. **ลค:** คุณตอง (ผ่าน LINE) — อย่ารบกวนเรื่อง PIN/QR บ่อย
