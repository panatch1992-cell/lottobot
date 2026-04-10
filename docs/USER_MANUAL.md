# 📖 คู่มือผู้ใช้ LottoBot (ฉบับสมบูรณ์)

> คู่มือนี้แยกตามหน้าในระบบ — เลือกอ่านหน้าที่ต้องการใช้ได้เลย

---

## 📑 สารบัญ

1. [หน้าหลัก (/dashboard)](#1-หน้าหลัก-dashboard)
2. [ข้อความ (/messages)](#2-ข้อความ-messages)
3. [ดึงผล (/scraping)](#3-ดึงผล-scraping)
4. [ประวัติ (/history)](#4-ประวัติ-history)
5. [ตั้งค่า (/settings)](#5-ตั้งค่า-settings)
6. [ตรวจสอบสถานะ (/status)](#6-ตรวจสอบสถานะ-status)
7. [หน้าอื่น ๆ ที่เข้าผ่าน URL](#7-หน้าอื่น-ๆ-ที่เข้าผ่าน-url)

---

## 1. หน้าหลัก (/dashboard)

**Path:** `https://lottobot-chi.vercel.app/dashboard`
**ไอคอนใน nav:** 📊 หน้าหลัก
**สำหรับ:** ลูกค้า (View-only)

### สิ่งที่เห็นในหน้านี้:

1. **🚨 System Alert** — แสดงเมื่อระบบมีปัญหา (error/warning)
   - คลิก "ดูรายละเอียด →" → ไป `/status`
2. **🔄 Flow Diagram** — แสดงการไหลของระบบ (เว็บ → TG → LINE)
3. **📈 Quick Stats** — 3 ช่อง:
   - หวยทั้งหมด (active)
   - กลุ่ม LINE (active)
   - ส่งวันนี้ (success/failed)
4. **🏥 ลิงก์ "ตรวจสอบสถานะระบบ"** — ไป `/status`
5. **🤖 Quick Action "ดึงอัตโนมัติ"** — ไป `/scraping`
6. **📋 รายการหวยวันนี้** — สถานะแต่ละหวย (รอ/กำลังส่ง/ส่งแล้ว/ล้มเหลว)

### ทำอะไรได้บ้าง:
- ✅ ดูภาพรวม
- ✅ คลิกลิงก์ไปหน้าอื่น
- ❌ **ไม่มีปุ่มแก้ไข/บันทึก**

### ใช้เมื่อ:
- เช็คว่าระบบทำงานปกติหรือมีปัญหา
- ดูว่าวันนี้ส่งหวยได้กี่รายการ

---

## 2. ข้อความ (/messages)

**Path:** `https://lottobot-chi.vercel.app/messages`
**ไอคอนใน nav:** 💬 ข้อความ
**สำหรับ:** ลูกค้า (Interactive — ส่งจริง)

### สิ่งที่เห็น:
1. **กล่องพิมพ์ข้อความ** — พิมพ์ข้อความเอง
2. **ปุ่มเลือกช่องทาง** — LINE / Telegram / ทั้งคู่
3. **Quick Templates** — ข้อความสำเร็จรูป:
   - 📢 รายการต่อไป
   - ⏰ Countdown
   - 📊 สถิติ
   - และอื่น ๆ
4. **ปุ่ม "ส่ง"** — ส่งเข้ากลุ่มจริง

### ทำอะไรได้บ้าง:
- ✅ พิมพ์ข้อความเอง → กดส่ง → ส่งเข้ากลุ่ม LINE/TG จริง
- ✅ ใช้ template สำเร็จรูป แล้วแก้ไขก่อนส่ง

### ใช้เมื่อ:
- ต้องการประกาศเอง (เช่น ปิดระบบชั่วคราว)
- ส่ง countdown พิเศษ
- ทดสอบว่าระบบส่งได้จริงไหม

⚠️ **ระวัง:** ข้อความนี้**ส่งเข้ากลุ่มจริง** ไม่ใช่แค่ preview

---

## 3. ดึงผล (/scraping)

**Path:** `https://lottobot-chi.vercel.app/scraping`
**ไอคอนใน nav:** 🤖 ดึงผล
**สำหรับ:** ลูกค้า

### สิ่งที่เห็น:
1. **รายการหวย 43 รายการ**
2. **Badge status:**
   - 📈 หวยหุ้น — ดึงจาก Yahoo Finance อัตโนมัติ
   - ⚙️ Config X source — ตั้งค่าแล้ว X แหล่ง
   - ❌ ยังไม่ตั้งค่า
3. **เลือกหวย** → เห็น:
   - Source URL + CSS selectors
   - ปุ่ม "ทดสอบดึงผล"
   - ปุ่ม "ดึงผลตอนนี้" (manual)
   - ปุ่ม "กรอกผลเอง" → ไป `/results?lottery_id=xxx`
   - Last error (ถ้ามี)

### ทำอะไรได้:
- ✅ เพิ่ม/แก้ไข source URL
- ✅ ตั้ง CSS selectors
- ✅ ทดสอบว่าดึงผลได้ไหม
- ✅ Manual trigger ดึงผลตอนนี้
- ✅ กรอกผลเอง (สำหรับหวยที่ scrape ไม่ได้)

### ใช้เมื่อ:
- เพิ่มแหล่งดึงผลใหม่
- เว็บต้นทางเปลี่ยน HTML → แก้ selectors
- เทสว่า scrape ทำงาน
- ลาว/ฮานอย → กรอกผลเอง

---

## 4. ประวัติ (/history)

**Path:** `https://lottobot-chi.vercel.app/history`
**ไอคอนใน nav:** 📋 ประวัติ
**สำหรับ:** ลูกค้า (View-only)

### สิ่งที่เห็น:
1. **วันที่** — filter ตามวันที่
2. **Stat Cards:**
   - ส่ง Telegram (สำเร็จ)
   - ส่ง LINE (สำเร็จ)
   - Failed (ถ้ามี)
3. **รายการ send_logs:**
   - ธง + ชื่อหวย
   - Badge: ✈️ TG, 💬 LINE
   - เวลาส่ง
   - Error message (ถ้า fail)

### ทำอะไรได้:
- ✅ ดูประวัติการส่งย้อนหลัง
- ✅ Filter ตามวันที่
- ✅ ดู error message

### ใช้เมื่อ:
- ตรวจว่าส่งหวยสำเร็จหรือไม่
- หาสาเหตุที่ส่งไม่ได้
- รายงานผลประจำวัน

---

## 5. ตั้งค่า (/settings)

**Path:** `https://lottobot-chi.vercel.app/settings`
**ไอคอนใน nav:** ⚙️ ตั้งค่า
**สำหรับ:** ลูกค้า (Edit)

### สิ่งที่เห็น:

#### 5.1 🔍 ตรวจสอบระบบ
- ปุ่ม "ตรวจสอบระบบทั้งหมด"
- รันเทสสั้น ๆ แสดงสถานะ

#### 5.2 📱 ตั้งค่าบัญชี LINE Bot
- **🔑 วาง Token จาก PC** (collapsible — วิธีสำรอง)
- **Email + Password** ของบัญชี LINE
- ปุ่ม **🔑 PIN Login** ← ใช้บ่อยสุด
- แสดงสถานะ: "✅ ตั้งค่าเรียบร้อยแล้ว"

#### 5.3 👥 กลุ่ม LINE
- รายการกลุ่มทั้งหมด
- Toggle เปิด/ปิด
- ลบกลุ่ม
- เตือนถ้าเกิน 15 กลุ่ม

#### 5.4 📤 วิธีส่งข้อความ LINE
- 🎯 **Trigger** (แนะนำ) — ใช้อยู่ ฟรี 100%
- 📨 **Push** — ส่งตรง, ไม่จำกัด แต่เสี่ยงแบน
- 📢 **Broadcast** — ส่งถึงเพื่อนทุกคน, จำกัด quota
- ปุ่ม **🧪 ทดสอบ Trigger**

#### 5.5 🎨 สไตล์รูปตัวเลข
- ธีม (8 แบบ)
- ฟอนต์
- ขนาด (S/M/L)
- Layout (horizontal/inline/vertical)
- ตัวอย่างรูปเรียลไทม์

### ทำอะไรได้:
- ✅ Login บัญชี LINE bot (PIN Login)
- ✅ เปิด/ปิดกลุ่ม LINE
- ✅ เปลี่ยนวิธีส่งข้อความ
- ✅ เปลี่ยนสไตล์รูปตัวเลข
- ❌ **ไม่มี advanced settings แล้ว** (ย้ายไป `/dev`)

### ใช้เมื่อ:
- Setup ครั้งแรก (PIN Login)
- Session หลุด → Re-login
- เพิ่ม/ลบกลุ่ม
- เปลี่ยนโหมดส่ง

---

## 6. ตรวจสอบสถานะ (/status)

**Path:** `https://lottobot-chi.vercel.app/status`
**ไม่อยู่ใน nav** — เข้าจาก Dashboard alert
**สำหรับ:** ลูกค้า + Dev

### สิ่งที่เห็น:
1. **Overall Status** — PASS / WARN / FAIL
2. **Summary** — ผ่าน/ล้มเหลว/ระวัง/ข้าม
3. **Auto-refresh toggle** (30 วินาที)
4. **รายการทดสอบ 9 จุด:**
   - DB Connection
   - Settings configured
   - VPS /health
   - LINE groups
   - Telegram bot
   - Recent results
   - Recent send logs
   - Scrape cron
   - Real trigger test (ถ้าเลือก)
5. **ปุ่ม "🔄 ตรวจใหม่"**
6. **ปุ่ม "🧪 ทดสอบจริง"** — ส่ง "." เข้ากลุ่มจริง

### ทำอะไรได้:
- ✅ รัน E2E test
- ✅ ทดสอบส่ง "." จริง
- ❌ **ไม่ใช่หน้าสำหรับแก้ไขค่า**

### ใช้เมื่อ:
- ระบบมีอาการผิดปกติ
- ต้องการเช็คทุกส่วนว่าทำงาน
- Dev เช็คก่อน/หลัง deploy

---

## 7. หน้าอื่น ๆ ที่เข้าผ่าน URL

หน้าเหล่านี้ไม่อยู่ใน BottomNav แต่เข้าได้ผ่าน URL หรือลิงก์จากหน้าอื่น

### 7.1 `/results` — กรอกผลหวยเอง
- เข้าจาก `/scraping` → เลือกหวย → "กรอกผลเอง"
- กรอกเลขบน/ล่าง/เต็ม
- บันทึก → ส่งเข้ากลุ่ม LINE ทันที
- **ใช้สำหรับ:** ลาว, ฮานอย, หวยที่ scrape ไม่ได้

### 7.2 `/lotteries` — จัดการหวย 43 รายการ
- เพิ่ม/แก้ไข/ลบหวย
- ตั้งเวลาออก, เวลาปิด
- ตั้งเวลา countdown
- Toggle เปิด/ปิด
- **ใช้สำหรับ:** Dev / เพิ่มหวยใหม่

### 7.3 `/groups` — จัดการกลุ่ม LINE (CRUD เต็ม)
- เพิ่ม/ลบกลุ่ม
- ตั้งชื่อ
- เลือกว่ากลุ่มนี้ส่งหวยไหนบ้าง (group_lotteries mapping)
- ตั้ง custom link / message
- **ใช้สำหรับ:** จัดการกลุ่มละเอียด

### 7.4 `/scheduled` — ตั้งเวลาส่งข้อความ
- ตั้งเวลาส่งข้อความล่วงหน้า
- Recurring schedules
- **ใช้สำหรับ:** ข้อความประจำเวลา

### 7.5 `/dev` — Dev Dashboard (Technical) 🔒
- VPS /health detailed
- Token debug info (JWT decoded)
- Anti-ban rate limits + circuit breaker
- Recent send logs with errors
- DB stats
- **Advanced settings** (Telegram, VPS URL, Scrape config)
- Reset anti-ban button
- **⚠️ สำหรับ dev เท่านั้น**

---

## 🎯 สรุป: ใครใช้หน้าไหน

### 👤 ลูกค้า (ใช้ประจำ)
```
1. /dashboard   — ดูภาพรวม
2. /settings    — ตั้งค่า PIN Login + กลุ่ม
3. /history     — ดูประวัติส่ง
4. /messages    — ส่งข้อความเอง (บางครั้ง)
5. /scraping    — ตั้งค่าหวย (บางครั้ง)
```

### 🔧 Dev (ใช้เมื่อมีปัญหา/setup)
```
1. /dev         — Debug + advanced settings
2. /status      — E2E test
3. /lotteries   — จัดการหวย
4. /groups      — จัดการกลุ่มละเอียด
5. /scheduled   — ตั้งเวลาส่ง
```

---

## 🚨 Troubleshooting ทั่วไป

### ปัญหา: Bot ไม่ส่งข้อความ
1. ไปที่ `/status` → ดูว่าข้อไหน fail
2. ถ้า VPS /health fail → เช็ค VPS รันอยู่ไหม
3. ถ้า clientReady=false → ไป `/settings` → PIN Login ใหม่

### ปัญหา: LINE OA ไม่ตอบกลับ
1. เช็คว่า LINE OA อยู่ในกลุ่มเดียวกับ bot หรือไม่
2. ถ้าไม่ → เชิญ @LottoBot เข้ากลุ่ม

### ปัญหา: Bot ถูก LINE แบน (error ABUSE_BLOCK)
1. ไป `/dev` → เช็ค Circuit Breaker
2. ถ้า OPEN → รอ cooldown 5 นาที
3. ถ้ายังไม่ได้ → รอ 24 ชม. หรือสมัครบัญชี LINE ใหม่

### ปัญหา: Session หลุด (V3_TOKEN_CLIENT_LOGGED_OUT)
1. เช็คว่าเปิด LINE Desktop บน PC หรือไม่ → ปิด
2. ไป `/settings` → PIN Login ใหม่
3. ระบบจะเก็บ session ในไฟล์ — รีสตาร์ท VPS ก็ไม่หายอีก

---

**อัพเดทล่าสุด:** 2026-04-10
**เวอร์ชั่นระบบ:** v3.0 (VPS + linejs + Trigger + Anti-ban)
