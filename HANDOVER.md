# เอกสารส่งมอบและโอนย้ายระบบ — LottoBot

**โครงการ:** LottoBot — ระบบส่งผลหวยต่างประเทศอัตโนมัติ
**ใบเสนอราคา:** MF-2026011
**ลูกค้า:** คุณตอง (ผ่าน Fastwork)
**ผู้พัฒนา:** บริษัท มายด์ ฟิตเนส จำกัด
**วันที่:** 25 มีนาคม 2569

---

## 1. ลิงก์เว็บไซต์

| รายการ | URL | สถานะ |
|--------|-----|-------|
| Dashboard (Production) | _รอ Deploy — จะแจ้งภายหลัง_ | ⏳ รอ |
| Dashboard (Preview) | _รอ Deploy — จะแจ้งภายหลัง_ | ⏳ รอ |

> ลิงก์จะถูกอัปเดตเมื่อ Deploy เรียบร้อยแล้ว

---

## 2. ข้อมูลระบบ

| รายการ | รายละเอียด |
|--------|-----------|
| **Supabase** | |
| Project Name | lottobot |
| Region | Southeast Asia (Singapore) |
| Database | PostgreSQL 15 |
| **Vercel** | |
| Project Name | lottobot |
| Framework | Next.js 14 |
| **GitHub** | |
| Repository | _จะแจ้งเมื่อโอนให้ลูกค้า_ |
| Branch หลัก | main |
| **n8n** | |
| URL | _จะแจ้งเมื่อตั้งค่าเสร็จ_ |

---

## 3. สิ่งที่ได้รับ (7 ข้อ)

| # | รายการ | รายละเอียด |
|---|--------|-----------|
| 1 | **LINE Bot** | ส่งผลหวย 43 รายการจากหลายประเทศเข้ากลุ่ม LINE อัตโนมัติ |
| 2 | **Web Scraping** | ระบบดึงผลหวยจากเว็บต้นทางอัตโนมัติตามตารางออกผล |
| 3 | **Countdown** | นับถอยหลังก่อนออกผลหวยแต่ละตัว |
| 4 | **Statistics** | สถิติผลหวยย้อนหลังทุกงวด |
| 5 | **Dashboard** | หน้าจัดการระบบสำหรับ Admin ครบทุกฟังก์ชัน |
| 6 | **Database + Hosting** | ฐานข้อมูล Supabase + Hosting Vercel พร้อมใช้งาน |
| 7 | **TG-n8n-LINE Bridge** | ระบบเชื่อมต่อ Telegram → n8n → LINE Group |

---

## 4. ไฟล์ที่แนบมา

| ไฟล์ | รายละเอียด |
|------|-----------|
| `DELIVERY.md` | เอกสารส่งมอบงาน — สถานะ, เงื่อนไข, การชำระเงิน |
| `USER-GUIDE.md` | คู่มือการใช้งานสำหรับ Admin |
| `HANDOVER.md` | เอกสารส่งมอบและโอนย้ายระบบ (ไฟล์นี้) |
| `migrate.sql` | SQL สำหรับสร้างตารางฐานข้อมูลทั้งหมด |
| `verify-tables.sql` | SQL สำหรับตรวจสอบว่าตารางถูกสร้างครบ |
| `security-rls.sql` | SQL สำหรับตั้งค่าความปลอดภัย Row Level Security |
| Source Code | Repository GitHub ทั้งหมด |

---

## 5. รับประกัน

- **ระยะเวลา:** 30 วันนับจากวันส่งมอบ (25 มี.ค. — 24 เม.ย. 2569)
- **ครอบคลุม:** แก้ไข Bug ที่เกิดจากการพัฒนา, ระบบทำงานไม่ตรงตามขอบเขต
- **ไม่ครอบคลุม:** เว็บต้นทางเปลี่ยนโครงสร้าง, API Policy เปลี่ยน, แก้ Code เอง, เพิ่มฟีเจอร์ใหม่
- **รายละเอียดเพิ่มเติม:** ดูใน DELIVERY.md หัวข้อ "เงื่อนไขรับประกัน"

