import { FileSpreadsheet, FileText } from "lucide-react";

import { DownloadButton } from "@/components/shared/download-button";
import type { Dictionary } from "@/lib/i18n";

type ExportButtonsProps = {
  queryString: string;
  dictionary: Dictionary;
};

export function ExportButtons({ queryString, dictionary }: ExportButtonsProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <DownloadButton href={`/api/reports/export/excel?${queryString}`} filename="purchase-request-report.xlsx" className="rounded-xl">
          <FileSpreadsheet />
          {dictionary.reports.exportExcel}
      </DownloadButton>
      <DownloadButton href={`/api/reports/export/pdf?${queryString}`} filename="purchase-request-report.pdf" className="rounded-xl">
          <FileText />
          {dictionary.reports.exportPdf}
      </DownloadButton>
    </div>
  );
}
