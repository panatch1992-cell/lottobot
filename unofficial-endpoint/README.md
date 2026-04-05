# Unofficial Endpoint (Node.js/Express) — พร้อม deploy

บริการนี้รับ request จาก `lottobot` provider mode แล้วส่งต่อเข้า LINE Messaging API

## 1) เตรียมและรัน local

```bash
cd unofficial-endpoint
npm install
cp .env.example .env
# แก้ค่าใน .env
npm run dev
```

ตรวจ health:

```bash
curl http://localhost:8080/health
```

## 2) ตั้งค่าใน Vercel/Supabase

ใส่ค่าใน `bot_settings` ของ lottobot:

- `messaging_primary_provider = unofficial_line`
- `messaging_fallback_provider = official_line`
- `messaging_auto_failover_enabled = true`
- `unofficial_line_endpoint = https://<your-domain>/send`
- `unofficial_line_token = <UNOFFICIAL_AUTH_TOKEN>`

## 3) ทดสอบ endpoint โดยตรง

```bash
curl -X POST http://localhost:8080/send \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer replace_me" \
  -d '{"mode":"push_text","to":"Cxxxxxxxx","text":"hello from unofficial"}'
```

## 4) เทสเฉพาะ "เทสกลุ่ม 2" ก่อน

รัน SQL ใน Supabase:

```sql
update line_groups set is_active = false;
update line_groups set is_active = true where name = 'เทสกลุ่ม 2';
```

จากนั้นทดสอบส่ง:

```powershell
Invoke-RestMethod -Method POST `
  -Uri "https://lottobot-chi.vercel.app/api/send-custom" `
  -ContentType "application/json" `
  -Body '{"message":"เทสผ่าน unofficial","target":"line"}'
```

## 5) เปิดทุกกลุ่มหลังผ่าน

```sql
update line_groups set is_active = true where line_group_id is not null;
```

> ถ้ามีกลุ่มเก่าที่ไม่ใช้แล้ว ให้ปิดเฉพาะกลุ่มนั้นทีหลัง

## 6) Docker (copy-paste)

### Dockerfile

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
EXPOSE 8080

CMD ["npm", "start"]
```

### Build & Run local

```bash
docker build -t lottobot-unofficial-endpoint .
docker run --rm -p 8080:8080 \
  -e UNOFFICIAL_AUTH_TOKEN=replace_me \
  -e LINE_CHANNEL_ACCESS_TOKEN=replace_me \
  lottobot-unofficial-endpoint
```

## 7) Render deploy config (copy-paste)

ไฟล์: `render.yaml`

```yaml
services:
  - type: web
    name: lottobot-unofficial-endpoint
    runtime: docker
    dockerContext: .
    dockerfilePath: ./Dockerfile
    plan: free
    healthCheckPath: /health
    envVars:
      - key: PORT
        value: 8080
      - key: UNOFFICIAL_AUTH_TOKEN
        sync: false
      - key: LINE_CHANNEL_ACCESS_TOKEN
        sync: false
```

> ใน Render UI ให้ใส่ค่า `UNOFFICIAL_AUTH_TOKEN` และ `LINE_CHANNEL_ACCESS_TOKEN` เป็นค่าจริง

## 8) Railway deploy config (copy-paste)

ไฟล์: `railway.json`

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "./Dockerfile"
  },
  "deploy": {
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10,
    "healthcheckPath": "/health",
    "healthcheckTimeout": 100
  }
}
```

> ใน Railway Variables ให้ใส่ `UNOFFICIAL_AUTH_TOKEN`, `LINE_CHANNEL_ACCESS_TOKEN`, `PORT=8080`
