import { FileSpreadsheet, FileText } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/lib/i18n";

type ExportButtonsProps = {
  queryString: string;
  dictionary: Dictionary;
};

export function ExportButtons({ queryString, dictionary }: ExportButtonsProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <Button asChild variant="outline" className="rounded-xl">
        <a href={`/api/reports/export/excel?${queryString}`}>
          <FileSpreadsheet />
          {dictionary.reports.exportExcel}
        </a>
      </Button>
      <Button asChild variant="outline" className="rounded-xl">
        <a href={`/api/reports/export/pdf?${queryString}`}>
          <FileText />
          {dictionary.reports.exportPdf}
        </a>
      </Button>
    </div>
  );
}
