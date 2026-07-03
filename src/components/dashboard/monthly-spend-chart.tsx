"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";

import { useI18n } from "@/components/i18n/i18n-provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { appTimeZone, formatNumber } from "@/lib/format";
import { getIntlLocale } from "@/lib/i18n";
import type { DashboardSummary } from "@/lib/types";

type MonthlySpendChartProps = {
  data: DashboardSummary["requestVolumeChart"];
};

type ChartGranularity = keyof DashboardSummary["requestVolumeChart"];

function toUtcDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

export function MonthlySpendChart({ data }: MonthlySpendChartProps) {
  const { dictionary, locale } = useI18n();
  const [granularity, setGranularity] = useState<ChartGranularity>("month");
  const chartConfig = {
    count: {
      label: dictionary.dashboard.chartCountLabel,
      color: "var(--chart-1)",
    },
  };
  const shortDateFormatter = new Intl.DateTimeFormat(getIntlLocale(locale), {
    timeZone: appTimeZone,
    day: "2-digit",
    month: "short",
  });
  const longDateFormatter = new Intl.DateTimeFormat(getIntlLocale(locale), {
    timeZone: appTimeZone,
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const shortMonthFormatter = new Intl.DateTimeFormat(getIntlLocale(locale), {
    timeZone: appTimeZone,
    month: "short",
  });
  const longMonthFormatter = new Intl.DateTimeFormat(getIntlLocale(locale), {
    timeZone: appTimeZone,
    month: "long",
    year: "numeric",
  });

  const chartData =
    granularity === "day"
      ? data.day.map((item) => ({
          label: shortDateFormatter.format(toUtcDate(item.startDate)),
          tooltipLabel: longDateFormatter.format(toUtcDate(item.startDate)),
          count: item.count,
        }))
      : granularity === "week"
        ? data.week.map((item) => ({
            label: shortDateFormatter.format(toUtcDate(item.startDate)),
            tooltipLabel: `${longDateFormatter.format(toUtcDate(item.startDate))} - ${longDateFormatter.format(toUtcDate(item.endDate))}`,
            count: item.count,
          }))
        : data.month.map((item) => ({
            label: shortMonthFormatter.format(toUtcDate(item.startDate)),
            tooltipLabel: longMonthFormatter.format(toUtcDate(item.startDate)),
            count: item.count,
          }));

  return (
    <Card className="border-border/70">
      <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle>{dictionary.dashboard.chartTitle}</CardTitle>
        <Tabs
          value={granularity}
          onValueChange={(value) => setGranularity(value as ChartGranularity)}
          className="gap-0"
        >
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="day">{dictionary.dashboard.chartDay}</TabsTrigger>
            <TabsTrigger value="week">{dictionary.dashboard.chartWeek}</TabsTrigger>
            <TabsTrigger value="month">{dictionary.dashboard.chartMonth}</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[280px] w-full">
          <BarChart data={chartData}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tickMargin={10}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  labelFormatter={(_, payload) =>
                    payload[0]?.payload?.tooltipLabel ?? ""
                  }
                  formatter={(value) => (
                    <span className="font-mono">
                      {formatNumber(Number(value), locale)}
                    </span>
                  )}
                />
              }
            />
            <Bar dataKey="count" radius={[12, 12, 0, 0]} fill="var(--color-count)" />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
