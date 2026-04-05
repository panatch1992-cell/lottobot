# แผนพัฒนา: เปลี่ยนจาก LINE Messaging API ไปสู่ Unofficial API (แบบค่อยเป็นค่อยไป)

เอกสารนี้วางแผนต่อยอดจากโครงสร้างปัจจุบันของโปรเจกต์ `lottobot` โดยลดความเสี่ยงการหยุดระบบ และยังคง fallback กลับมาใช้เส้นทางเดิมได้ทันที

> ⚠️ **สำคัญ:** เอกสารนี้คือ “แผนพัฒนา” ไม่ใช่การการันตีว่า deploy แล้ว production จะเสถียรทันที  
> ต้องผ่านการ implement จริง, ทดสอบครบทุกชั้น, canary rollout, และผ่าน KPI go-live ก่อนจึงค่อย cutover

---

## 1) ภาพรวมระบบปัจจุบัน (Current State)

### สิ่งที่มีอยู่แล้ว
- มี helper สำหรับส่งข้อความผ่าน LINE Messaging API (push/broadcast) พร้อม retry กรณี 429.  
- มีระบบ webhook สำหรับรับ event จาก LINE และตรวจ signature.  
- มี LINE Notify fallback/OAuth helper สำหรับกลุ่มที่ใช้ token.  
- มีโครง API route และฐานข้อมูลสำหรับ settings / line_groups / send_logs พร้อมใช้งาน.

### ข้อจำกัดที่พบ
- โค้ดผูกกับ provider ค่อนข้างตรง (`line-messaging.ts`, `line-notify.ts`) ทำให้เปลี่ยน provider ยาก
- การวัดผล/monitor ยังเน้นผลสำเร็จปลายทาง แต่ยังไม่มีสถานะ “degraded mode” ที่ใช้สลับ provider อัตโนมัติ
- ยังไม่มี interface มาตรฐานกลางสำหรับ provider หลายแบบ

---

## 2) เป้าหมาย (Target State)

1. รองรับการส่งผ่าน **2 provider**:
   - `official_line` (ของเดิม)
   - `unofficial_line` (ตัวใหม่)
2. สลับ provider ได้จาก setting โดยไม่ต้อง deploy
3. มี fallback อัตโนมัติ (official ↔ unofficial)
4. มี observability ชัดเจน: success rate, latency, error class, provider switch
5. สามารถ rollback ได้ภายในไม่กี่นาที

---

## 3) แนวทางสถาปัตยกรรม

สร้าง abstraction กลางชื่อ `MessagingProvider` เช่น

```ts
interface MessagingProvider {
  name: 'official_line' | 'unofficial_line'
  sendText(input: { to: string; text: string }): Promise<SendResult>
  sendImageAndText(input: { to: string; imageUrl: string; text: string }): Promise<SendResult>
  broadcastText(input: { text: string }): Promise<SendResult>
  broadcastImageAndText(input: { imageUrl: string; text: string }): Promise<SendResult>
  getQuota?(): Promise<QuotaResult>
}
```

แล้วแยก implementation เป็น:
- `src/lib/providers/official-line-provider.ts` (wrap ของ `line-messaging.ts`)
- `src/lib/providers/unofficial-line-provider.ts` (ของใหม่)
- `src/lib/providers/provider-factory.ts` (เลือก provider จาก settings)
- `src/lib/providers/provider-fallback.ts` (fallback strategy + circuit breaker)

> หลักสำคัญ: route เดิมไม่ควรรู้รายละเอียดของ provider แล้วเรียกผ่าน facade ตัวเดียว

---

## 4) Roadmap แบบเฟส (6 สัปดาห์)

## เฟส 0: Discovery & Guardrails (2-3 วัน)
- เก็บ requirement เชิงธุรกิจ: throughput, latency, ช่วงเวลาส่งหนัก
- ระบุ risk matrix ของ unofficial API (block/rate limit/ban)
- กำหนด SLO เบื้องต้น (เช่น success rate ≥ 99%)
- เพิ่ม feature flags ใน `bot_settings`:
  - `messaging_primary_provider`
  - `messaging_fallback_provider`
  - `messaging_auto_failover_enabled`

