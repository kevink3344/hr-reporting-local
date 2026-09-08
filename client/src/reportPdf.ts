const HIGHLIGHT_PDF_RGB: Record<string, [number, number, number]> = {
  pastel_red: [255, 214, 214],
  pastel_yellow: [255, 243, 196],
  pastel_green: [209, 240, 214],
  pastel_blue: [214, 230, 255],
  pastel_pink: [255, 214, 232],
  pastel_orange: [255, 228, 196],
};

import type { ReportHighlightRule } from './types';
import { ruleMatchesRow } from './types';

function highlightPdfColorForRow(
  row: Record<string, unknown>,
  rules?: ReportHighlightRule[]
): [number, number, number] | null {
  if (!rules || rules.length === 0) return null;
  for (const rule of rules) {
    if (ruleMatchesRow(rule, row)) return HIGHLIGHT_PDF_RGB[rule.color] ?? null;
  }
  return null;
}

function sanitizeFilename(value: string): string {
  return value.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-') || 'report';
}

export async function exportGenericReportToPdf(run: {
  report: { title: string; sectionTitle?: string };
  organization: string;
  columns: string[];
  rows: (Record<string, unknown> & { __subreport?: { keyColumn: string; columns: string[]; rows: Record<string, unknown>[] } })[];
  truncated?: boolean;
  highlightRules?: ReportHighlightRule[];
  subreport?: { keyColumn: string } | null;
}): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');

  const landscape = run.columns.length > 5;
  const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 10;
  const today = new Date().toISOString().slice(0, 10);

  // Header
  doc.setFontSize(8);
  doc.setTextColor(139, 107, 62);
  doc.setFont('helvetica', 'bold');
  doc.text('HR REPORTING', margin, 10);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text(today, pageW - margin, 10, { align: 'right' });

  doc.setFontSize(13);
  doc.setTextColor(38, 35, 31);
  doc.setFont('helvetica', 'bold');
  doc.text(run.report.title, margin, 17);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(117, 111, 102);
  const subtitle = [run.report.sectionTitle, run.organization].filter(Boolean).join(' — ');
  if (subtitle) doc.text(subtitle, margin, 22);
  const metaY = subtitle ? 27 : 22;
  doc.setFontSize(7);
  doc.text(`${run.rows.length} rows${run.truncated ? ' (truncated to 2000)' : ''}  •  ${run.columns.length} columns`, margin, metaY);

  const head = [run.columns];
  const body = run.rows.map((row) =>
    run.columns.map((col) => {
      const v = row[col];
      return v === null || v === undefined ? '' : String(v);
    }),
  );

  const mainTableY = metaY + 4;
  autoTable(doc, {
    startY: mainTableY,
    head,
    body,
    theme: 'grid',
    styles: { fontSize: 7, cellPadding: 2, overflow: 'linebreak', valign: 'middle' },
    headStyles: { fillColor: [46, 94, 86], textColor: 255, fontStyle: 'bold', fontSize: 6.5 },
    alternateRowStyles: { fillColor: [245, 241, 232] },
    margin: { left: margin, right: margin, top: margin, bottom: 12 },
    didParseCell(data) {
      if (data.section !== 'body' || !run.highlightRules?.length) return;
      const rowIndex = data.row.index;
      const row = run.rows[rowIndex];
      if (!row) return;
      const rgb = highlightPdfColorForRow(row, run.highlightRules);
      if (rgb) data.cell.styles.fillColor = rgb as unknown as string;
    },
    didDrawPage(data) {
      // Footer on every page
      const str = `Page ${data.pageNumber}  •  Confidential — HR Reporting  •  ${today}`;
      doc.setFontSize(6.5);
      doc.setTextColor(140, 133, 122);
      doc.setFont('helvetica', 'normal');
      doc.text(str, pageW / 2, pageH - 6, { align: 'center' });
    },
  });
  const afterMainY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? mainTableY + 8;

  // Append a "Certification Details" subreport block (one row per child).
  if (run.subreport) {
    const keyColumn = run.subreport.keyColumn;
    const firstSub = run.rows.find((row) => row.__subreport && row.__subreport.rows.length > 0)?.__subreport;
    const subColumns = firstSub?.columns ?? [];
    const subHead = [keyColumn, ...subColumns];
    const subBody: (string)[][] = [];
    for (const row of run.rows) {
      const sub = row.__subreport;
      if (!sub || sub.rows.length === 0) continue;
      const parentKey = String(row[keyColumn] ?? '');
      for (const child of sub.rows) {
        subBody.push([parentKey, ...subColumns.map((col) => {
          const v = child[col];
          return v === null || v === undefined ? '' : String(v);
        })]);
      }
    }
    if (subBody.length > 0) {
      doc.setFontSize(9);
      doc.setTextColor(46, 94, 86);
      doc.setFont('helvetica', 'bold');
      doc.text('Certification Details (subreport)', margin, afterMainY + 6);
      autoTable(doc, {
        startY: afterMainY + 8,
        head: [subHead],
        body: subBody,
        theme: 'grid',
        styles: { fontSize: 7, cellPadding: 2, overflow: 'linebreak', valign: 'middle' },
        headStyles: { fillColor: [139, 107, 62], textColor: 255, fontStyle: 'bold', fontSize: 6.5 },
        alternateRowStyles: { fillColor: [247, 243, 235] },
        margin: { left: margin, right: margin, top: margin, bottom: 12 },
        didDrawPage(data) {
          const str = `Page ${data.pageNumber}  •  Confidential — HR Reporting  •  ${today}`;
          doc.setFontSize(6.5);
          doc.setTextColor(140, 133, 122);
          doc.setFont('helvetica', 'normal');
          doc.text(str, pageW / 2, pageH - 6, { align: 'center' });
        },
      });
    }
  }

  const slug = sanitizeFilename(run.report.title.toLowerCase());
  const org = sanitizeFilename(run.organization);
  doc.save(`${slug}-${org}-${today}.pdf`);
}
