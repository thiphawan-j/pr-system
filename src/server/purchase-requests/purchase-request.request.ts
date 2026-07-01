import "server-only";

import {
  getFilesFromFormData,
  validateAttachmentFiles,
} from "@/server/attachments/attachment.service";
import { purchaseRequestPayloadSchema } from "@/server/purchase-requests/purchase-request.schemas";
import { AppError } from "@/server/shared/errors";

function parseJsonPayload(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    throw new AppError("ไม่พบข้อมูลเอกสาร PR ที่ต้องการบันทึก", 400);
  }

  try {
    return JSON.parse(value);
  } catch {
    throw new AppError("รูปแบบข้อมูลเอกสาร PR ไม่ถูกต้อง", 400);
  }
}

export async function parsePurchaseRequestRequest(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const payload = purchaseRequestPayloadSchema.parse(
      parseJsonPayload(formData.get("payload")),
    );
    const files = getFilesFromFormData(formData);

    validateAttachmentFiles(files);

    return { payload, files };
  }

  const payload = purchaseRequestPayloadSchema.parse(await request.json());

  return { payload, files: [] };
}
