import "server-only";

import { Prisma, type CompanyProfile as StoredCompanyProfile } from "@prisma/client";
import { toBangkokIsoString } from "@/lib/format";
import type { CompanyIdentity, CompanyProfile, SessionUser } from "@/lib/types";
import { assertRole } from "@/server/auth/authorization";
import type { UpdateCompanyProfileInput } from "@/server/company/company.schemas";
import { getDb } from "@/server/db";
import { invariant } from "@/server/shared/errors";

const companyProfileId = "default";
// A transaction advisory lock also works before the singleton row exists.
// Settings changes take this lock exclusively; issuance takes it shared.
const companyProfileLockKey = 2026102401;

export async function lockCompanyProfile(transaction: Prisma.TransactionClient, mode: "shared" | "exclusive") {
  if (mode === "shared") {
    await transaction.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock_shared(${companyProfileLockKey}::bigint)::text`);
  } else {
    await transaction.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${companyProfileLockKey}::bigint)::text`);
  }
}

export function companyIdentity(company: CompanyIdentity): CompanyIdentity {
  return {
    name: company.name,
    address: company.address,
    taxId: company.taxId,
    branch: company.branch,
    phone: company.phone,
    email: company.email,
  };
}

function toCompanyProfile(company: StoredCompanyProfile): CompanyProfile {
  return { ...companyIdentity(company), version: company.version, updatedAt: toBangkokIsoString(company.updatedAt) };
}

export async function getCompanyProfile(session: SessionUser): Promise<CompanyProfile | null> {
  assertRole(session, ["ADMIN"]);
  const company = await getDb().companyProfile.findUnique({ where: { id: companyProfileId } });
  return company ? toCompanyProfile(company) : null;
}

export async function saveCompanyProfile(session: SessionUser, input: UpdateCompanyProfileInput): Promise<CompanyProfile> {
  assertRole(session, ["ADMIN"]);
  const { expectedVersion, ...fields } = input;
  return getDb().$transaction(async (transaction) => {
    // Acquire before any row writes to share a consistent lock order with PO issuance.
    await lockCompanyProfile(transaction, "exclusive");
    const existing = await transaction.companyProfile.findUnique({ where: { id: companyProfileId } });
    invariant((existing?.version ?? 0) === expectedVersion,
      "ข้อมูลบริษัทมีการเปลี่ยนแปลง กรุณาโหลดข้อมูลใหม่", 409);
    const company = existing
      ? await transaction.companyProfile.update({
        where: { id: companyProfileId }, data: { ...fields, version: { increment: 1 } },
      })
      : await transaction.companyProfile.create({ data: { id: companyProfileId, ...fields, version: 1 } });

    // Older POs have no buyer identity. Fill them once, then retain the issued
    // identity even when an administrator later changes the company profile.
    await transaction.purchaseOrder.updateMany({
      where: { buyerCompany: { equals: Prisma.DbNull } },
      data: { buyerCompany: companyIdentity(company) },
    });
    return toCompanyProfile(company);
  }, { timeout: 15000 });
}
