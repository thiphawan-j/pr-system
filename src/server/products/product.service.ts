import "server-only";
import { Prisma } from "@prisma/client";
import type { SessionUser } from "@/lib/types";
import { assertRole } from "@/server/auth/authorization";
import { getDb } from "@/server/db";
import { invariant } from "@/server/shared/errors";
import { createProductAliasSchema, createProductSchema, normalizeProductName, productFiltersSchema, type CreateProductAliasInput, type CreateProductInput, type ProductFilters, correctProductSchema, deactivateProductAliasSchema, productAuditFiltersSchema, type CorrectProductInput, type DeactivateProductAliasInput } from "./product.schemas";

const include = { aliases: { where: { isActive: true }, orderBy: [{ name: "asc" as const }, { context: "asc" as const }] } };

export async function listProducts(session: SessionUser, filters: Partial<ProductFilters> = {}) {
  assertRole(session, ["EMPLOYEE", "APPROVER", "PURCHASING", "ADMIN"]);
  const { query, page, limit, status } = productFiltersSchema.parse(filters);
  if (status !== "ACTIVE") assertRole(session, ["PURCHASING", "ADMIN"]);
  const where: Prisma.ProductWhereInput = {
    ...(status === "ALL" ? {} : { isActive: status === "ACTIVE" }),
    ...(query ? { OR: [
      { code: { contains: query, mode: "insensitive" } },
      { name: { contains: query, mode: "insensitive" } },
      { aliases: { some: { isActive: true, normalizedName: { contains: normalizeProductName(query) } } } },
    ] } : {}),
  };
  const db = getDb();
  const catalogInclude = session.role === "ADMIN" || session.role === "PURCHASING"
    ? { aliases: { orderBy: include.aliases.orderBy } } : include;
  const [totalCount, items] = await db.$transaction([
    db.product.count({ where }),
    db.product.findMany({ where, include: catalogInclude, orderBy: [{ code: "asc" }, { id: "asc" }], skip: (page - 1) * limit, take: limit }),
  ]);
  // Keep audit actor identifiers internal; the authenticated catalog needs only display fields.
  return { items: items.map(({ id, code, name, unit, isActive, version, aliases }) => ({ id, code, name, unit, isActive, version, aliases: aliases.map(({ id, name, context, isActive }) => ({ id, name, context, isActive })) })), page, limit, totalCount, totalPages: Math.ceil(totalCount / limit) };
}

export async function createProduct(session: SessionUser, input: CreateProductInput) {
  assertRole(session, ["PURCHASING", "ADMIN"]);
  const data = createProductSchema.parse(input);
  return getDb().product.create({ data: { ...data, createdById: session.id }, select: { id: true, code: true, name: true, unit: true, version: true } });
}

export async function createProductAlias(session: SessionUser, productId: string, input: CreateProductAliasInput) {
  assertRole(session, ["PURCHASING", "ADMIN"]);
  const { name, context } = createProductAliasSchema.parse(input);
  return getDb().$transaction(async (tx) => {
    await lockProductRows(tx, [productId]);
    const product = await tx.product.findUnique({ where: { id: productId } });
    invariant(product?.isActive, "ไม่พบสินค้าหรือสินค้าถูกปิดใช้งาน", 404);
    invariant(normalizeProductName(product.name) !== normalizeProductName(name), "ชื่อนี้ตรงกับชื่อหลักอยู่แล้ว");
    const alias = await tx.productAlias.create({ data: { productId, name, normalizedName: normalizeProductName(name), context, confirmedById: session.id }, select: { id: true, name: true, context: true } });
    await tx.product.update({ where: { id: productId }, data: { version: { increment: 1 } } });
    await tx.productAudit.create({ data: { productId, action: "ALIAS_ADDED", before: {}, after: { ...alias, isActive: true }, actorId: session.id, actorName: session.name, reason: "Explicitly confirmed alias association" } });
    return alias;
  });
}

export type ProductLinkInput = { productId?: string | null; productConfirmed?: boolean; productVersion?: number };
export type ProductLinkSnapshot = {
  productId: string | null;
  productCodeSnapshot: string | null;
  productNameSnapshot: string | null;
  productConfirmedById: string | null;
  productConfirmedAt: Date | null;
};