**Deliverable:** เอกสาร risk + ตาราง fallback policy

## เฟส 1: Provider Abstraction (สัปดาห์ที่ 1)
- สร้าง `MessagingProvider` interface
- refactor ให้ `line-messaging.ts` ใช้งานผ่าน `official-line-provider`
- เพิ่ม facade กลาง `messaging-service.ts` ที่ route อื่นเรียกใช้งาน
- ปรับ log schema ให้มี `provider` และ `attempt_no`

**Deliverable:** official provider ยังส่งได้เหมือนเดิม 100%

## เฟส 2: Unofficial Provider Adapter (สัปดาห์ที่ 2)
- พัฒนา adapter สำหรับ unofficial API (แยกไฟล์ชัดเจน)
- map error จาก unofficial → internal error code มาตรฐาน
- เพิ่ม timeout/retry/backoff แยกจาก official
- เพิ่ม secret/env สำหรับ unofficial (เข้ารหัสหรือเก็บใน vault)

**Deliverable:** ยิงทดสอบ staging ผ่าน unofficial ได้แบบจำกัด scope

## เฟส 3: Failover & Reliability (สัปดาห์ที่ 3)
- ทำ fallback strategy:
  - primary fail แบบ retry ครบ → ส่งผ่าน secondary
- เพิ่ม circuit breaker (เปิดเมื่อ error rate สูง)
- เพิ่ม idempotency key ป้องกันส่งซ้ำ
- เพิ่ม dead-letter queue สำหรับเคสส่งไม่ผ่านทั้ง 2 ฝั่ง

**Deliverable:** มี auto-failover และ replay failed jobs ได้

## เฟส 4: Observability & Control Plane (สัปดาห์ที่ 4)
- dashboard เพิ่มกราฟตาม provider: success rate, p95 latency, error type
- เพิ่ม endpoint diagnostics สำหรับ provider health
- alerting:
  - error rate > threshold
  - fallback triggered > X ครั้ง/ชม.
- เพิ่มหน้า settings สำหรับสลับ provider แบบปลอดภัย

**Deliverable:** ทีมปฏิบัติการมองเห็นสถานะได้แบบ near real-time

## เฟส 5: Canary Rollout (สัปดาห์ที่ 5)
- เริ่มจาก 5% ของกลุ่ม/งานส่ง
- ขยับเป็น 20% → 50% ตาม metric gate
- มี auto-rollback หากต่ำกว่า SLO ที่กำหนด
- บันทึก incident timeline ทุกครั้งที่สลับ provider

**Deliverable:** unofficial ใช้งานจริงบางส่วนโดยไม่กระทบระบบรวม

## เฟส 6: Production Cutover (สัปดาห์ที่ 6)
- ตั้ง unofficial เป็น primary (ถ้าผ่าน KPI ต่อเนื่อง)
- official เป็น warm fallback
- freeze การเปลี่ยนที่ไม่จำเป็น 1 สัปดาห์
- สรุป post-cutover report

**Deliverable:** cutover สำเร็จ + rollback plan พร้อมใช้งาน

---

## 5) งานที่ต้องแก้ตามไฟล์ในโปรเจกต์นี้

### Core library
- `src/lib/line-messaging.ts` → ย้าย logic เป็น official provider implementation
- `src/lib/line-notify.ts` → ใช้เป็น fallback legacy path หรือแยกเป็น notifier module
- เพิ่ม `src/lib/providers/*` และ `src/lib/messaging-service.ts`

### API routes
- จุดที่ส่งข้อความ เช่น
  - `src/app/api/test-send/route.ts`
  - `src/app/api/send-custom/route.ts`
  - `src/app/api/test-all/route.ts`
  - `src/app/api/cron/scheduled/route.ts`
  ควรเปลี่ยนมาเรียก `messaging-service` แทนเรียก LINE helper ตรง ๆ

