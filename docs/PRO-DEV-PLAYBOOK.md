# 🛠️ Pro Dev Playbook — กระบวนการทำโปรเจคแบบมืออาชีพ ครบทุกขั้นตอน

> สรุปจากประสบการณ์จริงของโปรเจคนี้ (HUAY GO — multi-tenant SaaS) ว่ากว่าจะ "พร้อม production จริง"
> ต้องผ่านอะไรบ้าง — ใช้เป็น checklist กับโปรเจคอื่นได้ทันที
>
> **หลักคิดเดียวที่สำคัญที่สุด: โค้ดไม่ได้ดีเพราะใครเขียน แต่ดีเพราะ "พิสูจน์ได้"**
> ทุกข้อในนี้คือวิธีพิสูจน์ ไม่ใช่พิธีกรรม

---

## Phase 0 — ก่อนเขียนโค้ดบรรทัดแรก

| ต้องมี | ทำยังไง | ตัวอย่างจากโปรเจคนี้ |
|---|---|---|
| **Requirement ชัด** | เขียนเป็นข้อๆ ว่าระบบต้อง "ทำอะไรได้" + "ห้ามทำอะไร" | "ร้าน 2 ร้านต้องอยู่ร่วมกันโดยข้อมูลไม่รั่วถึงกัน" |
| **แผนเป็น Phase** | แบ่งงานใหญ่เป็นเฟสที่จบได้จริงทีละเฟส | Phase 1-6: schema → auth → API → UI → QA → deploy |
| **หาของที่มีอยู่แล้วก่อน** | ค้น library/pattern ที่คนใช้จริงมาก่อนเขียนเอง | ใช้ `promptpay-qr`, `zod`, `helmet` แทนเขียนเอง |
| **เลือก stack ตามงานไม่ตามเทรนด์** | ถามว่า "งานนี้ต้องการอะไรจริง" | SQLite ตอน dev / Postgres ตอน prod + ชั้นแปล SQL |

---

## Phase 1 — โครงสร้างโค้ด (Architecture)

```
✅ แยกชั้นชัดเจน:  routes → services → repositories → db
✅ ไฟล์เล็ก โฟกัสเดียว (200-400 บรรทัด, ไม่เกิน 800)
✅ Repository pattern — เปลี่ยน DB ได้โดยไม่แตะ business logic
✅ Config รวมที่เดียว (config.ts) — ห้ามอ่าน process.env กระจัดกระจาย
✅ Constants มีที่อยู่ — ห้าม hardcode เลขลอยๆ ในโค้ด
✅ Response format เดียวทั้งระบบ: { success, data, error }
```

**บทเรียนจริง:** business rule ที่เกี่ยวกับเงิน (validate โพย, เลขอั้น, เรทจ่าย) ต้องอยู่ที่เดียว
(`betCreation.service.ts`) แล้วให้ทุกทางเข้า (เว็บ/LINE/LIFF) เรียกผ่านตัวเดียวกัน —
ถ้า copy ไป 3 ที่ วันหนึ่งจะแก้ไม่ครบแล้วเงินรั่ว

---

## Phase 2 — ความปลอดภัย (ต้องมีทุกข้อ ไม่มีข้อยกเว้น)

### ระดับโค้ด
- [ ] **Parameterized query ทุกจุด** — ห้ามต่อ string เป็น SQL เด็ดขาด (กัน SQL injection)
- [ ] **Validate input ทุกทางเข้า** ด้วย schema (zod/joi) — fail fast พร้อมข้อความชัด
- [ ] **Server ไม่เชื่อ client** — ทุกอย่างที่เกี่ยวกับเงิน server ตรวจซ้ำเสมอ แม้ client ตรวจแล้ว
- [ ] **Password → bcrypt/argon2** เท่านั้น ห้ามเก็บ plain/md5
- [ ] **JWT มีวันหมดอายุ** + แยก role ชัด (admin/customer คนละ payload)
- [ ] **Error 5xx ห้าม leak รายละเอียดภายใน** — log เต็มฝั่ง server, ตอบ client ข้อความกลาง
- [ ] **Secret อยู่ใน env เท่านั้น** — สแกน repo ก่อน commit ทุกครั้งว่าไม่มี key หลุด

