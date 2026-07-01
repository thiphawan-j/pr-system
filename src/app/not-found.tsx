import Link from "next/link";

import { Button } from "@/components/ui/button";
import { getCurrentDictionary } from "@/server/i18n";

export default async function NotFoundPage() {
  const dictionary = await getCurrentDictionary();

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md space-y-4 text-center">
        <h1 className="text-4xl font-semibold">{dictionary.error.notFoundTitle}</h1>
        <p className="text-muted-foreground">
          {dictionary.error.notFoundDescription}
        </p>
        <Button asChild>
          <Link href="/dashboard">{dictionary.error.backDashboard}</Link>
        </Button>
      </div>
    </div>
  );
}
