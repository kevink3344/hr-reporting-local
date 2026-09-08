import type { ReactNode } from 'react';

// Brand-style export format icons.
//
// The generic monochrome lucide icons (FileSpreadsheet / FileDown / FileType)
// didn't read as "Excel / CSV / PDF". These are small inline SVG marks that
// use the familiar brand colors so the three export buttons are instantly
// recognizable. Colors:
//   Excel  -> Microsoft Excel green   (#107C41)
//   PDF    -> Adobe Acrobat red       (#EC1C24)
//   CSV    -> neutral slate           (#5B6472) — no single brand, so a muted
//            "text/data rows" glyph to distinguish it from the two branded ones.

function Mark({ children, size }: { children: ReactNode; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export function ExcelIcon({ size = 18 }: { size?: number }) {
  return (
    <Mark size={size}>
      <rect x="1" y="1" width="22" height="22" rx="4" fill="#107C41" />
      <path d="M7.4 7.4l9.2 9.2M16.6 7.4L7.4 16.6" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
    </Mark>
  );
}

export function CsvIcon({ size = 18 }: { size?: number }) {
  return (
    <Mark size={size}>
      <rect x="1" y="1" width="22" height="22" rx="4" fill="#5B6472" />
      <path d="M7 9.2h10M7 12h10M7 14.8h6.5" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
    </Mark>
  );
}

export function PdfIcon({ size = 18 }: { size?: number }) {
  return (
    <Mark size={size}>
      <rect x="1" y="1" width="22" height="22" rx="4" fill="#EC1C24" />
      <text x="12" y="14.6" textAnchor="middle" fill="#fff" fontSize="7.6" fontWeight="700" fontFamily="Arial, Helvetica, sans-serif" letterSpacing="0.3">
        PDF
      </text>
    </Mark>
  );
}