---

## 6. กรรมสิทธิ์

- เมื่อชำระเงินครบ 13,000 บาท แล้ว **กรรมสิทธิ์ทั้งหมด** เป็นของลูกค้า
- ลูกค้าได้รับ: Source Code, Database Schema, Deployment Configuration
- ลูกค้าสามารถแก้ไข ดัดแปลง หรือจ้างคนอื่นพัฒนาต่อได้
- ผู้พัฒนาจะโอน Supabase, Vercel, GitHub ให้ลูกค้าตามขั้นตอนด้านล่าง

---

## 7. วิธีโอนระบบให้ลูกค้า

### 7.1 โอน GitHub Repository

1. ผู้พัฒนาจะ Transfer Repository ไปยัง GitHub Account ของลูกค้า
2. หรือเพิ่มลูกค้าเป็น Collaborator (Owner) ของ Repository
3. ลูกค้าจะได้ Source Code ทั้งหมดพร้อม Git History

### 7.2 โอน Vercel Project

1. ผู้พัฒนาจะเชิญลูกค้าเข้า Vercel Team (หรือโอน Project)
2. ลูกค้าสร้าง Vercel Account (ถ้ายังไม่มี) ที่ https://vercel.com
3. ลูกค้า Import Repository จาก GitHub ที่โอนแล้ว
4. ตั้งค่า Environment Variables ตามที่ระบุด้านล่าง
5. กด Deploy

### 7.3 โอน Supabase — ดูรายละเอียดในหัวข้อ 8

---

## 8. ขั้นตอนการโอนย้าย Database (สำคัญ)

ขั้นตอนนี้เป็นวิธีโอนฐานข้อมูลให้ลูกค้าเป็นเจ้าของเอง อ่านทีละขั้นตอนแล้วทำตาม:

### ขั้นตอนที่ 1 — สมัคร Supabase Account

1. เปิดเว็บ https://supabase.com
2. กด **Start your project** (ปุ่มสีเขียว)
3. สมัครด้วย **GitHub Account** (แนะนำ) หรือ Email
4. ยืนยัน Email ถ้าสมัครด้วย Email
5. เข้าสู่ Supabase Dashboard สำเร็จ

### ขั้นตอนที่ 2 — สร้าง New Project

1. ที่หน้า Supabase Dashboard กด **New Project**
2. เลือก Organization (ใช้ค่าเริ่มต้นได้)
3. กรอกข้อมูล:
   - **Project Name:** `lottobot` (หรือชื่อที่ต้องการ)
   - **Database Password:** ตั้งรหัสผ่านที่แข็งแรง — **จดไว้ให้ดี ห้ามลืม!**
   - **Region:** Southeast Asia (Singapore)
4. กด **Create new project**
5. รอ 1-2 นาที ระบบจะสร้าง Project ให้

### ขั้นตอนที่ 3 — เปิด SQL Editor

1. ที่เมนูด้านซ้าย กด **SQL Editor** (ไอคอนรูปฐานข้อมูล)
2. จะเห็นหน้าสำหรับพิมพ์ SQL
3. กด **New query** (ปุ่มด้านบน)

### ขั้นตอนที่ 4 — รัน migrate.sql

1. เปิดไฟล์ `migrate.sql` ที่แนบมาด้วย
2. **Copy ข้อความทั้งหมด** ในไฟล์ (Ctrl+A แล้ว Ctrl+C)
3. กลับมาที่ SQL Editor ใน Supabase
4. **วาง** ข้อความที่ Copy มา (Ctrl+V)
5. กดปุ่ม **Run** (หรือกด Ctrl+Enter)
6. รอจนเสร็จ — จะเห็นข้อความ **Success** สีเขียว
7. ถ้ามี Error สีแดง ให้ Screenshot แล้วส่งให้ผู้พัฒนา

> **สำคัญ:** ต้องรัน migrate.sql ก่อนเสมอ เพราะเป็นไฟล์สร้างตารางทั้งหมดของระบบ

