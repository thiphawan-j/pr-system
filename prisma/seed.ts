import { hashSync } from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";

import {
  ApprovalAction,
  NotificationType,
  Priority,
  PrismaClient,
  PurchaseRequestStatus,
  Role,
} from "@prisma/client";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("Missing DATABASE_URL environment variable");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg(
    new Pool({
      connectionString: databaseUrl,
    }),
  ),
});

const demoPassword = hashSync("Passw0rd!", 10);

async function main() {
  await prisma.notification.deleteMany();
  await prisma.approval.deleteMany();
  await prisma.purchaseRequestItem.deleteMany();
  await prisma.purchaseRequest.deleteMany();
  await prisma.user.deleteMany();

  const [employee, approver, purchasing, admin, employee2] =
    await prisma.$transaction([
      prisma.user.create({
        data: {
          employeeCode: "EMP001",
          name: "สมชาย ใจดี",
          username: "somchai",
          phone: "0811111111",
          email: "employee@demo.local",
          passwordHash: demoPassword,
          department: "Operations",
          role: Role.EMPLOYEE,
          title: "เจ้าหน้าที่ปฏิบัติการ",
        },
      }),
      prisma.user.create({
        data: {
          employeeCode: "APR001",
          name: "วิภา ผู้อนุมัติ",
          username: "wipa",
          phone: "0811111112",
          email: "approver@demo.local",
          passwordHash: demoPassword,
          department: "Operations",
          role: Role.APPROVER,
          title: "ผู้จัดการแผนก",
        },
      }),
      prisma.user.create({
        data: {
          employeeCode: "PUR001",
          name: "กิตติ จัดซื้อ",
          username: "kitti",
          phone: "0811111113",
          email: "purchasing@demo.local",
          passwordHash: demoPassword,
          department: "Purchasing",
          role: Role.PURCHASING,
          title: "เจ้าหน้าที่จัดซื้อ",
        },
      }),
      prisma.user.create({
        data: {
          employeeCode: "ADM001",
          name: "ผู้ดูแลระบบ",
          username: "admin",
          phone: "0811111114",
          email: "admin@demo.local",
          passwordHash: demoPassword,
          department: "Admin",
          role: Role.ADMIN,
          title: "System Administrator",
        },
      }),
      prisma.user.create({
        data: {
          employeeCode: "EMP002",
          name: "อรทัย โครงการ",
          username: "orathai",
          phone: "0811111115",
          email: "employee2@demo.local",
          passwordHash: demoPassword,
          department: "Projects",
          role: Role.EMPLOYEE,
          title: "วิศวกรโครงการ",
        },
      }),
    ]);

  const firstRequest = await prisma.purchaseRequest.create({
    data: {
      prNumber: "PR-202606-0001",
      requestDate: new Date("2026-06-03T09:00:00.000Z"),
      requesterId: employee.id,
      currentApproverId: purchasing.id,
      department: "Operations",
      reason: "จัดซื้ออุปกรณ์สำนักงานสำหรับทีมปฏิบัติการใหม่",
      urgency: Priority.HIGH,
      status: PurchaseRequestStatus.APPROVED,
      totalAmount: 27500,
      submittedAt: new Date("2026-06-03T09:30:00.000Z"),
      approvedAt: new Date("2026-06-03T11:00:00.000Z"),
      items: {
        create: [
          {
            itemName: "Notebook 14 นิ้ว",
            description: "สำหรับพนักงานใหม่ 1 เครื่อง",
            supplierName: "IT City",
            quantity: 1,
            unit: "เครื่อง",
            unitPrice: 24000,
            amount: 24000,
          },
          {
            itemName: "Wireless Mouse",
            description: "อุปกรณ์ประกอบการใช้งาน",
            supplierName: "OfficeMate",
            quantity: 2,
            unit: "ชิ้น",
            unitPrice: 1750,
            amount: 3500,
          },
        ],
      },
      approvals: {
        create: [
          {
            approverId: employee.id,
            action: ApprovalAction.SUBMITTED,
            stepLabel: "ผู้ขอซื้อ",
            comment: "ต้องการใช้งานภายในสัปดาห์นี้",
            createdAt: new Date("2026-06-03T09:30:00.000Z"),
          },
          {
            approverId: approver.id,
            action: ApprovalAction.APPROVED,
            stepLabel: "หัวหน้าแผนก",
            comment: "อนุมัติตามงบประมาณที่ได้รับ",
            createdAt: new Date("2026-06-03T11:00:00.000Z"),
          },
        ],
      },
    },
  });

  const secondRequest = await prisma.purchaseRequest.create({
    data: {
      prNumber: "PR-202606-0002",
      requestDate: new Date("2026-06-08T13:00:00.000Z"),
      requesterId: employee2.id,
      currentApproverId: approver.id,
      department: "Projects",
      reason: "ขอซื้อวัสดุสำหรับเตรียมพื้นที่หน้างาน",
      urgency: Priority.URGENT,
      status: PurchaseRequestStatus.PENDING_APPROVAL,
      totalAmount: 18900,
      submittedAt: new Date("2026-06-08T13:20:00.000Z"),
      items: {
        create: [
          {
            itemName: "Safety Helmet",
            description: "หมวกนิรภัยสำหรับทีมภาคสนาม",
            supplierName: "Safety First",
            quantity: 6,
            unit: "ใบ",
            unitPrice: 650,
            amount: 3900,
          },
          {
            itemName: "Portable Barrier",
            description: "แผงกั้นพื้นที่ชั่วคราว",
            supplierName: "Thai Safety Supply",
            quantity: 5,
            unit: "ชุด",
            unitPrice: 3000,
            amount: 15000,
          },
        ],
      },
      approvals: {
        create: [
          {
            approverId: employee2.id,
            action: ApprovalAction.SUBMITTED,
            stepLabel: "ผู้ขอซื้อ",
            comment: "ขอใช้ภายใน 48 ชั่วโมง",
            createdAt: new Date("2026-06-08T13:20:00.000Z"),
          },
        ],
      },
    },
  });

  await prisma.notification.createMany({
    data: [
      {
        userId: approver.id,
        title: "มี PR ใหม่รออนุมัติ",
        message: `${secondRequest.prNumber} จากแผนก ${secondRequest.department}`,
        link: `/purchase-requests/${secondRequest.id}`,
        type: NotificationType.INFO,
      },
      {
        userId: employee.id,
        title: "PR ได้รับการอนุมัติแล้ว",
        message: `${firstRequest.prNumber} พร้อมส่งต่อให้ฝ่ายจัดซื้อ`,
        link: `/purchase-requests/${firstRequest.id}`,
        type: NotificationType.SUCCESS,
      },
      {
        userId: purchasing.id,
        title: "PR พร้อมดำเนินการสั่งซื้อ",
        message: `${firstRequest.prNumber} ได้รับการอนุมัติครบถ้วน`,
        link: `/purchase-requests/${firstRequest.id}`,
        type: NotificationType.INFO,
      },
      {
        userId: admin.id,
        title: "Seed Data พร้อมใช้งาน",
        message: "ระบบตัวอย่างถูกสร้างพร้อมข้อมูลสาธิตแล้ว",
        link: "/dashboard",
        type: NotificationType.SUCCESS,
      },
    ],
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
