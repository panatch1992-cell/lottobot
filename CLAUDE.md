# LottoBot — ระบบส่งผลหวยต่างประเทศอัตโนมัติ

> งานลูกค้า: คุณตอง (ผ่าน Fastwork)
> สร้างโดย: Claude Code + panatch1992-cell

---

## 1. Project Overview

**สิ่งที่ระบบทำ:**
- Bot ดึงผลหวยต่างประเทศ 43 รายการ (ลาว, เวียดนาม, จีน, ญี่ปุ่น, ฮ่องกง, เกาหลี, ฯลฯ) จากเว็บต้นทางอัตโนมัติ
- ส่งผลเข้า Telegram Channel → n8n ส่งต่อเข้า LINE กลุ่มอัตโนมัติ (ไม่เสี่ยงโดนแบน)
- แจ้งเตือนนับถอยหลังก่อนปิดรับ (Countdown)
- ส่งสถิติย้อนหลัง 10 งวดหลังออกผล
- Admin Dashboard จัดการหวย / ดูประวัติ / ตั้งค่า

**Flow การทำงาน (ปัจจุบัน):**
```
🤖 ดึงผลอัตโนมัติ (Cron scrape ทุกนาที)
  หรือ
📝 Admin กรอกผลหวย (หน้าเว็บ)
  ↓ (บันทึก DB)
✈️ Telegram Bot → Admin Channel (ดู log — แยก 🤖auto/👤manual)
  ↓ (ส่งพร้อมกัน)
💬 LINE กลุ่ม (ผ่าน LINE Messaging API + รูปตัวเลขการ์ตูน)
```

**หมายเหตุ:**
- LINE Notify ปิดบริการ มี.ค. 2025 → เปลี่ยนเป็น LINE Messaging API
- ไม่ใช้ n8n แล้ว → ส่ง LINE ตรงจาก API route
- Bot เข้ากลุ่ม LINE → webhook จับ group ID อัตโนมัติ
- ส่งผลพร้อมรูปตัวเลขการ์ตูน (ImageResponse from next/og)

**กลุ่มผู้ใช้:**
- **User (สมาชิกกลุ่ม LINE)** — รับผลหวย + Countdown + สถิติ ในกลุ่ม LINE
- **Admin (เจ้าของ Bot)** — จัดการหวย ดูประวัติ ตั้งค่า ผ่าน Web Dashboard + ดู log ผ่าน Telegram

**ภาษาใน UI:** ไทย

---

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend (Dashboard) | Next.js 14+ (App Router) + Tailwind CSS |
| Backend (Bot Engine) | Next.js API Routes + node-cron |
| Database | Supabase PostgreSQL |
| Auth | Supabase Auth (Admin login) |
| Telegram | Telegram Bot API (ส่งผล + Admin log) |
| LINE | LINE Messaging API (push message + webhook) |
| Image Gen | next/og ImageResponse (ตัวเลขการ์ตูน) |
| Web Scraping | Cheerio + Axios (server-side) |
| Deployment | Vercel |
| Font | IBM Plex Sans Thai + Space Grotesk |

---

## 3. Key Files

