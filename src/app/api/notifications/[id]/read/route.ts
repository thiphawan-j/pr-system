import { requireSession } from "@/server/auth/session";
import { markNotificationAsRead } from "@/server/notifications/notification.service";
import { toErrorResponse } from "@/server/shared/errors";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession();
    const { id } = await context.params;

    await markNotificationAsRead(id, session.id);

    return Response.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