### Webhook
- `src/app/api/line/webhook/route.ts` คงไว้สำหรับรับ event จาก LINE official
- หาก unofficial มี webhook แยก ให้เพิ่ม route ใหม่ภายใต้ `/api/unofficial/*`

### Database
- เพิ่ม columns/tables (ผ่าน migration):
  - `send_logs.provider`
  - `send_logs.error_code`
  - `provider_health`
  - `message_queue` / `dead_letter_queue` (ถ้ายังไม่มี)

---

## 6) แผนทดสอบ (Test Strategy)

1. Unit test
- provider contract test (official/unofficial ต้องผ่านเคสเดียวกัน)
- error mapping test
- fallback decision test

2. Integration test
- API route → messaging-service → provider mock
- webhook signature validation

3. E2E test (จาก Playwright ที่มีอยู่)
- เพิ่ม scenario ส่งข้อความสำเร็จ/ล้มเหลว/สลับ provider
- ตรวจ log ว่าบันทึก provider ถูกต้อง

4. Load/Soak
- ทดสอบ burst ส่งช่วงใกล้ออกผล
- วัด p95 latency และ error rate

---

## 7) KPI สำหรับ go/no-go

- Delivery success rate ต่อ provider
- End-to-end latency (p50/p95)
- Duplicate message rate
- Fallback activation rate
- Recovery time หลัง provider fail
- ค่าใช้จ่ายต่อ 1,000 messages

**เกณฑ์ตัวอย่างก่อน cutover:**
- 7 วันล่าสุด success rate unofficial ≥ 99%
- ไม่มี incident ระดับวิกฤตจาก duplicate ส่งซ้ำ
- rollback test ผ่านภายใน 10 นาที

---

## 8) แผน rollback (ต้องเตรียมก่อน cutover)

- Toggle `messaging_primary_provider=official_line`
- ปิด `messaging_auto_failover_enabled` ชั่วคราวระหว่าง incident
- replay queue ที่ค้างด้วย provider official
- ออกรายงาน incident + root cause ภายใน 24 ชม.

---

## 9) Checklist ลงมือทำทันที (สัปดาห์นี้)

- [ ] สร้าง `MessagingProvider` + `messaging-service`
- [ ] ย้าย LINE official logic เข้า provider implementation
- [ ] เพิ่ม feature flags ใน `bot_settings`
- [ ] เพิ่ม schema `send_logs.provider` และ `error_code`
- [ ] เพิ่ม dashboard card แสดง success/error แยก provider
- [ ] เขียน runbook: failover + rollback step-by-step

---

## 10) หมายเหตุสำคัญด้านความเสี่ยง

การใช้ unofficial API มีความเสี่ยงเชิงนโยบายของผู้ให้บริการและอาจเปลี่ยนได้ตลอดเวลา จึงควรเก็บ official path ไว้เป็น fallback อย่างน้อย 1-2 release cycle และทำ canary แบบค่อยเป็นค่อยไปเท่านั้น

---

## 11) เงื่อนไขก่อนขึ้น Production (Production Readiness Gate)

ทีมพัฒนาควรถือว่า “พร้อมขึ้น production” ก็ต่อเมื่อผ่านครบทุกข้อด้านล่าง:

- [ ] ฟีเจอร์หลักส่งข้อความผ่าน `MessagingProvider` ครบทุก route ที่ใช้งานจริง
- [ ] Unit/Integration/E2E สำคัญผ่านทั้งหมดใน CI
- [ ] มีการทดสอบ failover จริง (primary ล่ม → secondary ทำงานได้)
- [ ] มี runbook incident และ rollback ที่ทีม on-call ใช้ได้จริง
- [ ] Canary อย่างน้อย 7 วัน โดย KPI ผ่านเกณฑ์
- [ ] มี monitoring + alert ครบ (success rate, error rate, latency, duplicate)
- [ ] ยืนยัน compliance/ToS และความเสี่ยงทางธุรกิจกับผู้มีอำนาจตัดสินใจแล้ว