```
├── CLAUDE.md                     ← ไฟล์นี้
├── schema.sql                    ← Database schema + 43 หวย seed data
├── index.html                    ← Demo mockup (TG→LINE flow)
├── .env.local                    ← Keys (Supabase + Telegram + LINE)
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx              ← Redirect → /dashboard
│   │   ├── (auth)/login/
│   │   ├── (admin)/
│   │   │   ├── dashboard/        ← ภาพรวม + สถานะ + preview ข้อความ
│   │   │   ├── results/          ← กรอกผลมือ (manual entry)
│   │   │   ├── scraping/         ← ตั้งค่าดึงผลอัตโนมัติ (URL + CSS selectors)
│   │   │   ├── lotteries/        ← CRUD 43 หวย
│   │   │   ├── history/          ← ประวัติส่ง (TG + LINE) + badge auto/manual
│   │   │   └── settings/         ← Telegram / LINE / Scraping settings
│   │   └── api/
│   │       ├── cron/
│   │       │   ├── scrape/       ← ดึงผลหวย (auto, retry, configurable window)
│   │       │   ├── countdown/    ← ส่ง Countdown
│   │       │   └── stats/        ← ส่งสถิติ
│   │       ├── scrape-sources/   ← CRUD scrape sources + test + manual trigger
│   │       ├── telegram/
│   │       │   ├── send/         ← ส่งข้อความเข้า TG Channel
│   │       │   └── webhook/      ← รับ webhook จาก TG (ถ้าต้องการ)
│   │       └── line/
│   │           └── notify/       ← ส่ง LINE Notify (fallback ถ้า n8n ล่ม)
│   ├── components/
│   │   ├── ui/
│   │   ├── layout/               ← TopBar, BottomNav
│   │   └── features/
│   │       ├── FlowDiagram       ← แสดง flow เว็บ→TG→n8n→LINE
│   │       ├── LottoStatusCard
│   │       ├── TelegramPreview   ← Preview ข้อความ TG (dark theme)
│   │       ├── LinePreview       ← Preview ข้อความ LINE
│   │       └── SendHistory
│   ├── lib/
│   │   ├── supabase.ts
│   │   ├── telegram.ts           ← Telegram Bot API helper
│   │   ├── line-notify.ts        ← LINE Notify helper (fallback)
│   │   ├── scraper.ts            ← Web scraping engine
│   │   ├── formatter.ts          ← จัดรูปแบบข้อความ (TG HTML + LINE)
│   │   ├── scheduler.ts          ← Cron scheduler
│   │   └── utils.ts
│   └── types/
│       └── index.ts
└── public/
```

---

## 4. Database

**Provider:** Supabase PostgreSQL

**ตาราง (6 ตาราง):**
- `lotteries` — 43 รายการหวย (ชื่อ, ธง, เวลาออก, เวลาปิด, URL, format, countdown)
- `results` — ผลหวยแต่ละงวด (เลขบน/ล่าง/เต็ม, วันที่)
- `line_groups` — กลุ่ม LINE ปลายทาง (ชื่อ, LINE Notify Token, on/off)
- `send_logs` — ประวัติส่งทุก channel (telegram/line, result/countdown/stats, สำเร็จ/ล้มเหลว)
- `scrape_sources` — แหล่งดึงผล (URL หลัก/สำรอง, CSS selectors ใน JSONB)
- `bot_settings` — ค่า Telegram Bot Token, n8n URL, LINE Token, interval

Schema อยู่ที่: `schema.sql` (รวม seed data 43 หวยแล้ว)

---

## 5. Current Status

- [x] Supabase project + run schema.sql (43 หวย seed)
- [x] Admin auth (login)
- [x] Dashboard (flow diagram + stat cards + สถานะวันนี้ + scrape status)
- [x] Lotteries CRUD (43 หวย + เพิ่ม/แก้/ลบ/toggle)
- [x] Web Scraper engine (Cheerio + Axios + fallback + retry)
- [x] ดึงผลอัตโนมัติ — Admin ตั้งค่า URL + CSS selectors ต่อหวย, cron ดึงทุกนาที, retry 3 ครั้ง
- [x] Telegram Bot — ส่งผลเข้า Admin Channel (HTML format, แยก auto/manual)
- [x] LINE Messaging API — ส่งผลเข้ากลุ่ม LINE ตรง (พร้อมรูปตัวเลขการ์ตูน)
- [x] Countdown — ส่งแจ้งเตือนก่อนปิดรับ (TG + LINE)
- [x] สถิติ 10 งวด — ส่งหลังออกผล (TG + LINE)
- [x] History page (ประวัติส่ง + ค้นหาตามวัน + badge auto/manual)
- [x] Settings page (Telegram / LINE / Scraping settings)
- [x] Cron jobs + Deploy Vercel

---

## 6. Feature Requirements

### 6.1 Admin Dashboard
- **ดู demo หน้า "หน้าหลัก"**
- Flow diagram: เว็บ → TG Bot → n8n → LINE กลุ่ม
- Stat cards (3 ช่อง): หวยทั้งหมด / กลุ่ม LINE / ส่งวันนี้
- สถานะวันนี้: list หวยที่ออกวันนี้ + status (✓ TG→LINE ส่งแล้ว / ● กำลังส่ง / ⏳ รอ)
- ตัวอย่างข้อความ LINE (preview จริง) + Telegram Admin log

### 6.2 Lotteries CRUD (43 รายการ)
- List: ธง + ชื่อหวย + เวลาออก + toggle เปิด/ปิด
- Form: ชื่อ, ธง/ประเทศ, เวลาออก, เวลาปิด, URL ดึงผล, format, countdown นาที, สถิติ on/off
- Seed 43 หวยตามที่ลูกค้าให้ (schema.sql มีแล้ว)

