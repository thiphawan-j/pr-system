import { requireSession } from "@/server/auth/session";
import {
  deleteAttachmentFromPurchaseRequest,
  getAttachmentForDownload,
} from "@/server/attachments/attachment.service";
import { toErrorResponse } from "@/server/shared/errors";

function getContentDisposition(
  fileName: string,
  dispositionType: "attachment" | "inline",
) {
  const encodedFileName = encodeRfc5987Value(fileName);
  const fallbackFileName = getAsciiFallbackFileName(fileName);

  return `${dispositionType}; filename="${fallbackFileName}"; filename*=UTF-8''${encodedFileName}`;
}

function getAsciiFallbackFileName(fileName: string) {
  const extensionMatch = fileName.match(/(\.[A-Za-z0-9]{1,12})$/);
  const extension = extensionMatch?.[1] ?? "";
  const baseName = extension ? fileName.slice(0, -extension.length) : fileName;
  const safeBaseName = baseName
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "-")
    .replace(/["\\\/;,\r\n]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .trim();

  return `${safeBaseName || "attachment"}${extension}`;
}

function encodeRfc5987Value(value: string) {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; attachmentId: string }> },
) {
  try {
    const session = await requireSession();
    const { id, attachmentId } = await context.params;
    const dispositionType =
      new URL(request.url).searchParams.get("disposition") === "inline"
        ? "inline"
        : "attachment";
    const { attachment, bytes } = await getAttachmentForDownload(
      id,
      attachmentId,
      session,
    );

    return new Response(bytes, {
      headers: {
        "Content-Type": attachment.mimeType,
        "Content-Length": String(attachment.size),
        "Content-Disposition": getContentDisposition(
          attachment.originalName,
          dispositionType,
        ),
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; attachmentId: string }> },
) {
  try {
    const session = await requireSession();
    const { id, attachmentId } = await context.params;

    await deleteAttachmentFromPurchaseRequest(id, attachmentId, session);

    return Response.json({ success: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
