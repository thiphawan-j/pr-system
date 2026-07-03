import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type SummaryCardProps = {
  title: string;
  value: string;
  subtitle: string;
  accentClassName?: string;
  href?: string;
};

export function SummaryCard({
  title,
  value,
  subtitle,
  accentClassName = "from-primary/20 via-primary/10 to-transparent",
  href,
}: SummaryCardProps) {
  const content = (
    <Card
      className={cn(
        "relative overflow-hidden border-border/70",
        href &&
          "transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg focus-within:border-primary/30",
      )}
    >
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 h-24 bg-linear-to-r ${accentClassName}`}
      />
      <CardHeader className="relative">
        <CardTitle className="text-sm text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="relative space-y-1">
        <p className="text-3xl font-semibold tracking-tight">{value}</p>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </CardContent>
    </Card>
  );

  if (!href) {
    return content;
  }

  return (
    <Link href={href} className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60">
      {content}
    </Link>
  );
}
