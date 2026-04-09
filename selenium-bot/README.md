# LottoBot Selenium — LINE Web Automation

ส่งข้อความเข้ากลุ่ม LINE ผ่าน Chrome + Selenium
ไม่มี quota จำกัด ไม่ใช้ unofficial API

## สถาปัตยกรรม

```
Vercel Cron → HTTP POST → VPS (Selenium Bot) → Chrome → LINE Web → กลุ่ม LINE
```

## VPS Requirements

- Ubuntu 22.04+
- Docker + Docker Compose
- RAM: 1GB+ (Chrome ใช้ ~500MB)
- Storage: 5GB+

## Quick Start

### 1. Setup VPS

```bash
# ติดตั้ง Docker
curl -fsSL https://get.docker.com | sh

# Clone repo
git clone https://github.com/panatch1992-cell/lottobot.git
cd lottobot/selenium-bot

# Build + Run (setup mode)
docker compose up -d --build
```

### 2. Login LINE Web (ครั้งแรก)

```bash
# เปิด browser ไปที่:
# http://YOUR_VPS_IP:6080/vnc.html
#
# จะเห็นหน้า Chrome + LINE Web
# สแกน QR code จากมือถือ ลค → Login สำเร็จ
# Session จะถูกเก็บใน Docker volume (ไม่หายเมื่อ restart)
```

### 3. Switch to Production Mode

```bash
# แก้ docker-compose.yml:
#   MODE=run
#   HEADLESS=true
# แล้ว restart:
docker compose down && docker compose up -d
```

### 4. Test

```bash
# Health check
curl http://localhost:8080/health

# ส่งข้อความ
curl -X POST http://localhost:8080/send \
  -H "Content-Type: application/json" \
  -d '{"group_name": "บ้าน", "text": "🧪 ทดสอบ LottoBot"}'

# ส่งทุกกลุ่ม
curl -X POST http://localhost:8080/send-all \
  -H "Content-Type: application/json" \
  -d '{"groups": ["บ้าน", "กลุ่ม2"], "text": "ผลหวย...", "delay": 2}'
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /health | สถานะ bot + login |
| GET | /login-status | เช็ค login + QR screenshot |
| GET | /screenshot | ถ่าย screenshot หน้าปัจจุบัน |
| POST | /send | ส่งข้อความ 1 กลุ่ม |
| POST | /send-all | ส่งข้อความทุกกลุ่ม |

## POST /send

```json
{
  "group_name": "บ้าน",
  "text": "🧪 ทดสอบ"
}
```

## POST /send-all

```json
{
  "groups": ["บ้าน", "กลุ่ม VIP"],
  "text": "ผลหวย...",
  "delay": 2
}
```

## เชื่อมกับ Vercel

อัพเดท `unofficial_line_endpoint` ใน Supabase settings:
```
http://YOUR_VPS_IP:8080
```

messaging-service.ts จะเรียก /send อัตโนมัติ

## Maintenance

```bash
# ดู logs
docker compose logs -f

# Restart
docker compose restart

# Re-login (ถ้า session หมดอายุ)
# แก้ MODE=setup → restart → login ผ่าน VNC → แก้ MODE=run
```