// Call inside the document write transaction. Never infer a link from spelling or alias matches.
export async function resolveConfirmedProductLinks(db: Pick<Prisma.TransactionClient, "product" | "$queryRaw">, items: ProductLinkInput[], actorId: string): Promise<ProductLinkSnapshot[]> {
  const ids = [...new Set(items.flatMap((item) => item.productId ? [item.productId] : []))];
  invariant(items.every((item) => !item.productId || item.productConfirmed === true), "กรุณายืนยันการเชื่อมโยงสินค้าแต่ละรายการ");
  await lockProductRows(db, ids);
  const products = ids.length ? await db.product.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true, code: true, name: true, version: true } }) : [];
  const byId = new Map(products.map((product) => [product.id, product]));
  const confirmedAt = new Date();
  return items.map((item) => {
    if (!item.productId) return { productId: null, productCodeSnapshot: null, productNameSnapshot: null, productConfirmedById: null, productConfirmedAt: null };
    const product = byId.get(item.productId);
    invariant(product, "ไม่พบสินค้าหรือสินค้าถูกปิดใช้งาน กรุณาเลือกใหม่", 400);
    invariant(item.productVersion === product.version, "ข้อมูลสินค้ามีการเปลี่ยนแปลง กรุณาค้นหาและยืนยันใหม่", 409);
    return { productId: product.id, productCodeSnapshot: product.code, productNameSnapshot: product.name, productConfirmedById: actorId, productConfirmedAt: confirmedAt };
  });
}


// All catalog writes and newly confirmed PR links take this same lock. Call within a transaction.
export async function lockProductRows(tx: Pick<Prisma.TransactionClient, "$queryRaw">, ids: string[]) {
  for (const id of [...new Set(ids)].sort()) {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Product" WHERE "id" = ${id} FOR UPDATE`);
  }
}

export async function correctProduct(session: SessionUser, productId: string, rawInput: CorrectProductInput) {
  assertRole(session, ["PURCHASING", "ADMIN"]);
  const input = correctProductSchema.parse(rawInput);
  return getDb().$transaction(async tx => {
    await lockProductRows(tx, [productId]);
    const product = await tx.product.findUnique({ where: { id: productId } });
    invariant(product, "ไม่พบสินค้า", 404);
    invariant(product.isActive, "สินค้านี้ถูกปิดใช้งานแล้ว", 409);
    invariant(product.version === input.expectedVersion, "ข้อมูลสินค้ามีการเปลี่ยนแปลง กรุณาโหลดใหม่", 409);
    if (input.action === "RENAME") invariant(product.name !== input.name, "ชื่อใหม่ต้องต่างจากชื่อเดิม");
    const updated = await tx.product.update({ where: { id: productId }, data: {
      ...(input.action === "RENAME" ? { name: input.name } : { isActive: false }), version: { increment: 1 },
    } });
    await tx.productAudit.create({ data: { productId, action: input.action, actorId: session.id, actorName: session.name, reason: input.reason,
      before: { name: product.name, isActive: product.isActive, version: product.version },
      after: { name: updated.name, isActive: updated.isActive, version: updated.version },
    } });
    return { id: updated.id, code: updated.code, name: updated.name, unit: updated.unit, isActive: updated.isActive, version: updated.version };
  });
}

export async function deactivateProductAlias(session: SessionUser, productId: string, aliasId: string, rawInput: DeactivateProductAliasInput) {
  assertRole(session, ["PURCHASING", "ADMIN"]);
  const input = deactivateProductAliasSchema.parse(rawInput);
  return getDb().$transaction(async tx => {
    await lockProductRows(tx, [productId]);
    const product = await tx.product.findUnique({ where: { id: productId } });
    invariant(product, "ไม่พบสินค้า", 404);
    invariant(product.version === input.expectedVersion, "ข้อมูลสินค้ามีการเปลี่ยนแปลง กรุณาโหลดใหม่", 409);
    const alias = await tx.productAlias.findFirst({ where: { id: aliasId, productId } });
    invariant(alias, "ไม่พบชื่อเรียก", 404);
    invariant(alias.isActive, "ชื่อเรียกนี้ถูกปิดใช้งานแล้ว", 409);
    await tx.productAlias.update({ where: { id: aliasId }, data: { isActive: false } });
    const updated = await tx.product.update({ where: { id: productId }, data: { version: { increment: 1 } } });
    await tx.productAudit.create({ data: { productId, action: "ALIAS_DEACTIVATED", actorId: session.id, actorName: session.name, reason: input.reason,
      before: { aliasId, name: alias.name, context: alias.context, isActive: true, version: product.version },
      after: { aliasId, name: alias.name, context: alias.context, isActive: false, version: updated.version },
    } });
    return { id: aliasId, isActive: false, version: updated.version };
  });
}

export async function getProductAudit(session: SessionUser, productId: string, filters: { page?: number } = {}) {
  assertRole(session, ["PURCHASING", "ADMIN"]);
  const { page } = productAuditFiltersSchema.parse(filters);
  const db = getDb();
  invariant(await db.product.findUnique({ where: { id: productId }, select: { id: true } }), "ไม่พบสินค้า", 404);
  const [totalCount, items] = await db.$transaction([
    db.productAudit.count({ where: { productId } }),
    db.productAudit.findMany({ where: { productId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20, skip: (page - 1) * 20 }),
  ]);
  return { items, page, totalCount, totalPages: Math.ceil(totalCount / 20) };
}
