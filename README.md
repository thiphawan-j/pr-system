# PR Flow

ระบบ Purchase Request Management สำหรับองค์กร พร้อม workflow อนุมัติ, dashboard, notifications และรายงานส่งออก

## Tech Stack

- Next.js 15 App Router
- TypeScript
- Tailwind CSS
- shadcn/ui
- Prisma ORM
- PostgreSQL
- Zod

## ฟีเจอร์หลัก

- Login / Logout ด้วย JWT cookie รองรับ `email`, `username` และ `phone`
- Role Based Access Control: `Employee`, `Approver`, `Purchasing`, `Admin`
- Dashboard สรุป PR รออนุมัติ, อนุมัติแล้ว, ถูกปฏิเสธ และมูลค่ารวม
- สร้าง/แก้ไข Purchase Request พร้อมคำนวณยอดรวมอัตโนมัติ
- Approval Workflow: Draft, Pending Approval, Approved, Rejected, Ordered, Completed
- รับสินค้าแยกรายการได้หลายรอบ รองรับรับเกินพร้อมเหตุผล และปิดยอดค้างรับที่ไม่รับต่อ
- Notification Bell สำหรับเหตุการณ์สำคัญ
- Reports แยกตามเดือน, แผนก และผู้ขอซื้อ
- Export Excel และ PDF
- รองรับภาษาไทย, Dark Mode และ responsive ทุกหน้าจอ

## เริ่มต้นใช้งาน

1. ติดตั้ง dependencies

```bash
npm install
```

2. เตรียม environment

```bash
cp .env.dev.example .env.dev
```

ไฟล์ env จริงถูก ignore จาก Git ทั้งหมด ให้เก็บ secret ในไฟล์เหล่านี้เท่านั้น:

```bash
.env.dev
.env.uat
.env.prod
```

ไฟล์ template ที่ commit ได้คือ:

```bash
.env.dev.example
.env.uat.example
.env.prod.example
.env.example
```

3. เปิด PostgreSQL ด้วย Docker

```bash
docker compose up -d postgres
```

หมายเหตุ: โปรเจ็กนี้ map database ออกที่ `localhost:5433` เพื่อหลบพอร์ต `5432` ที่มักถูกใช้งานอยู่แล้ว

4. apply migration และ seed data

```bash
npm run db:migrate:dev
npm run db:seed:dev
```

5. เปิด dev server

```bash
npm run dev
```

จากนั้นเปิด `http://localhost:3000`

## คำสั่งที่ใช้บ่อย

```bash
npm run dev
npm run dev:uat
npm run lint
npm run typecheck
npm run build
npm run build:dev
npm run build:uat
npm run build:prod
npm run db:generate
npm run db:deploy
npm run db:deploy:uat
npm run db:deploy:prod
npm run db:studio
```

## Environment Files

โปรเจ็กต์นี้แยก env เป็น 3 ชุด:

- `dev`: ใช้ `.env.dev` และ optional override `.env.dev.local`
- `uat`: ใช้ `.env.uat` และ optional override `.env.uat.local`
- `prod`: ใช้ `.env.prod` และ optional override `.env.prod.local`

ลำดับการโหลดของ helper script คือ `.env` -> `.env.<env>` -> `.env.<env>.local` โดยค่า environment ที่มาจาก shell, GitHub Actions หรือ Vercel จะชนะไฟล์ local เสมอ

ตัวอย่างการใช้งาน:

```bash
npm run dev
npm run build:uat
npm run db:deploy:prod
```

## CI/CD และ Deployment

โปรเจ็กต์นี้เตรียม GitHub Actions ไว้ 2 workflow:

- `CI`: รันเมื่อเปิด PR, push เข้า `main` หรือกด manual โดยจะติดตั้ง dependencies, เปิด PostgreSQL service, รัน `typecheck`, `lint`, `build` และ E2E tests
- `Deploy to Vercel`: รัน production deploy อัตโนมัติหลัง `CI` บน `main` ผ่าน หรือกด manual ได้จาก GitHub Actions

