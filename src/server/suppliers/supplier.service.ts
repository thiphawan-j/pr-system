import "server-only";

import { Prisma } from "@prisma/client";
import { toBangkokIsoString } from "@/lib/format";
import { supplierContactChannels, type SessionUser, type SupplierDetail, type SupplierListPage } from "@/lib/types";
import { assertRole } from "@/server/auth/authorization";
import { getDb } from "@/server/db";
import { AppError, invariant } from "@/server/shared/errors";
import type { CreateSupplierInput, SupplierFilters, UpdateSupplierInput } from "@/server/suppliers/supplier.schemas";

const supplierInclude = { contacts: { orderBy: { channel: "asc" } } } satisfies Prisma.SupplierInclude;

export function formatSupplierCode(code: number) {
  return `SUP-${String(code).padStart(5, "0")}`;
}

function toSupplierDetail(supplier: Prisma.SupplierGetPayload<{ include: typeof supplierInclude }>): SupplierDetail {
  return {
    id: supplier.id,
    code: formatSupplierCode(supplier.code),
    name: supplier.name,
    taxId: supplier.taxId,
    address: supplier.address,
    contactPerson: supplier.contactPerson,
    paymentTerms: supplier.paymentTerms,
    note: supplier.note,
    isActive: supplier.isActive,
    version: supplier.version,
    createdAt: toBangkokIsoString(supplier.createdAt),
    updatedAt: toBangkokIsoString(supplier.updatedAt),
    contacts: supplier.contacts.map(({ channel, value }) => ({ channel, value }))
      .sort((a, b) => supplierContactChannels.indexOf(a.channel) - supplierContactChannels.indexOf(b.channel)),
  };
}

export async function listSuppliersPage(session: SessionUser, filters: Partial<SupplierFilters> = {}): Promise<SupplierListPage> {
  assertRole(session, ["PURCHASING", "ADMIN"]);
  const { page = 1, limit = 20, query, status = "ALL" } = filters;
  const codeMatch = query?.match(/^(?:SUP-)?0*(\d+)$/i);
  const code = codeMatch ? Number(codeMatch[1]) : undefined;
  const where: Prisma.SupplierWhereInput = {
    ...(status !== "ALL" ? { isActive: status === "ACTIVE" } : {}),
    ...(query ? { OR: [
      { name: { contains: query, mode: "insensitive" } },
      { taxId: { contains: query, mode: "insensitive" } },
      { contactPerson: { contains: query, mode: "insensitive" } },
      { contacts: { some: { value: { contains: query, mode: "insensitive" } } } },
      ...(code !== undefined && Number.isSafeInteger(code) && code <= 2147483647 ? [{ code }] : []),
    ] } : {}),
  };
  const db = getDb();
  const [totalCount, suppliers] = await db.$transaction([
    db.supplier.count({ where }),
    db.supplier.findMany({ where, include: supplierInclude, orderBy: { code: "desc" }, skip: (page - 1) * limit, take: limit }),
  ]);
  return { items: suppliers.map(toSupplierDetail), page, limit, totalCount, totalPages: Math.ceil(totalCount / limit) };
}

export async function listActiveSuppliers(session: SessionUser): Promise<SupplierDetail[]> {
  assertRole(session, ["PURCHASING", "ADMIN"]);
  const suppliers = await getDb().supplier.findMany({
    where: { isActive: true }, include: supplierInclude, orderBy: [{ name: "asc" }, { code: "asc" }],
  });
  return suppliers.map(toSupplierDetail);
}

export async function getSupplierById(id: string, session: SessionUser): Promise<SupplierDetail> {
  assertRole(session, ["PURCHASING", "ADMIN"]);
  const supplier = await getDb().supplier.findUnique({ where: { id }, include: supplierInclude });
  if (!supplier) throw new AppError("ไม่พบผู้ขายที่ต้องการ", 404);
  return toSupplierDetail(supplier);
}

export async function createSupplier(session: SessionUser, input: CreateSupplierInput): Promise<SupplierDetail> {
  assertRole(session, ["PURCHASING", "ADMIN"]);
  const { contacts, ...fields } = input;
  const supplier = await getDb().supplier.create({
    data: { ...fields, contacts: { create: contacts } }, include: supplierInclude,
  });
  return toSupplierDetail(supplier);
}

export async function updateSupplier(id: string, session: SessionUser, input: UpdateSupplierInput): Promise<SupplierDetail> {
  assertRole(session, ["PURCHASING", "ADMIN"]);
  const { expectedVersion, contacts, ...fields } = input;
  return getDb().$transaction(async (transaction) => {
    const updated = await transaction.supplier.updateMany({
      where: { id, version: expectedVersion },
      data: {
        ...fields,
        taxId: fields.taxId ?? null,
        address: fields.address ?? null,
        contactPerson: fields.contactPerson ?? null,
        paymentTerms: fields.paymentTerms ?? null,
        note: fields.note ?? null,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      const existing = await transaction.supplier.findUnique({ where: { id }, select: { id: true } });
      invariant(existing, "ไม่พบผู้ขายที่ต้องการ", 404);
      throw new AppError("ข้อมูลผู้ขายมีการเปลี่ยนแปลง กรุณาโหลดข้อมูลใหม่", 409);
    }
    await transaction.supplierContact.deleteMany({ where: { supplierId: id } });
    await transaction.supplierContact.createMany({ data: contacts.map((contact) => ({ ...contact, supplierId: id })) });
    const supplier = await transaction.supplier.findUniqueOrThrow({ where: { id }, include: supplierInclude });
    return toSupplierDetail(supplier);
  });
}
