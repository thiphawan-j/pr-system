"use client";

import { Menu } from "lucide-react";
import { useState } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";
import { NavigationLinks } from "@/components/layout/navigation-links";
import { Button } from "@/components/ui/button";
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
        <div className="px-4 pb-6">
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
