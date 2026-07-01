"use client";

import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { useI18n } from "@/components/i18n/i18n-provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";

type MonthlySpendChartProps = {
  data: Array<{
    month: string;
    amount: number;
    count: number;
  }>;
};

export function MonthlySpendChart({ data }: MonthlySpendChartProps) {
  const { dictionary, locale } = useI18n();
  const chartConfig = {
    amount: {
      label: dictionary.dashboard.chartValueLabel,
      color: "var(--chart-1)",
    },
  };

  return (
    <Card className="border-border/70">
      <CardHeader>
        <CardTitle>{dictionary.dashboard.chartTitle}</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[280px] w-full">
          <BarChart data={data}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="month"
              tickLine={false}
              axisLine={false}
              tickMargin={10}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  formatter={(value) => (
                    <span className="font-mono">
                      {formatCurrency(Number(value), locale)}
                    </span>
                  )}
                />
              }
            />
            <Bar dataKey="amount" radius={[12, 12, 0, 0]} fill="var(--color-amount)" />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