ต้องตั้งค่า GitHub repository secrets เหล่านี้ก่อน deploy:

```bash
VERCEL_TOKEN=...
VERCEL_ORG_ID=...
VERCEL_PROJECT_ID=...
DATABASE_URL=...
```

และต้องตั้งค่า Environment Variables ใน Vercel สำหรับ runtime:

```bash
DATABASE_URL=...
JWT_SECRET=...
APP_URL=https://your-production-domain
EMAIL_PROVIDER=google_apps_script
GOOGLE_MAIL_WEBHOOK_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
GOOGLE_MAIL_WEBHOOK_SECRET=replace-with-a-long-random-secret
EMAIL_FROM_NAME="PR Flow"
```

ถ้าตั้งค่า `EMAIL_PROVIDER`, `GOOGLE_MAIL_WEBHOOK_URL`, `GOOGLE_MAIL_WEBHOOK_SECRET` และ `EMAIL_FROM_NAME` ระบบจะส่งอีเมลตาม notification ผ่าน Google Apps Script HTTPS gateway ให้อัตโนมัติ หากยังตั้งค่าไม่ครบ ระบบจะสร้าง notification ในแอปตามเดิมโดยกำหนดสถานะอีเมลเป็น `DISABLED`

ขั้นตอน deploy production ใน workflow คือ:

1. `vercel pull --environment=production`
2. `npm run db:deploy` เพื่อ apply Prisma migrations กับ production database
3. `vercel build --prod`
4. `vercel deploy --prebuilt --prod`

หมายเหตุ: ไฟล์แนบปัจจุบันบันทึกลง filesystem local ในโฟลเดอร์ `storage/` ถ้าจะใช้งาน production บน serverless platform ควรเปลี่ยนเป็น persistent object storage ก่อนใช้งานไฟล์แนบจริงจัง

## บัญชีตัวอย่าง

- `employee@demo.local` | `somchai` | `0811111111` / `Passw0rd!`
- `approver@demo.local` | `wipa` | `0811111112` / `Passw0rd!`
- `purchasing@demo.local` | `kitti` | `0811111113` / `Passw0rd!`
- `admin@demo.local` | `admin` | `0811111114` / `Passw0rd!`
- `management@demo.local` | `management` | `0811111116` / `Passw0rd!`

## โครงสร้างสำคัญ

- `src/app` หน้า UI และ Route Handlers
- `src/components` UI components และ layout shell
- `src/server` auth, services, DAL และ business rules
- `prisma/schema.prisma` schema หลัก
- `prisma/seed.ts` demo data
- `docker-compose.yml` local PostgreSQL

## การตรวจสอบที่รันแล้ว

- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm run db:migrate`
- `npm run db:seed`
- `npx prisma migrate status`

## หมายเหตุ

- สำหรับ Prisma 7 โปรเจ็กนี้ใช้ `@prisma/adapter-pg` ร่วมกับ `pg` เพื่อเชื่อม PostgreSQL ใน runtime
- PDF export ฝังฟอนต์ไทยจาก local package เพื่อให้ build และ export ทำงานได้โดยไม่ต้องดึง Google Fonts ระหว่าง build

## แชร์ลิงก์ PR

- เปิดหน้ารายละเอียด PR แล้วกด **แชร์ PR** เพื่อคัดลอกลิงก์ส่งให้ฝ่ายจัดซื้อหรือผู้อนุมัติ หรือเลือกแชร์ผ่านแอปบนอุปกรณ์เมื่อเบราว์เซอร์รองรับ
- หากเบราว์เซอร์ไม่อนุญาตให้คัดลอกอัตโนมัติ สามารถเลือกข้อความในช่องลิงก์และคัดลอกเองได้
- ผู้รับต้องล็อกอินด้วยบัญชีที่มีสิทธิ์ดู PR ใบนั้น หากยังไม่ล็อกอิน ระบบจะกลับมาที่ PR เดิมหลังเข้าสู่ระบบสำเร็จ ลิงก์ไม่เพิ่มสิทธิ์และไม่มี token สำหรับข้ามการล็อกอิน

## การรับสินค้าหลายรอบและปิดยอดค้างรับ

ก่อนใช้ฟีเจอร์นี้ ให้รัน migration ล่าสุดด้วย `npm run db:deploy` ใน environment ที่ต้องการอัปเดต ข้อมูลที่ยืนยันรับของในระบบเดิมจะถูกนำเข้าเป็นประวัติรับเต็มจำนวนหนึ่งรอบ โดยคงวันที่และเลขเอกสารเดิมไว้

- หลังเปิด PO ผู้ที่มีสิทธิ์ดู PR สามารถบันทึกวันที่และจำนวนรับจริงแยกรายการในแต่ละรอบได้ จำนวนรับต้องเป็นจำนวนเต็มมากกว่า 0
- แต่ละรายการแสดงจำนวนสั่งเดิม จำนวนรับสะสม จำนวนปิดยอดค้างรับ ยอดค้างรับ และยอดรับเกิน โดยยอดค้างรับไม่ติดลบ และการรับจริงไม่แก้จำนวนสั่งเดิม
- หากรับสะสมเกินจำนวนสั่ง ต้องระบุเหตุผลรับเกิน สามารถบันทึกยอดเกินหลังรับครบได้จนกว่าจะปิด PR
- เมื่อรับสินค้าแล้วบางส่วน ฝ่ายจัดซื้อหรือแอดมินสามารถปิดยอดที่ไม่รับต่อได้ พร้อมระบุจำนวนและเหตุผล จำนวนที่ปิดต้องไม่เกินยอดค้างรับ และรับเพิ่มเกินยอดค้างรับของรายการที่ปิดบางส่วนแล้วไม่ได้
- ระบบเก็บประวัติแต่ละรอบพร้อมผู้บันทึก วันที่ จำนวน เหตุผล และเลขเอกสาร สามารถบันทึกเลขรับของหรือเลขใบกำกับภาษีแยกแต่ละรอบได้
- ปิด PR ได้เมื่อทุกรายการไม่มียอดค้างรับ และทุกรอบที่รับสินค้ามีเลขรับของหรือเลขใบกำกับภาษีอย่างน้อยหนึ่งรายการ รายการปิดยอดค้างรับไม่ต้องมีเอกสารรับของ
- เมื่อมีการรับสินค้าแล้ว แม้ยังรับไม่ครบ จะยกเลิก PR ทั้งใบไม่ได้ ให้ปิดเฉพาะยอดที่ไม่รับต่อเพื่อคงประวัติสินค้าที่รับจริง
- การบันทึกแต่ละครั้งตรวจเวอร์ชันข้อมูล หากมีคนอื่นบันทึกก่อน ระบบจะให้โหลดข้อมูลใหม่เพื่อป้องกันยอดรับซ้ำ

ตัวอย่าง: สั่ง 100 ชิ้น → รับ 40 ชิ้น → รับอีก 30 ชิ้น → ปิดส่วนที่ไม่รับต่อ 30 ชิ้น ผลลัพธ์คือรับจริง 70 ชิ้น ปิดยอดค้างรับ 30 ชิ้น และยอดค้างรับ 0 ชิ้น

ชุดทดสอบรับสินค้าแบ่งตามพฤติกรรมที่ต้องตรวจ โดยใช้ฐานข้อมูลทดสอบที่ชื่อลงท้าย `_e2e` เท่านั้น:

| ไฟล์ใน `tests/e2e/` | ขอบเขตที่ตรวจ |
| --- | --- |
| `purchase-request-receipts.spec.ts` | รับหลายรอบ รับเกิน ปิดยอดค้าง เอกสารแต่ละรอบ และ workflow ผ่านหน้าจอ |
| `purchase-request-receipt-access.spec.ts` | สิทธิ์ผู้ใช้ การเข้าถึง PR ของผู้อื่น สถานะก่อนรับ/หลังปิดงาน และ API เดิม |
| `purchase-request-receipt-validation.spec.ts` | หลายรายการต้องสำเร็จหรือถูกปฏิเสธทั้งชุด ขอบเขตจำนวน/เหตุผล วันที่ และยอดที่ปิดบางส่วน |
| `purchase-request-receipt-concurrency.spec.ts` | บันทึกรับแข่งกับปิดยอด ยกเลิก PO ปิด PR และแก้เลขเอกสาร รวมถึงการส่งคำสั่งเดิมซ้ำ |
| `purchase-request-receipt-ui.spec.ts` | ตัวกรอง คิว dashboard สิทธิ์บนหน้าจอ ประวัติหลัง reload ภาษาไทย/อังกฤษ และการกู้คืนฟอร์มเมื่อข้อมูลเปลี่ยน |

รันทั้งโครงการด้วย `npm run test:e2e` หรือรันเฉพาะส่วนรับสินค้าด้วย `npm run test:e2e -- purchase-request-receipt` การทดสอบ API ใช้การล็อกอินผ่าน API เพื่อเตรียม session ส่วนกรณี UI ใช้ browser ทดสอบปุ่ม ฟอร์ม การแจ้งเตือน และการแสดงผลจริง ชุด authentication เดิมยังทดสอบการล็อกอินผ่านหน้าจอแยกต่างหาก

## แปลง PR เป็นใบสั่งซื้อ (PO)

หลังรัน migration ล่าสุดด้วย `npm run db:deploy` ฝ่ายจัดซื้อหรือแอดมินสามารถเปิด PR ที่อนุมัติแล้วและเลือก **แปลง PR เป็น PO** ได้

- ระบุผู้ขายของสินค้าแต่ละรายการ ระบบรวมรายการของผู้ขายเดียวกันเป็น PO ใบเดียว และออกหลาย PO เมื่อมีหลายผู้ขาย โดยสามารถปรับผู้ขายจากข้อมูลแนะนำใน PR ได้
- กรอกที่อยู่และข้อมูลติดต่อผู้ขาย สถานที่ส่งสินค้า เงื่อนไขชำระเงิน วันที่คาดว่าจะส่ง และหมายเหตุแยกแต่ละผู้ขายได้
- ทุกรายการใน PR ต้องถูกจัดเข้า PO ครบและไม่ซ้ำกัน ระบบใช้จำนวนและราคาที่อนุมัติแล้ว พร้อมเก็บสำเนาชื่อสินค้า รายละเอียด หน่วย ราคา และยอดรวมในเอกสาร PO
- เมื่อสร้างสำเร็จ ระบบออกเลข PO แยกแต่ละใบและเปลี่ยน PR เป็น **สั่งซื้อแล้ว** ภายในธุรกรรมเดียวกัน การส่งซ้ำหรือสร้างพร้อมกันจะไม่ออก PO ชุดที่สองให้ PR เดิม
- หน้ารายละเอียด PR แสดงลิงก์ไปยัง PO แต่ละใบ ผู้ที่มีสิทธิ์ดู PR สามารถเปิด PO ที่เกี่ยวข้องได้ และใช้ **พิมพ์ / บันทึก PDF** ผ่านหน้าต่างพิมพ์ของเบราว์เซอร์
- การรับสินค้าและปิดยอดค้างรับยังบันทึกที่ PR สามารถย้อนกลับไปติดตามยอดรับผ่านลิงก์ PR บนเอกสาร PO ได้ โดยคงจำนวนสั่งและมูลค่าใน PO ไว้ สถานะปัจจุบันและการยกเลิกอ้างอิง PR ต้นทางเพื่อให้ตรวจย้อนหลังได้
- ปุ่ม **อนุมัติเปิด PO** เดิมยังใช้ยืนยันการสั่งซื้อที่จัดทำในระบบภายนอกได้ การยืนยันแบบเดิมเปลี่ยนสถานะ PR โดยไม่สร้างเอกสาร PO ภายในย้อนหลัง

ชุดทดสอบ `tests/e2e/purchase-orders.spec.ts` ตรวจการแยกผู้ขายและยอดรวม สิทธิ์เข้าถึง ข้อมูลต้นทาง รายการขาด/ซ้ำ/ต่าง PR การบันทึกพร้อมกัน การยกเลิก การรับสินค้า และการสร้าง/พิมพ์ PO ผ่านหน้าจอ รันเฉพาะส่วนนี้ด้วย `npm run test:e2e -- purchase-orders.spec.ts` โดยใช้ฐานข้อมูลทดสอบที่ชื่อลงท้าย `_e2e` เท่านั้น

## ทะเบียนผู้ขายและช่องทางติดต่อ

หลังรัน migration ล่าสุด ฝ่ายจัดซื้อและแอดมินสามารถเปิดเมนู **ทะเบียนผู้ขาย** เพื่อเพิ่มหรือแก้ไขข้อมูลผู้ขายได้ ระบบออกเลข `SUP-00001` ให้อัตโนมัติ พร้อมเก็บชื่อ เลขประจำตัวผู้เสียภาษี ที่อยู่ ผู้ติดต่อ เงื่อนไขชำระเงิน และหมายเหตุ

- เลือกช่องทางติดต่อได้ตั้งแต่ 1 ถึง 5 ช่องทาง ได้แก่ **LINE**, **โทรศัพท์**, **อีคอมเมิร์ซ**, **อีเมล** และ **อื่น ๆ** โดยเลือกหลายช่องทางพร้อมกันได้ แต่ละช่องทางต้องมีรายละเอียดและไม่ซ้ำกัน เช่น LINE ID เบอร์โทร หรือ URL ร้านค้า
- ค้นหาผู้ขายด้วยรหัส ชื่อ เลขภาษี ผู้ติดต่อ หรือรายละเอียดช่องทางติดต่อได้ พร้อมตัวกรองเปิดใช้งาน/ปิดใช้งาน และการแบ่งหน้า
- ปิดใช้งานผู้ขายที่ไม่ใช้แล้วแทนการลบ เพื่อคงประวัติเอกสารไว้ สามารถเปิดใช้งานอีกครั้งได้ และระบบตรวจเวอร์ชันขณะแก้ไขเพื่อป้องกันข้อมูลของผู้แก้ไขพร้อมกันทับกัน
- ตอนแปลง PR เป็น PO ใช้ช่องผู้ขายช่องเดียวเพื่อพิมพ์ค้นหาชื่อหรือรหัสแล้วเลือกผู้ขายจากทะเบียน หรือพิมพ์ชื่อผู้ขายใหม่ได้เลย หากเลือกจากทะเบียน ระบบเติมข้อมูลและช่องทางติดต่อทุกช่องทางให้โดยอัตโนมัติ ส่วนสถานที่ส่ง วันที่ส่ง และหมายเหตุของ PO ยังกรอกแยกได้ การพิมพ์ชื่อเองไม่เพิ่มทะเบียนผู้ขายอัตโนมัติ
- ระบบใช้ข้อมูลทะเบียนล่าสุดตอนออก PO และเก็บเป็นสำเนาในเอกสาร การแก้ไขหรือปิดใช้งานผู้ขายภายหลังไม่เปลี่ยนข้อมูลใน PO ที่ออกแล้ว ผู้ขายที่ปิดใช้งานไม่สามารถใช้สร้าง PO ใหม่ได้
- การสร้าง PO ด้วยข้อมูลผู้ขายที่กรอกเองยังใช้งานได้ และไม่สร้างทะเบียนผู้ขายขึ้นอัตโนมัติ

ชุดทดสอบ `tests/e2e/suppliers.spec.ts` ตรวจสิทธิ์ ทะเบียนหลายช่องทาง การค้นหา/แบ่งหน้า การแก้ไขพร้อมกัน การเปิด/ปิดใช้งาน ข้อมูลสำเนาใน PO การสร้าง PO จากทะเบียน และฟอร์มภาษาไทย/อังกฤษ รันเฉพาะส่วนนี้ด้วย `npm run test:e2e -- suppliers.spec.ts` โดยใช้ฐานข้อมูลทดสอบที่ชื่อลงท้าย `_e2e` เท่านั้น
