import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowLeft, Check, ChevronDown, Download, Info, Search } from 'lucide-react';
import { getSchoolKpiRows } from './api';
import { CsvIcon, ExcelIcon, PdfIcon } from './ExportFormatIcons';
import { exportGenericReport, exportGenericReportToCsv } from './reportExport';
import { exportGenericReportToPdf } from './reportPdf';
import { radioGroupKeys } from './radioGroupKeys';
import type { KpiFacet, KpiMetricKey, KpiPositionRow, KpiTarget, LoginSession, SchoolKpiRows } from './types';

const FACET_ORDER: KpiFacet[] = ['all', 'filled', 'vacant'];
const FACET_LABEL: Record<KpiFacet, string> = { all: 'All', filled: 'Filled', vacant: 'Vacant' };
const PAGE_SIZE = 25;

/** The exported column order, shared by all three formats. */
const EXPORT_COLUMNS = ['Position #', 'Position Title', 'Category', 'Account', 'Months used', 'Months available', 'Incumbent', 'Employee #', 'Contract end', 'Certificate expires', 'Status'];

type ExportFormat = 'excel' | 'csv' | 'pdf';

/** Same three formats, in the same order, as the Report Dashboard's export control. */
const EXPORT_FORMATS: Array<{ value: ExportFormat; label: string; extension: string }> = [
  { value: 'excel', label: 'Excel', extension: '.xlsx' },
  { value: 'csv', label: 'CSV', extension: '.csv' },
  { value: 'pdf', label: 'PDF', extension: '.pdf' }
];

function ExportFormatIcon({ format, size }: { format: ExportFormat; size: number }) {
  if (format === 'excel') return <ExcelIcon size={size} />;
  if (format === 'csv') return <CsvIcon size={size} />;
  return <PdfIcon size={size} />;
}

type KpiDrilldownPageProps = {
  session: LoginSession | null;
  target: KpiTarget;
  onBack: () => void;
  onDefine: (metric: KpiMetricKey) => void;
  onOpenPosition: (posNumber: string, organization: string) => void;
  onOpenRecord: (employeeNumber: string) => void;
};

/**
 * One export row, keyed by the labels in EXPORT_COLUMNS. Keyed rather than
 * positional so the same rows feed all three shared report exporters, which
 * each expect a record per row.
 */
function exportRecord(row: KpiPositionRow): Record<string, unknown> {
  return {
    'Position #': row.posNumber,
    'Position Title': row.posName,
    // The dashboard's axis is Position Title, so Category repeats it; there is
    // no independent category value to export (see the plan doc, 3.1.1).
    'Category': row.posName,
    'Account': row.accountNumber,
    'Months used': row.monthsUsed ?? '',
    'Months available': row.monthsAvailable ?? '',
    'Incumbent': row.occupied ? row.fullName : '',
    'Employee #': row.employeeNumber,
    'Contract end': row.contractEnd,
    'Certificate expires': row.certNextExpiration,
    'Status': row.occupied ? 'Filled' : 'Vacant'
  };
}

/** Windowed page numbers so a 40-page list does not render 40 buttons. */
function pageWindow(page: number, pageCount: number): number[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_value, index) => index + 1);
  const start = Math.min(Math.max(1, page - 3), pageCount - 6);
  return Array.from({ length: 7 }, (_value, index) => start + index);
}

/**
 * The drill-down list behind every tile and bar.
 *
 * Shows the seats one metric counts, with the facet control that changes which
 * seats are in view and the agreement caveat that explains why this list's row
 * count equals the number on the tile. The definition is a page, not a dialog.
 */
