# LottoBot Hybrid — ฟรี + ไม่จำกัด + เสถียร

## แนวคิด "The Hybrid Hybrid"

```
Scraper เจอผลหวยใหม่
  → บันทึก result.json (Bridge :8083)
  → Trigger Bot (Playwright :8081) พิมพ์ "." เข้ากลุ่ม LINE
  → LINE OA เห็น "." ผ่าน Webhook
  → LINE OA Reply ผลหวยกลับ (ฟรี 100% ไม่จำกัด!)
```

## ทำไมถึงฟรีไม่จำกัด?

- **Push message** = เสียเงิน (quota จำกัด)
- **Reply message** = **ฟรี 100%** ไม่จำกัดจำนวน
- เราใช้บัญชีส่วนตัว (trigger) ส่ง "." เพื่อให้ LINE OA "ตอบกลับ" ด้วยผลหวย

## Components

| Service | Port | หน้าที่ |
|---------|------|---------|
| **trigger_bot.py** | 8081 | Playwright ควบคุม LINE Web — พิมพ์ "." เข้ากลุ่ม |
| **line_oa_responder.py** | 8082 | LINE OA Webhook — เห็น "." → Reply ผลหวย |
| **scraper_bridge.py** | 8083 | รับผลจาก Vercel → บันทึก result.json |

## Setup

### 1. สร้าง LINE Official Account

1. ไปที่ [LINE Developers](https://developers.line.biz/)
2. สร้าง Provider → สร้าง Messaging API Channel
3. เปิด Webhook → ตั้ง URL: `http://YOUR_VPS:8082/webhook`
4. คัดลอก **Channel Secret** + **Channel Access Token**
5. **เชิญ LINE OA เข้ากลุ่มของ ลค**

### 2. Deploy บน VPS

```bash
git clone https://github.com/panatch1992-cell/lottobot.git
cd lottobot/hybrid-bot

# แก้ docker-compose.yml:
#   LINE_CHANNEL_SECRET=xxx
#   LINE_CHANNEL_ACCESS_TOKEN=xxx
#   GROUPS=["บ้าน","กลุ่ม VIP"]

docker compose up -d --build
```

### 3. Login LINE Web (ครั้งแรก)

```
เปิด browser: http://YOUR_VPS:6080/vnc.html
→ เห็น Chrome + LINE Web
→ สแกน QR ด้วยบัญชีส่วนตัว (trigger account)
→ Session ถูกเก็บใน Docker volume
```

### 4. Switch to Production

```bash
# แก้ docker-compose.yml:
#   MODE=run
#   HEADLESS=true

docker compose down && docker compose up -d
```

### 5. เชื่อม Vercel Scraper

แก้ Vercel cron ให้ส่งผลหวยไปที่ Bridge:

```typescript
// เมื่อ scraper เจอผลใหม่:
await fetch('http://YOUR_VPS:8083/result', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: lottery.name,
    flag: lottery.flag,
    date: formatThaiDate(result.draw_date),
    top_number: result.top_number,
    bottom_number: result.bottom_number,
  }),
});
```

## API

### Trigger Bot (:8081)

```bash
# Health
GET /health

# Manual trigger ทุกกลุ่ม
POST /trigger
{"groups": ["บ้าน"]}

# Screenshot
GET /screenshot
```

### Responder (:8082)

```bash
# Webhook (LINE OA เรียก)
POST /webhook

# Health
GET /health

# Test format
POST /test-reply
```

### Bridge (:8083)

```bash
# ส่งผลหวย
POST /result
{"name": "นิเคอิ", "flag": "🇯🇵", "top_number": "034", "bottom_number": "97"}

# ดูผลล่าสุด
GET /result

# Health
GET /health
```

## ข้อดี

- ✅ **ฟรี 100%** — Reply ไม่เสียเงิน
- ✅ **ไม่จำกัดข้อความ** — ส่งกี่ครั้งก็ได้
- ✅ **เสถียร** — LINE OA API ไม่มี token หลุด
- ✅ **Playwright ทนกว่า LINEJS** — ใช้ browser จริง
- ✅ **Session persist** — Docker volume เก็บ cookie
- ✅ **Auto-recovery** — element fail → reload → retry