### ระดับ HTTP
- [ ] **helmet** (security headers) + **HSTS** บน production
- [ ] **CSP** บน frontend — ระบุว่าโหลด script/style/img จากไหนได้บ้าง
- [ ] **CORS allowlist** — ห้าม `origin: true` (ใครก็ยิง credentialed request ได้)
- [ ] **Rate limiting หลายชั้น**: global + เข้มพิเศษที่ login + public endpoints
- [ ] **Body size limit** (เช่น 1mb) กันยัด payload ยักษ์
- [ ] **Webhook ตรวจ HMAC signature เสมอ** (เช่น x-line-signature)

### ระดับ multi-tenant (ถ้าเป็น SaaS)
- [ ] ทุก query มี `shop_id/tenant_id` ใน WHERE — **แล้วเขียน test พิสูจน์ว่าข้ามร้านไม่ได้**
- [ ] Credentials ต่อร้านเข้ารหัสที่ rest (AES-256-GCM)

**บทเรียนจริง:** เจอ bug production ที่มองไม่เห็นจาก localhost — rate limit ต่อ IP ใช้ไม่ได้จริง
เพราะทุก request ผ่าน Cloudflare proxy มาด้วย IP เดียวกัน ต้องส่ง IP จริง + shared secret มาจาก proxy
**→ ความปลอดภัยต้องทดสอบบน "โครงสร้างจริง" ไม่ใช่แค่เครื่องตัวเอง**

---

## Phase 3 — Testing (สิ่งที่แยกมือโปรออกจากมือสมัครเล่น)

```
✅ Unit tests        — logic เงิน/การคำนวณ ทุก edge case (เช่น checkWin 22 เคส)
✅ Integration tests — API + DB จริง (in-memory) ไม่ใช่ mock ทั้งดุ้น
✅ Isolation tests   — พิสูจน์ว่า tenant A มองไม่เห็นข้อมูล tenant B (12 เคส)
✅ รันเร็ว (< 5 วิ)   — ช้าแล้วคนจะเลิกรัน
✅ รันทุกครั้งก่อน commit — ไม่มีข้อยกเว้น
```

**กฎเหล็ก:** แก้โค้ดเสร็จ → `tsc --noEmit` + `npm test` + `npm run build` **ทั้งสามตัวต้องเขียว**
ก่อน commit เสมอ — โปรเจคนี้เจอ bug จาก build จริง (`.sql` ไม่ถูก copy เข้า dist) ที่ dev mode
มองไม่เห็นมาหลายเดือน เพราะไม่เคยรัน production build จริง

---

## Phase 4 — Performance (วัดจริง ห้ามเดา)

### เครื่องมือ + วิธี
```bash
# วัด latency รายเส้น
curl -w "%{time_total}s" <endpoint>

# ยิง load test จริง (100 connections พร้อมกัน)
npx autocannon -c 100 -d 10 -H "User-Agent: Mozilla/5.0" <endpoint>
```

### หลักการที่ใช้จริงในโปรเจคนี้
| เทคนิค | ใช้ตรงไหน | ผล |
|---|---|---|
| **SWR cache + single-flight** | ข้อมูลจาก external API | ตอบจาก cache ทันที refresh เบื้องหลัง |
| **Cache warmup เป็นรอบ** | อุ่น cache ทุก 2 นาที | request แรกหลังช่วงเงียบไม่ต้องรอ external |
| **อย่าบล็อกด้วยของที่รอได้** | เลขอั้นส่งตามหลัง (`bannedPending`) | หน้าแทงจาก 1-5 วิ → 0.17 วิ |
| **Fire-and-forget งานหนัก** | sync ประวัติย้อนหลัง | ไม่ block response |
| **Index ทุกทางเข้า query** | bets(created_date/customer/round) | ตาราง log p99 = 67ms ที่ 100 concurrent |
| **Lazy load + code split** | React lazy ทุก page | LIFF chunk เหลือ 10KB gzip |
| **Immutable cache assets** | `Cache-Control: immutable` | โหลดซ้ำ = 0 network |

### เกณฑ์ผ่าน
- ทุก endpoint ที่ user รอ < **0.5 วิ**
- Load test ที่ concurrency เป้าหมาย ×3 เท่า → **ศูนย์ error**
- อ่านผล p99 ไม่ใช่ average (average โกหกเก่ง)

---

## Phase 5 — Database ระยะยาว

