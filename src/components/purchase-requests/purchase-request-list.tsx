import Link from "next/link";
import { FilePenLine, Eye } from "lucide-react";

import { PriorityBadge } from "@/components/purchase-requests/priority-badge";
import { StatusBadge } from "@/components/purchase-requests/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/format";
import { getDictionary, type Locale } from "@/lib/i18n";
import type { PurchaseRequestListItem, SessionUser } from "@/lib/types";

type PurchaseRequestListProps = {
  requests: PurchaseRequestListItem[];
  session: SessionUser;
  locale: Locale;
};

export function PurchaseRequestList({
  requests,
  session,
  locale,
}: PurchaseRequestListProps) {
  const dictionary = getDictionary(locale);

  if (!requests.length) {
    return (
      <Card className="border-dashed border-border/80">
        <CardContent className="py-12 text-center text-muted-foreground">
          {dictionary.purchaseRequests.empty}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:hidden">
        {requests.map((request) => (
          <Card key={request.id} className="border-border/70">
            <CardHeader className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">{request.prNumber}</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {request.requesterName} · {request.requesterDepartment}
                  </p>
                </div>
                <StatusBadge status={request.status} locale={locale} />
              </div>
              <div className="flex flex-wrap gap-2">
                <PriorityBadge priority={request.urgency} locale={locale} />
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p>{request.reason}</p>
              <div className="grid grid-cols-2 gap-3 text-muted-foreground">
                <div>
                  <p>{dictionary.common.date}</p>
                  <p className="font-medium text-foreground">
                    {formatDate(request.requestDate, locale)}
                  </p>
                </div>
                <div>
                  <p>{dictionary.common.amount}</p>
                  <p className="font-medium text-foreground">
                    {formatCurrency(request.totalAmount, locale)}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button asChild variant="outline" className="flex-1 rounded-xl">
                  <Link href={`/purchase-requests/${request.id}`}>
                    <Eye />
                    {dictionary.common.details}
                  </Link>
                </Button>
                {request.status === "DRAFT" &&
                (session.id === request.requesterId || session.role === "ADMIN") ? (
                  <Button asChild className="rounded-xl">
                    <Link href={`/purchase-requests/${request.id}/edit`}>
                      <FilePenLine />
                      {dictionary.common.edit}
                    </Link>
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="hidden lg:block">
        <Card className="border-border/70">
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{dictionary.purchaseRequests.prNumber}</TableHead>
                  <TableHead>{dictionary.common.requester}</TableHead>
                  <TableHead>{dictionary.common.date}</TableHead>
                  <TableHead>{dictionary.common.status}</TableHead>
                  <TableHead>{dictionary.common.priority}</TableHead>
                  <TableHead>{dictionary.common.amount}</TableHead>
                  <TableHead className="text-right">{dictionary.common.actions}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((request) => (
                  <TableRow key={request.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{request.prNumber}</p>
                        <p className="line-clamp-1 max-w-xs text-xs text-muted-foreground">
                          {request.reason}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p>{request.requesterName}</p>
                        <p className="text-xs text-muted-foreground">
                          {request.requesterDepartment}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>{formatDate(request.requestDate, locale)}</TableCell>
                    <TableCell>
                      <StatusBadge status={request.status} locale={locale} />
                    </TableCell>
                    <TableCell>
                      <PriorityBadge priority={request.urgency} locale={locale} />
                    </TableCell>
                    <TableCell className="font-mono">
                      {formatCurrency(request.totalAmount, locale)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/purchase-requests/${request.id}`}>
                            <Eye />
                            {dictionary.common.open}
                          </Link>
                        </Button>
                        {request.status === "DRAFT" &&
                        (session.id === request.requesterId ||
                          session.role === "ADMIN") ? (
                          <Button asChild size="sm">
                            <Link href={`/purchase-requests/${request.id}/edit`}>
                              <FilePenLine />
                              {dictionary.common.edit}
                            </Link>
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
