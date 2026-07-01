"use client";

import Link from "next/link";
import { Menu } from "lucide-react";
import { useState } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";
import { NavigationLinks } from "@/components/layout/navigation-links";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { getInitials } from "@/lib/format";
import type { SessionUser } from "@/lib/types";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

type MobileNavProps = {
  session: SessionUser;
};

export function MobileNav({ session }: MobileNavProps) {
  const [open, setOpen] = useState(false);
  const { dictionary } = useI18n();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className="lg:hidden"
          aria-label={dictionary.navigation.openMenu}
        >
          <Menu />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[82vw] border-r border-border/70">
        <SheetHeader className="px-5 pt-6">
          <SheetTitle>{dictionary.app.name}</SheetTitle>
          <SheetDescription>
            {dictionary.app.description}
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-6">
          <Link
            href="/profile"
            onClick={() => setOpen(false)}
            aria-label={dictionary.navigation.profile}
            className="flex items-center gap-3 rounded-2xl border border-border/70 bg-card px-3 py-3 transition-colors hover:bg-muted/40"
          >
            <Avatar size="sm">
              <AvatarFallback>{getInitials(session.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{session.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {session.department} · {dictionary.roles[session.role]}
              </p>
            </div>
          </Link>
          <NavigationLinks
            sessionRole={session.role}
            vertical
            onNavigate={() => setOpen(false)}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