### 6.3 Web Scraper
- Cheerio + Axios ดึงผลจากเว็บ
- เริ่มดึงทุก 30 วินาที ก่อนเวลาออก (configurable)
- Fallback: แหล่งหลักล่ม → ใช้แหล่งสำรอง
- ได้ผล → บันทึก results → trigger ส่ง Telegram

### 6.4 Telegram Bot — ส่งผลเข้า Admin Channel
- ใช้ Telegram Bot API → sendMessage (HTML parse mode)
- Format:
```
🇯🇵 นิเคอิ(บ่าย) VIP
งวด 20 มี.ค. 69 · ดึงจาก nikkeivipstock.com
⬆️ บน : 0 3 4
⬇️ ล่าง : 9 7
──────
✓ ส่ง LINE แล้ว 5 กลุ่ม (0.8 วิ)
```
- Admin ดูได้ทันทีใน Telegram channel

### 6.5 n8n Bridge — TG → LINE
- n8n workflow: Telegram Trigger → Extract ข้อความ → LINE Notify (ส่งทุกกลุ่ม)
- n8n setup เป็นส่วนที่ dev ตั้งค่าให้ (ไม่ใช่ code ใน repo)
- ถ้า n8n ล่ม → Dashboard มี fallback ส่ง LINE Notify ตรงจาก API route

### 6.6 LINE กลุ่ม — ข้อความที่ User เห็น
- รูปแบบ (ผ่าน LINE Notify):
```
🇯🇵🇯🇵 นิเคอิ(บ่าย) VIP 🇯🇵🇯🇵
งวดวันที่ 20 มี.ค. 69
⬆️ บน : 0 3 4
⬇️ ล่าง : 9 7
```
- Countdown:
```
🇱🇦🇱🇦 ลาว HD 🇱🇦🇱🇦
⏰ 10 นาทีสุดท้าย ❗❗
ส่งโพย ➕ สลิปโอน
🏠 ส่งหลังบ้านได้เลยนะครับ
```
- สถิติ:
```
🇱🇦 สถิติหวยลาว HD 🇱🇦
6 มี.ค. 69 🇱🇦 726-94
5 มี.ค. 69 🇱🇦 286-45
...
```

### 6.7 History
- **ดู demo หน้า "ประวัติ"**
- ค้นหาตามวันที่
- List: ธง + ชื่อ + เวลา + TG status + LINE status + กลุ่ม + เวลาที่ใช้
- สถิติวันนี้: ส่งสำเร็จ TG xxx → LINE xxx (y กลุ่ม)

### 6.8 Settings
- **ดู demo หน้า "ตั้งค่า"**
- Telegram Bot: username + token + Admin Channel ID + สถานะ
- n8n: Instance URL + Workflow status
- LINE กลุ่ม: list กลุ่ม + Notify Token + toggle แต่ละกลุ่ม
- Scraping: interval + fallback on/off
- ข้อความ: HTML format, สถิติ on/off, Countdown on/off

---

## 7. Development Rules

1. **ภาษา UI** — ไทย (Dashboard ทั้งหมดเป็นภาษาไทย)
2. **Commit** — เขียน commit message ภาษาอังกฤษ
3. **Branch** — ทำงานบน `claude/*` เท่านั้น อย่า push ตรงไป main
4. **ห้ามลบ** — อย่าลบไฟล์เดิมโดยไม่ถามก่อน
5. **Security** — อย่า hardcode API keys ใช้ `.env.local`
6. **Style** — Tailwind CSS, โทนสี gold=#c9a84c, success=#22a867, warn=#e89b1c, danger=#dc3545, bg=#f5f3ee
7. **Mobile First** — Dashboard ใช้ได้ทั้งมือถือ + desktop
8. **Cron** — Vercel Cron Jobs (vercel.json) หรือ node-cron
9. **Telegram HTML** — ใช้ HTML parse mode (bold, italic, code) ไม่ใช่ Markdown
10. **CSS selectors เก็บใน DB** — ห้าม hardcode selectors ใน code

---

## 8. Architecture & Patterns