export function KpiDrilldownPage({ session, target, onBack, onDefine, onOpenPosition, onOpenRecord }: KpiDrilldownPageProps) {
  const [data, setData] = useState<SchoolKpiRows | null>(null);
  const [facet, setFacet] = useState<KpiFacet>(target.facet);
  const [search, setSearch] = useState(target.q);
  const [appliedSearch, setAppliedSearch] = useState(target.q);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exportOpen, setExportOpen] = useState(false);
  // CSV stays the default so a plain click on Export behaves as it did before.
  const [exportFormat, setExportFormat] = useState<ExportFormat>('csv');

  // A new target (different metric, bar, or school) restarts the view.
  useEffect(() => {
    setFacet(target.facet);
    setSearch(target.q);
    setAppliedSearch(target.q);
    setPage(1);
  }, [target.metric, target.facet, target.posName, target.q, target.schoolId]);

  // Debounce typing before it reaches the server.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setAppliedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    const query: {
      schoolId: string;
      metric: KpiMetricKey;
      facet: KpiFacet;
      posName?: string;
      q?: string;
      page: number;
      pageSize: number;
    } = {
      schoolId: target.schoolId,
      metric: target.metric,
      // Always explicit: the facet on screen is the facet in the request.
      facet,
      page,
      pageSize: PAGE_SIZE
    };
    if (target.posName) query.posName = target.posName;
    if (appliedSearch) query.q = appliedSearch;

    getSchoolKpiRows(session, query)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setData(null);
        const code = cause instanceof Error ? cause.message : '';
        if (code.startsWith('UNKNOWN_KPI_METRIC')) setError('That metric is not recognised.');
        else if (code === 'SCHOOL_NOT_PERMITTED') setError('Your account cannot view that school.');
        else if (code === 'SCHOOL_NOT_FOUND') setError('That school no longer exists.');
        else setError('Could not load this list.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session, target.schoolId, target.metric, target.posName, facet, page, appliedSearch]);

  const label = data?.label ?? 'Positions';
  const total = data?.total ?? 0;
  const pageCount = data?.pageCount ?? 1;
  const facetCounts = data?.facetCounts;
  // Until the first response arrives there is no count to show. Render a
  // placeholder rather than a false "0", which would read as "no rows" on a
  // list that is still loading.
  const countText = data ? total.toLocaleString('en-US') : '…';

  const firstRow = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastRow = Math.min(page * PAGE_SIZE, total);

  const predicateSummary = data?.predicateSummary ?? '';
  const exportsDisabled = !data || data.rows.length === 0;

  function changeFacet(next: KpiFacet) {
    setFacet(next);
    setPage(1);
  }

  function handleExport() {
    if (!data || data.rows.length === 0) return;
    // One shape, three destinations: the same rows and column order feed the
    // shared CSV, Excel, and PDF exporters the Report Dashboard uses.
    const exportRun = {
      report: {
        title: `${label}${target.posName ? ` ${target.posName}` : ''}`,
        sectionTitle: 'KPI drill-down'
      },
      organization: target.schoolName,
      columns: EXPORT_COLUMNS,
      rows: data.rows.map(exportRecord)
    };
    if (exportFormat === 'excel') void exportGenericReport(exportRun);
    else if (exportFormat === 'csv') void exportGenericReportToCsv(exportRun);
    else void exportGenericReportToPdf(exportRun);
  }

  const pageNumbers = useMemo(() => pageWindow(page, pageCount), [page, pageCount]);
  return (
    <div className="kpi-page">
      <nav className="kpi-crumbs" aria-label="Breadcrumb">
        <button type="button" onClick={onBack} aria-label="Back to the KPI dashboard">
          <ArrowLeft size={14} aria-hidden /> Back to KPI dashboard
        </button>
        <span className="sep" aria-hidden>
          /
        </span>
        <span>{target.schoolName}</span>
        <span className="sep" aria-hidden>
          /
        </span>
        <span className="here" aria-current="page">
          {label}
          {target.posName ? ` · ${target.posName}` : ''}
        </span>
      </nav>

      <header className="kpi-drill-head">
        <div>
          <h2>
            {label}
            {target.posName ? ` · ${target.posName}` : ''}
            <span className="kpi-count-badge">{countText}</span>
          </h2>
          <p className="kpi-drill-sub">
            {target.schoolName} · {FACET_LABEL[facet]} seats
            {target.posName ? ` · position title ${target.posName}` : ''}
            {appliedSearch ? ` · matching “${appliedSearch}”` : ''}
          </p>
        </div>
        <div className="kpi-drill-actions">
          <button type="button" className="kpi-btn ghost" onClick={() => onDefine(target.metric)} aria-label={`How ${label} is calculated. Opens the definition page.`}>
            <Info size={14} aria-hidden /> How &ldquo;{label}&rdquo; is calculated
          </button>
          <div className="export-controls">
            <div className="export-format-dropdown">
              <button
                type="button"
                className="export-button export-button--secondary"
                onClick={() => setExportOpen((open) => !open)}
                disabled={exportsDisabled}
                aria-expanded={exportOpen}
                aria-haspopup="listbox"
                aria-label={`Export format: ${exportFormat}`}
                title="Select export format"
              >
                <ExportFormatIcon format={exportFormat} size={18} />
                <span>Select format</span>
                <ChevronDown size={14} className={exportOpen ? 'chevron-open' : ''} aria-hidden />
              </button>
              {exportOpen && (
                <div className="export-format-menu" role="listbox" aria-label="Export format">
                  {EXPORT_FORMATS.map((format) => (
                    <button
                      key={format.value}
                      type="button"
                      role="option"
                      aria-selected={exportFormat === format.value}
                      className={`export-format-option${exportFormat === format.value ? ' active' : ''}`}
                      onClick={() => {
                        setExportFormat(format.value);
                        setExportOpen(false);
                      }}
                    >
                      <span className="export-format-option-icon">
                        <ExportFormatIcon format={format.value} size={16} />
                      </span>
                      <span className="export-format-option-label">
                        {format.label}
                        <br />
                        <small>{format.extension}</small>
                      </span>
                      {exportFormat === format.value && <Check size={14} aria-hidden />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              className="export-button"
              onClick={handleExport}
              disabled={exportsDisabled}
              aria-label={`Export this list to ${exportFormat.toUpperCase()}`}
              title={`Export this list to ${exportFormat.toUpperCase()}`}
            >
              <Download size={15} aria-hidden /> Export
            </button>
          </div>
        </div>
      </header>

      <div className="kpi-toolbar">
        <div className="segmented-control" role="radiogroup" aria-label="Seat status">
          {FACET_ORDER.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={facet === option}
              tabIndex={facet === option ? 0 : -1}
              className={facet === option ? 'active' : ''}
              onClick={() => changeFacet(option)}
              onKeyDown={radioGroupKeys(FACET_ORDER, facet, changeFacet)}
              title={facetCounts ? `${FACET_LABEL[option]}: ${facetCounts[option].toLocaleString('en-US')} positions` : undefined}
            >
              {FACET_LABEL[option]}
              {facetCounts ? ` (${facetCounts[option].toLocaleString('en-US')})` : ''}
            </button>
          ))}
        </div>
        <label className="kpi-search">
          <Search size={15} aria-hidden />
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search position, title, or person" aria-label="Search this list" />
        </label>
      </div>

      {error ? (
        <div className="empty-state" role="alert">
          <AlertCircle size={26} />
          <p>{error}</p>
        </div>
      ) : loading && !data ? (
        <div className="empty-state">
          <span className="loader" />
          Loading positions
        </div>
      ) : !data || data.rows.length === 0 ? (
        <div className="empty-state">
          <p>
            No positions match this filter. Try clearing the search or switching back to <b>{FACET_LABEL[facet]}</b>.
          </p>
        </div>
      ) : (
        <div className="kpi-table-wrap">
          <table className="kpi-table">
            <caption>
              <b>{data.label}</b> — {data.rows.length} of {total.toLocaleString('en-US')} rows shown, {target.schoolName} · page {page} of {pageCount}
            </caption>
            <thead>
              <tr>
                <th scope="col">Pos #</th>
                <th scope="col">Position</th>
                <th scope="col">Category</th>
                <th scope="col">Account</th>
                <th scope="col" className="num">
                  Months
                </th>
                <th scope="col">Incumbent</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="sr-only">Definition</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr
                  key={`${row.posNumber}-${row.employeeNumber}`}
                  tabIndex={0}
                  onClick={() => onOpenPosition(row.posNumber, row.organization)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onOpenPosition(row.posNumber, row.organization);
                    }
                  }}
                  aria-label={`Position ${row.posNumber}, ${row.posName}. Open details.`}
                >
                  <td className="kpi-row-pos">{row.posNumber}</td>
                  <td>{row.posName || '—'}</td>
                  <td>{row.posName || '—'}</td>
                  <td className="mono">{row.accountNumber || '—'}</td>
                  <td className="num">
                    {row.monthsUsed ?? '—'} / {row.monthsAvailable ?? '—'}
                  </td>
                  <td>
                    {row.occupied ? (
                      <button
                        type="button"
                        className="kpi-row-person link-button"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (row.employeeNumber) onOpenRecord(row.employeeNumber);
                        }}
                        aria-label={`Open the record for ${row.fullName || row.employeeNumber}`}
                      >
                        {row.fullName || row.employeeNumber}
                      </button>
                    ) : (
                      <span className="kpi-row-person vacant">— vacant —</span>
                    )}
                  </td>
                  <td>
                    <span className={row.occupied ? 'kpi-pill filled' : 'kpi-pill vacant'}>{row.occupied ? 'Filled' : 'Vacant'}</span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="kpi-row-info"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDefine(target.metric);
                      }}
                      title={`How “${label}” is calculated`}
                      aria-label={`How “${label}” is calculated. Opens the definition page.`}
                    >
                      i
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="kpi-table-foot">
            <span className="kpi-range">
              Rows <b>
                {firstRow}–{lastRow}
              </b>{' '}
              of <b>{total.toLocaleString('en-US')}</b>
            </span>
            <div className="kpi-pager">
              <button type="button" onClick={() => setPage(1)} disabled={page <= 1} aria-label="First page">
                «
              </button>
              <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1} aria-label="Previous page">
                ‹
              </button>
              {pageNumbers.map((number) => (
                <button key={number} type="button" onClick={() => setPage(number)} aria-current={number === page ? 'page' : undefined} aria-label={`Page ${number}`}>
                  {number}
                </button>
              ))}
              <button type="button" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={page >= pageCount} aria-label="Next page">
                ›
              </button>
              <button type="button" onClick={() => setPage(pageCount)} disabled={page >= pageCount} aria-label="Last page">
                »
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="kpi-caveat">
        <Info size={15} aria-hidden />
        <div>
          <b>Why this list and the tile always agree.</b> The tile count and this list come from a single shared predicate, so the row count here can never drift from the number on the dashboard. The list applies:
          {predicateSummary ? (
            <>
              {' '}
              <code className="kpi-code">{predicateSummary}</code>
            </>
          ) : null}{' '}
          and excludes placeholder seats <code className="kpi-code">pos_number LIKE &apos;888%&apos;</code> and ended seats. <a href="#" onClick={(event) => { event.preventDefault(); onDefine(target.metric); }}>See the definition and read-only SQL →</a>
        </div>
      </div>
    </div>
  );
}