ถ้ายังไม่ผ่านครบทุกข้อ ให้ถือว่ายังเป็น **pre-production / staged rollout** และไม่ควร cutover เต็ม 100%

---

## 12) แผนขึ้น Production 100% (Cutover Plan)

> ใช้แผนนี้เมื่อทีมต้องการขึ้นใช้งานจริง 100% ภายในรอบเดียว โดยยังคงมี fallback/rollback พร้อมใช้งานทันที

### Phase A — เตรียมก่อนวัน cutover (T-14 ถึง T-2)

**T-14 ถึง T-10**
- ปิด scope ใหม่ทั้งหมด (feature freeze เฉพาะระบบส่งข้อความ)
- implement provider abstraction + unofficial provider ให้ครบเส้นทางส่งจริง
- เปิด logging โครงสร้างเดียวกันทุก provider

**T-9 ถึง T-7**
- รัน test pack ที่บังคับ:
  - unit: provider contract, idempotency, error mapping
  - integration: route → messaging-service → provider
  - e2e: send success/failure/fallback
- ทดสอบ failure injection (จำลอง unofficial ล่ม/ช้า/429)

**T-6 ถึง T-4**
- ซ้อม incident game day:
  - ตัด unofficial กลางคัน
  - ตัด official กลางคัน
  - queue backlog พุ่ง
- จับเวลา rollback ต้องไม่เกิน 10 นาที

**T-3 ถึง T-2**
- final readiness review กับผู้อนุมัติระบบ
- lock config ทุกค่าที่เกี่ยวกับ provider
- backup DB + export config + snapshot dashboard baseline

### Phase B — วันขึ้นระบบจริง (T-0)

**ก่อน cutover 2 ชั่วโมง**
- ประกาศ maintenance window ให้ผู้เกี่ยวข้อง
- เปิด war room (dev + ops + owner)
- ตรวจ health check ทุก dependency

**ขั้น cutover**
1. ตั้ง `messaging_primary_provider=unofficial_line`
2. ตั้ง `messaging_fallback_provider=official_line`
3. เปิด `messaging_auto_failover_enabled=true`
4. ปล่อย traffic 100% ไปที่ unofficial
5. เฝ้าดู metric นาทีต่อนาที 60 นาทีแรก

**เงื่อนไขผ่านช่วงวิกฤต 60 นาทีแรก**
- success rate ≥ 99%
- p95 latency ไม่เกิน baseline + 20%
- duplicate rate ≤ 0.1%
- ไม่มี error class วิกฤตต่อเนื่องเกิน 5 นาที

### Phase C — หลัง cutover (T+1 ถึง T+7)

- ติดตาม hourly dashboard + สรุป incident ทุกวัน
- หยุด deploy ที่ไม่จำเป็น 7 วัน (stabilization window)
- สรุป post-launch review และปิด war room เมื่อ KPI คงที่

### Immediate Rollback Criteria (สั่งถอยทันที)

ถ้าเกิดข้อใดข้อหนึ่ง ให้ rollback โดยไม่รอ:
- success rate < 97% ต่อเนื่อง 10 นาที
- เกิด duplicate ส่งซ้ำเป็นวงกว้าง
- error auth/policy ที่ชี้ว่ามีความเสี่ยงโดน block
- queue ค้างเกิน SLA ที่ธุรกิจกำหนด

### Rollback Steps (ใช้ได้ทันที)

1. สลับ `messaging_primary_provider=official_line`
2. คง `messaging_fallback_provider=unofficial_line` หรือปิด fallback ชั่วคราว
3. replay งานค้างจาก queue ตามลำดับเวลา
4. freeze ระบบและเปิด incident response
5. ออก RCA เบื้องต้นภายใน 24 ชั่วโมง
