import { AppError } from "@/server/shared/errors";

/** Opt-in deployment boundary. Restart every legacy PR instance at cutover. */
export function assertLegacyProcurementWriter() {
  if (process.env.PO_WORKSPACE_ENABLED?.trim().toLowerCase() === "true") {
    throw new AppError(
      "ฝ่ายจัดซื้อและการรับสินค้าได้ย้ายไประบบ PO แล้ว กรุณาดำเนินการในระบบ PO",
      409,
      "PO_WORKSPACE_OWNS_PROCUREMENT",
    );
  }
}
