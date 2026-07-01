import type { Metadata } from "next";

import { Providers } from "@/components/providers";
import { getCurrentLocale } from "@/server/i18n";
import { getDictionary } from "@/lib/i18n";

import "./globals.css";

export const metadata: Metadata = {
  title: "PR Flow | Purchase Request Management",
  description:
    "ระบบจัดการใบขอซื้อพร้อม workflow อนุมัติ / Purchase Request management with approval workflow",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getCurrentLocale();
  const dictionary = getDictionary(locale);

  return (
    <html lang={locale} suppressHydrationWarning className="h-full">
      <body className="min-h-full bg-background text-foreground antialiased">
        <Providers locale={locale} dictionary={dictionary}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