- [ ] **Migration เป็นสคริปต์ idempotent** — รันซ้ำได้ไม่พัง, มีทั้ง dev (SQLite) และ prod (Postgres)
- [ ] **ระวังลำดับ migration** — บทเรียนจริง: ALTER ก่อนตาราง rebuild = คอลัมน์หายใน DB ใหม่ (test จับได้)
- [ ] **Backfill ข้อมูลเก่าเสมอ** เมื่อเพิ่มคอลัมน์ที่มีความหมาย (source ของโพยเก่า)
- [ ] **Index ตั้งแต่วันแรก** ตาม query จริง ไม่ใช่ตั้งมั่ว
- [ ] **Audit columns**: created_at ทุกตาราง — เงินทุกบาทต้องตามรอยได้
- [ ] **ห้ามลบข้อมูลเงินจริง** — ใช้ status (cancelled/refunded) แทน DELETE
- [ ] **Backup + ทดสอบ restore** — backup ที่ไม่เคย restore = ไม่มี backup
- [ ] คิดเลขความโต: แถว/วัน × 365 → รู้ว่าอีกกี่ปีต้อง archive

---

## Phase 6 — Deploy อย่างเป็นระบบ

```
1. git commit ข้อความอธิบาย "ทำไม" ไม่ใช่แค่ "ทำอะไร"  (conventional commits)
2. push GitHub — โค้ดทุกบรรทัดมีประวัติ ย้อนได้
3. deploy backend + frontend
4. ตรวจ production ทันทีหลัง deploy:
   - health endpoint ตอบ ok
   - feature ใหม่อยู่บน prod จริง (เช็ค endpoint/chunk ใหม่)
   - security headers ครบ (curl -I)
5. ถ้าพัง → rollback ก่อน แก้ทีหลัง
```

**บทเรียนจริง:** โปรเจค Cloudflare Pages หายไปเฉยๆ ต้องสร้างใหม่ —
**จดทุกอย่างเกี่ยวกับ infra ไว้เป็นเอกสาร** (project id, env vars ที่ต้องมี, คำสั่ง deploy)
เพราะวันที่ต้อง rebuild จะไม่มีเวลานั่งนึก

---

## Phase 7 — หลัง Deploy (ที่คนส่วนใหญ่ข้าม)

- [ ] **Structured logging (JSON)** + **request ID** ทุก response — ตามรอยปัญหาข้ามระบบได้
- [ ] **Uptime monitor** (UptimeRobot ฟรี) — รู้ก่อนลูกค้าบ่น
- [ ] **Graceful shutdown** — ปิด server แบบรอ request ค้างจบก่อน
- [ ] **Fail fast ตอน boot** — secret ไม่ครบ = ไม่ยอม start (ดีกว่าไปตายตอนลูกค้าจ่ายเงิน)
- [ ] **Ops knobs ผ่าน env** — ปรับ rate limit ได้โดยไม่ต้อง deploy ใหม่

---

## Phase 8 — วินัยที่ทำให้โค้ดไม่เน่า

| วินัย | ความถี่ |
|---|---|
| ลบ dead code / unused exports | ทุกครั้งที่เจอ อย่าสะสม |
| อ่าน dependency ว่าใช้จริงไหม | ก่อนเพิ่มทุกตัว |
| Comment อธิบาย "ทำไม" ไม่ใช่ "ทำอะไร" | ตอนเขียน |
| เอกสารการตัดสินใจสำคัญ (ทำไมเลือก X ไม่เลือก Y) | ตอนตัดสินใจ |
| Refactor เมื่อไฟล์เกิน 800 บรรทัด | ทันที |

---

## 🎯 สรุป 5 ข้อถ้าจำได้แค่ 5 ข้อ

1. **พิสูจน์ ไม่ใช่เชื่อ** — tests เขียว + load test + วัด latency จริง คือใบรับรองเดียวที่นับ
2. **Server ไม่เชื่อใครทั้งนั้น** — validate ทุก input, ตรวจเงินซ้ำทุกครั้ง, ทุก query ผูก tenant
3. **วัดบนโครงสร้างจริง** — bug ที่แพงที่สุดคือตัวที่ localhost มองไม่เห็น (proxy IP, prod build, Postgres vs SQLite)
4. **อย่าให้ user รอของที่รอได้** — cache + async + ส่งตามหลัง = เร็วโดยไม่เสียความถูกต้อง
5. **จดทุกอย่าง** — commit message ดี, infra doc, migration idempotent — ตัวคุณอีก 6 เดือนคือคนแปลกหน้า

---
*อ้างอิงผลจริงของโปรเจคนี้: tests 138/138 · betinfo 1-5s → 0.17s · load test 2,812 req/s (อ่าน) / 550 โพย/s (เขียน) ที่ 100 concurrent, ศูนย์ error*
