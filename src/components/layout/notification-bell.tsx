"use client";

import Link from "next/link";
import { Bell, Dot } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useState } from "react";
import { toast } from "sonner";

import { useI18n } from "@/components/i18n/i18n-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import {
  translateNotificationMessage,
  translateNotificationTitle,
} from "@/lib/i18n";
import type { NotificationItem } from "@/lib/types";

type NotificationBellProps = {
  notifications: NotificationItem[];
  unreadCount: number;
};

export function NotificationBell({
  notifications: initialNotifications,
  unreadCount,
}: NotificationBellProps) {
  const router = useRouter();
  const [notifications, setNotifications] = useState(initialNotifications);
  const { dictionary, locale } = useI18n();

  function handleOpenNotification(notification: NotificationItem) {
    startTransition(async () => {
      if (!notification.readAt) {
        const response = await fetch(`/api/notifications/${notification.id}/read`, {
          method: "POST",
        });

        if (!response.ok) {
          toast.error(dictionary.notifications.readError);
          return;
        }

        setNotifications((current) =>
          current.map((item) =>
            item.id === notification.id
              ? { ...item, readAt: new Date().toISOString() }
              : item,
          ),
        );
      }

      if (notification.link) {
        router.push(notification.link);
        router.refresh();
      }
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className="relative rounded-full"
          aria-label={dictionary.notifications.ariaLabel}
        >
          <Bell />
          {unreadCount > 0 ? (
            <span className="absolute -top-1 -right-1 flex min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[22rem]">
        <DropdownMenuLabel>{dictionary.notifications.latest}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {notifications.length ? (
          notifications.map((notification) => (
            <DropdownMenuItem
              key={notification.id}
              className="flex items-start gap-3 rounded-xl px-3 py-3"
              onSelect={(event) => {
                event.preventDefault();
                handleOpenNotification(notification);
              }}
            >
              <div className="mt-0.5">
                {notification.readAt ? (
                  <Bell className="size-4 text-muted-foreground" />
                ) : (
                  <Dot className="size-5 text-primary" />
                )}
              </div>
              <div className="min-w-0 space-y-1">
                <p className="line-clamp-1 font-medium">
                  {translateNotificationTitle(notification.title, locale)}
                </p>
                <p className="line-clamp-2 text-xs text-muted-foreground">
                  {translateNotificationMessage(notification.message, locale)}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {formatDateTime(notification.createdAt, locale)}
                </p>
              </div>
            </DropdownMenuItem>
          ))
        ) : (
          <div className="px-3 py-4 text-sm text-muted-foreground">
            {dictionary.notifications.empty}
          </div>
        )}
        <DropdownMenuSeparator />
        <div className="px-3 py-2 text-right">
          <Link href="/purchase-requests" className="text-xs text-primary hover:underline">
            {dictionary.notifications.openAll}
          </Link>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
