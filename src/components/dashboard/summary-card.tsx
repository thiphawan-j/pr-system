import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type SummaryCardProps = {
  title: string;
  value: string;
  subtitle: string;
  accentClassName?: string;
};

export function SummaryCard({
  title,
  value,
  subtitle,
  accentClassName = "from-primary/20 via-primary/10 to-transparent",
}: SummaryCardProps) {
  return (
    <Card className="relative overflow-hidden border-border/70">
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
}
