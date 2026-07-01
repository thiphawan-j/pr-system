import { requireSession } from "@/server/auth/session";
import { listNotificationsForUser } from "@/server/notifications/notification.service";
import { toErrorResponse } from "@/server/shared/errors";

export async function GET() {
  try {
    const session = await requireSession();
    const notifications = await listNotificationsForUser(session.id, 20);

    return Response.json({ items: notifications });
  } catch (error) {
    return toErrorResponse(error);
  }
}