### ขั้นตอนที่ 5 — ตรวจสอบด้วย verify-tables.sql

1. กด **New query** อีกครั้ง
2. เปิดไฟล์ `verify-tables.sql` แล้ว Copy ทั้งหมด
3. วางใน SQL Editor แล้วกด **Run**
4. ตรวจสอบผลลัพธ์:
   - ทุกตารางต้องแสดงสถานะ **OK** หรือ **EXISTS**
   - ถ้ามีตารางไหนแสดง **MISSING** ให้แจ้งผู้พัฒนา
5. ถ้าทุกตาราง OK = ฐานข้อมูลพร้อมใช้งาน

### ขั้นตอนที่ 6 — ตั้งค่า Environment Variables

1. ที่ Supabase Dashboard ไปที่ **Settings** > **API**
2. จดค่าต่อไปนี้:

| ค่าที่ต้องจด | หาได้จาก |
|-------------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Settings > API > Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Settings > API > anon public |
| `SUPABASE_SERVICE_ROLE_KEY` | Settings > API > service_role (เก็บเป็นความลับ!) |

3. นำค่าเหล่านี้ไปตั้งใน Vercel:
   - เข้า Vercel Dashboard > Project Settings > Environment Variables
   - เพิ่มค่าทั้ง 3 ตัว
   - กด Save

4. Environment Variables อื่น ๆ ที่ต้องตั้ง:

| ชื่อ | รายละเอียด |
|------|-----------|
| `LINE_CHANNEL_ACCESS_TOKEN` | Token จาก LINE Developers Console |
| `LINE_CHANNEL_SECRET` | Secret จาก LINE Developers Console |
| `TELEGRAM_BOT_TOKEN` | Token จาก @BotFather |
| `N8N_WEBHOOK_URL` | URL Webhook ของ n8n |

### ขั้นตอนที่ 7 — รัน security-rls.sql (เมื่อพร้อม Production)

> **คำเตือน:** รันขั้นตอนนี้เป็นขั้นตอนสุดท้าย หลังจากทดสอบระบบเรียบร้อยแล้ว

1. กด **New query** ใน SQL Editor
2. เปิดไฟล์ `security-rls.sql` แล้ว Copy ทั้งหมด
3. วางใน SQL Editor แล้วกด **Run**
4. ไฟล์นี้จะตั้งค่า **Row Level Security (RLS)** เพื่อป้องกันไม่ให้คนอื่นเข้าถึงข้อมูลโดยตรง
5. ตรวจสอบว่าระบบยังทำงานปกติหลังรัน

> **หมายเหตุ:** ถ้ารัน security-rls.sql แล้วระบบมีปัญหา สามารถแจ้งผู้พัฒนาเพื่อช่วยแก้ไขได้ (ภายในระยะรับประกัน)

---

## สรุปลำดับขั้นตอนทั้งหมด

```
1. ✅ สมัคร Supabase Account
2. ✅ สร้าง New Project (เลือก Region: Singapore)
3. ✅ เปิด SQL Editor
4. ✅ Copy + Run migrate.sql
5. ✅ Copy + Run verify-tables.sql (ตรวจสอบตาราง)
6. ✅ จดค่า API Keys จาก Supabase
7. ✅ ตั้งค่า Environment Variables ใน Vercel
8. ✅ ทดสอบระบบ
9. ✅ Run security-rls.sql (ขั้นตอนสุดท้าย)
```

---

**หากมีข้อสงสัยหรือติดปัญหา** สามารถติดต่อผู้พัฒนาได้ผ่าน Fastwork หรือช่องทางที่ตกลงไว้ (ภายในระยะรับประกัน 30 วัน)

---

**ผู้ส่งมอบ:** บริษัท มายด์ ฟิตเนส จำกัด
**ผู้รับมอบ:** คุณตอง

_เอกสารฉบับนี้เป็นส่วนหนึ่งของการส่งมอบโครงการ LottoBot (MF-2026011)_