### System Architecture
```
┌────────────────────────────────────────────────────┐
│  Vercel (Next.js)                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐ │
│  │ Dashboard │  │ API/Cron │  │ Scraper Engine   │ │
│  │ (Admin)   │  │ /api/*   │  │ Cheerio + Axios  │ │
│  └─────┬─────┘  └─────┬────┘  └────────┬─────────┘ │
│        │              │                │            │
│        └──────────────┼────────────────┘            │
│                       │                             │
│               ┌───────┴───────┐                     │
│               │   Supabase    │                     │
│               │  (PostgreSQL) │                     │
│               └───────────────┘                     │
└────────────────────────────────────────────────────┘
        │                           │
   ┌────┴────────┐            ┌────┴──────┐
   │ เว็บผลหวย   │            │ Telegram  │
   │ (Scraping)  │            │ Bot API   │
   └─────────────┘            └─────┬─────┘
                                    │
                              ┌─────┴─────┐
                              │   n8n     │
                              │ (bridge)  │
                              └─────┬─────┘
                                    │
                              ┌─────┴─────┐
                              │ LINE      │
                              │ Notify    │
                              │ (กลุ่ม)   │
                              └───────────┘
```

### Cron Flow (ทุกรอบหวย)
```
1. Cron ตรวจเวลา → หวยไหนใกล้ออก?
2. countdown_minutes > 0 → ส่ง Countdown เข้า TG → n8n → LINE
3. เริ่ม scrape ทุก 30 วินาที
4. ได้ผล → บันทึก results → ส่ง TG (Admin log + ข้อความ)
5. n8n ตรวจจับ TG → ส่งต่อ LINE ทุกกลุ่ม
6. ส่งสถิติ 10 งวด (ถ้า send_stats=true)
7. บันทึก send_logs ทุก step (TG + LINE แยก)
```

### Telegram Message Builder
```typescript
// src/lib/telegram.ts
const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`

