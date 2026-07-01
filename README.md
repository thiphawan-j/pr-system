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
cp .env.example .env
```

3. เปิด PostgreSQL ด้วย Docker

```bash
docker compose up -d postgres
```

หมายเหตุ: โปรเจ็กนี้ map database ออกที่ `localhost:5433` เพื่อหลบพอร์ต `5432` ที่มักถูกใช้งานอยู่แล้ว

4. apply migration และ seed data

```bash
npm run db:migrate
npm run db:seed
```

5. เปิด dev server

```bash
npm run dev
```

จากนั้นเปิด `http://localhost:3000`

## คำสั่งที่ใช้บ่อย

```bash
npm run dev
npm run lint
npm run typecheck
npm run build
npm run db:generate
npm run db:studio
```

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
