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
```

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