export async function sendToTelegram(chatId: string, html: string) {
  return fetch(`${TELEGRAM_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: html,
      parse_mode: 'HTML',
    }),
  })
}
```

### Formatter
```typescript
// src/lib/formatter.ts
export function formatResult(lottery: Lottery, result: Result) {
  // For Telegram (HTML):
  const tg = [
    `${lottery.flag} <b>${lottery.name}</b>`,
    `งวด ${formatThaiDate(result.draw_date)}`,
    `⬆️ บน : <code>${spaced(result.top_number)}</code>`,
    `⬇️ ล่าง : <code>${spaced(result.bottom_number)}</code>`,
  ].join('\n')

  // For LINE Notify (plain text):
  const line = [
    `${lottery.flag}${lottery.flag} ${lottery.name} ${lottery.flag}${lottery.flag}`,
    `งวดวันที่ ${formatThaiDate(result.draw_date)}`,
    `⬆️ บน : ${spaced(result.top_number)}`,
    `⬇️ ล่าง : ${spaced(result.bottom_number)}`,
  ].join('\n')

  return { tg, line }
}

function spaced(num: string) {
  return num.split('').join(' ')  // "034" → "0 3 4"
}
```

---

## 9. Delivery & Business Context

### Production URL
- **URL:** (รอ deploy — Vercel)
- **Demo:** https://sparkling-daifuku-073308.netlify.app/

### ลูกค้า
- **ชื่อ:** คุณตอง
- **ช่องทาง:** Fastwork

### ใบเสนอราคา
- **เลขที่:** MF-2026011
- **ราคาเดิม:** ฿11,000
- **เพิ่ม:** ระบบเชื่อม Telegram → n8n → LINE (฿2,000)
- **ราคารวม:** ฿13,000

### ขอบเขตงาน (7 รายการ)
1. LINE Bot — ส่งผลหวยอัตโนมัติ 43 รายการ (฿3,000)
2. ระบบดึงผลหวยอัตโนมัติ — Web Scraping (฿2,500)
3. ระบบแจ้งเตือนก่อนปิดรับ — Countdown (฿1,000)
4. ส่งสถิติย้อนหลัง 10 งวด (฿1,000)
5. Admin Dashboard — Web (฿2,000)
6. Database + Hosting + Deploy (฿1,500)
7. ระบบเชื่อม Telegram → n8n → LINE (฿2,000)

### Out of Scope
- ✗ แอปมือถือ (iOS / Android)
- ✗ ระบบรับ/ส่งเงิน (Payment)
- ✗ ระบบสมาชิก/สมัคร VIP
- ✗ LINE Official Account (ลูกค้าสมัครเอง)
- ✗ n8n Cloud monthly cost (~฿700/เดือน ลูกค้าจ่ายเอง หรือ self-host ฟรี)

### เงื่อนไข
- รับประกันแก้ Bug ฟรี 30 วัน
- Source code เป็นกรรมสิทธิ์ลูกค้าหลังชำระครบ
- Hosting (Vercel Free Tier) + Database (Supabase Free Tier) ฟรี
- ระยะเวลา 7-10 วันทำการ

---

## 10. Common Tasks

```
แก้ bug Dashboard         → src/app/(admin)/dashboard/page.tsx
แก้ Telegram ส่งไม่ได้    → src/lib/telegram.ts + ตรวจ TELEGRAM_BOT_TOKEN
แก้ LINE ไม่ได้รับ        → ตรวจ line_channel_access_token ใน settings + line_groups
แก้ Scraper ดึงไม่ได้     → src/lib/scraper.ts + scrape_sources table (URL/selectors เปลี่ยน)
ตั้งค่าดึงผลอัตโนมัติ     → /scraping → เลือกหวย → เพิ่ม Source (URL + CSS selectors)
ทดสอบ scrape              → /scraping → เลือกหวย → เพิ่ม Source → กด "ทดสอบดึงผล"
ดึงผลมือ (trigger)        → /scraping → เลือกหวย → กด "ดึงผลตอนนี้"
ปรับ scrape settings      → /settings → ดึงผลอัตโนมัติ (window, retry, delay)
เพิ่มหวยใหม่              → /lotteries → เพิ่ม (หรือ INSERT ใน DB)
แก้รูปแบบข้อความ          → src/lib/formatter.ts
แก้ Cron timing           → vercel.json (crons) หรือ bot_settings
ดู logs ส่งล้มเหลว        → /history (filter ตามวัน + ดู badge auto/manual)
ดู scrape errors          → /scraping → เลือกหวย → ดู last_error ของแต่ละ source
```

---

## 11. Known Issues & Lessons Learned

### Git / Deploy (สำคัญมาก — ห้ามลืม)
- **Push ตรงไป `main` ไม่ได้** — push เฉพาะ `claude/*` branch (403 error)
- **ขั้นตอนที่ถูกต้อง**: push `claude/*` → GitHub merge → Vercel auto-deploy
- **ก่อน push ต้อง `git pull --rebase`** — ป้องกัน rejected

### Telegram API
- **Bot Token** ได้จาก @BotFather — อย่า expose ใน client-side code
- **HTML parse mode** — ใช้ `<b>`, `<i>`, `<code>` (ไม่ใช่ Markdown)
- **sendMessage limit** — 30 msg/second ต่อ bot, 20 msg/minute ต่อ group
- **Channel** — Bot ต้องเป็น admin ของ channel ถึงจะส่งได้

### n8n Bridge
- **n8n ต้อง running ตลอด** — ถ้าล่ม LINE จะไม่ได้รับข้อความ
- **Fallback สำคัญมาก** — มี /api/line/notify เป็น backup ส่ง LINE Notify ตรง
- **n8n Workflow**: Telegram Trigger → Function (parse ข้อความ) → LINE Notify (loop ทุกกลุ่ม)

### LINE Notify
- **Token ต่อกลุ่ม** — แต่ละกลุ่ม LINE ต้องมี Notify Token แยก
- **Rate limit** — 1,000 msg/hour ต่อ token
- **Token หมดอายุ** — ถ้า user revoke ต้อง generate ใหม่

### Web Scraping
- **เว็บต้นทางเปลี่ยน HTML ได้ทุกเมื่อ** — selectors จะพัง → alert + fallback
- **บางเว็บบล็อก scraper** — ใช้ User-Agent + delay
- **เวลาออกผลอาจเลท** — retry ไม่ใช่ดึงครั้งเดียว

### Vercel Cron
- **ถี่สุด 1 ครั้ง/นาที** (Hobby plan)
- ดึงทุก 30 วินาที → setTimeout loop ภายใน API route
- **Alternative:** Supabase Edge Functions + pg_cron

### General
- **อ่าน CLAUDE.md ก่อนทำงานทุกครั้ง**
- **ดู index.html (demo) สำหรับ UI reference**
- **CSS selectors สำหรับ scraping ต้อง config ใน DB** — ห้าม hardcode
- **เจอ error ใหม่ → บันทึกลง section นี้**
- **ห้ามลบไฟล์โดยไม่ถามก่อน**
