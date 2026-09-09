import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  BarChart3,
  Building2,
  Columns3,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  FileText,
  MessageSquare,
  Search,
  Share2,
  StretchHorizontal,
  X
} from 'lucide-react';
import { CsvIcon, ExcelIcon, PdfIcon } from './ExportFormatIcons';
import {
  createReportView,
  createViewComment,
  createViewInvite,
  deleteReportView,
  getReportViews,
  getReports,
  getReportSections,
  getViewComments,
  getViewInvites,
  runReport,
  updateReportView
} from './api';
import { exportGenericReport, exportGenericReportToCsv } from './reportExport';
import { exportGenericReportToPdf } from './reportPdf';
import { SchoolCombobox } from './SchoolCombobox';
import { loadLastReport, loadLastSchool, saveLastReport, saveLastSchool } from './lastRun';
import { formatRelativeTime, loadRecentRuns, recordRecentRun } from './recentRuns';
import type { RecentRun } from './recentRuns';
import {
  applyFilter,
  applySort,
  defaultViewDefinition,
  isViewDirty,
  normalizeViewDefinition,
  rowKeyForRow
} from './reportViews';
import type {
  GenericReportRowWithSubreport,
  GenericReportRun,
  HighlightColorId,
  LoginSession,
  ReportDefinition,
  ReportHighlightRule,
  ReportSection,
  ReportView,
  ReportViewComment,
  ReportViewInvite,
  School,
  ViewDefinition
} from './types';
import { describeHighlightRule, HIGHLIGHT_PALETTE, ruleMatchesRow as sharedRuleMatchesRow } from './types';

function ReportOption({ report, onOpen }: { report: ReportDefinition; onOpen: (report: ReportDefinition) => void }) {
  const active = report.status === 'active';
  return <button className="report-option" onClick={() => onOpen(report)} disabled={!active} title={active ? 'Open report' : 'Report inactive'}>
    <span className="report-option-icon"><FileText size={19} /></span>
    <span className="report-option-copy"><strong>{report.title}</strong><span>{report.description}</span></span>
    <span className="report-option-meta">{active ? <span className="ready-badge">Ready</span> : <span className="pending-badge">Inactive</span>}</span>
    <ChevronRight className="report-option-arrow" size={18} aria-hidden="true" />
  </button>;
}

function draftStorageKey(reportId: string, organization: string): string {
  return `hr-report-view-draft:${reportId}:${organization}`;
}

// Readable short labels for the Contract Report's known columns when
// "fit to width" is active. Full words are kept where they fit; snake_case
// keys are expanded into recognizable abbreviations instead of being collapsed
// to 3 cryptic characters (which made "pos_name" and "pos_number" both "pon").
const FIT_LABELS: Record<string, string> = {
  pos_start: 'Start',
  pos_ending: 'End',
  pos_number: 'Pos #',
  pos_name: 'Title',
  fund: 'Fund',
  purpose: 'Purp',
  program: 'Prog',
  object: 'Obj',
  level: 'Level',
  cost_center: 'Cost',
  organization: 'Org',
  months: 'Months',
  a_months: 'Avail',
  full_name: 'Name',
  classroom_assignment: 'Room',
  mailstop: 'Mail'
};

function fitColumnShort(column: string): string {
  const label = FIT_LABELS[column];
  if (label) return label;
  // Fallback for unknown columns: expand snake_case into words and keep a short
  // readable prefix of each, so the label stays meaningful instead of 3 letters.
  return column
    .split('_')
    .map((word) => word.slice(0, 3))
    .join(' ');
}

// Columns that carry a full ISO timestamp (e.g. "1951-01-01T05:00:00.000Z")
// but should display as a date only (e.g. "1951-01-01"). We cut at the "T"
// rather than going through a Date object so the day never shifts due to the
// local timezone offset.
const DATE_ONLY_COLUMNS = new Set(['pos_start', 'pos_ending']);

function formatCellValue(column: string, value: string): string {
  if (DATE_ONLY_COLUMNS.has(column)) {
    const dateOnly = value.split('T')[0];
    return dateOnly || value;
  }
  return value;
}

function GenericReportView({
  result,
  session,
  onBack,
  onOpenRecord,
  onOpenPosition
}: {
  result: GenericReportRun;
  session: LoginSession | null;
  onBack: () => void;
  onOpenRecord?: (employeeNumber: string) => void;
  onOpenPosition?: (posNumber: string, organization: string) => void;
}) {
  const declaredKey = (result as unknown as { report: { rowKeyColumn?: string | null } }).report.rowKeyColumn ?? null;
  const [views, setViews] = useState<ReportView[]>([]);
  const [activeView, setActiveView] = useState<ReportView | null>(null);
  const [draft, setDraft] = useState<ViewDefinition>(() => {
    try {
      const raw = sessionStorage.getItem(draftStorageKey(result.report.id, result.organization));
      if (raw) return normalizeViewDefinition(result.columns, JSON.parse(raw) as unknown);
    } catch { /* ignore */ }
    return defaultViewDefinition(result.columns);
  });
  const [filterInput, setFilterInput] = useState(draft.filterText);
  const [viewsOpen, setViewsOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveDescription, setSaveDescription] = useState('');
  const [saveVisibility, setSaveVisibility] = useState<'private' | 'invite_only'>('private');
  const [saveError, setSaveError] = useState('');
  const [saveSaving, setSaveSaving] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareInvitee, setShareInvitee] = useState('');
  const [shareRole, setShareRole] = useState<'viewer' | 'commenter' | 'editor'>('viewer');
  const [shareError, setShareError] = useState('');
  const [shareSaving, setShareSaving] = useState(false);
  const [invites, setInvites] = useState<ReportViewInvite[]>([]);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState<ReportViewComment[]>([]);
  const [commentBody, setCommentBody] = useState('');
  const [commentRowKey, setCommentRowKey] = useState<string | null>(null);
  const [activeHighlightFilterId, setActiveHighlightFilterId] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<'excel' | 'csv' | 'pdf'>('excel');
  const filterDebounce = useRef<number | null>(null);

  // When the columns panel is open, lock body scroll and close on Escape
  useEffect(() => {
    if (!columnsOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setColumnsOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [columnsOpen]);

  // Normalize draft when columns change (e.g. report SQL changed)
  useEffect(() => {
    setDraft((prev) => normalizeViewDefinition(result.columns, prev));
  }, [result.columns]);

  // Persist draft to sessionStorage
  useEffect(() => {
    try {
      sessionStorage.setItem(draftStorageKey(result.report.id, result.organization), JSON.stringify(draft));
    } catch { /* ignore */ }
  }, [draft, result.report.id, result.organization]);

  // Sync filter input with draft (when view loaded)
  useEffect(() => {
    setFilterInput(draft.filterText);
  }, [draft.filterText]);

  // Debounced filter
  function onFilterChange(value: string) {
    setFilterInput(value);
    if (filterDebounce.current) window.clearTimeout(filterDebounce.current);
    filterDebounce.current = window.setTimeout(() => {
      setDraft((prev) => ({ ...prev, filterText: value }));
    }, 150);
  }

  function clearFilter() {
    setFilterInput('');
    setDraft((prev) => ({ ...prev, filterText: '' }));
  }

  // Fetch views for this report+org
  useEffect(() => {
    if (!session) return;
    getReportViews(session, { reportId: result.report.id, organization: result.organization })
      .then(setViews)
      .catch(() => { /* ignore */ });
  }, [session, result.report.id, result.organization]);

  // Fetch invites/comments when active view changes
  useEffect(() => {
    if (!activeView || !session) {
      setInvites([]);
      setComments([]);
      return;
    }
    getViewInvites(session, activeView.id).then(setInvites).catch(() => setInvites([]));
    getViewComments(session, activeView.id).then(setComments).catch(() => setComments([]));
  }, [activeView, session]);

  const displayColumns = useMemo(
    () => draft.columnOrder.filter((col) => !draft.hiddenColumns.includes(col)),
    [draft.columnOrder, draft.hiddenColumns]
  );

  const hiddenColumns = useMemo(
    () => draft.hiddenColumns.filter((col) => draft.columnOrder.includes(col)),
    [draft.columnOrder, draft.hiddenColumns]
  );

  const sortedRows = useMemo(() => applySort(result.rows, draft.sort), [result.rows, draft.sort]);
  const filteredRows = useMemo(
    () => applyFilter(sortedRows, draft.filterText, displayColumns),
    [sortedRows, draft.filterText, displayColumns]
  );

  // Admin highlight rules for this report (first-match-wins)
  const adminHighlightRules: ReportHighlightRule[] = (result.report as unknown as { highlightRules?: ReportHighlightRule[] }).highlightRules ?? [];

  // Reset highlight filter when report changes or rule no longer exists
  useEffect(() => {
    if (activeHighlightFilterId && !adminHighlightRules.some((r) => r.id === activeHighlightFilterId)) {
      setActiveHighlightFilterId(null);
    }
  }, [adminHighlightRules, activeHighlightFilterId]);
  useEffect(() => {
    setActiveHighlightFilterId(null);
  }, [result.report.id, result.organization]);

  function getEmpNumber(row: Record<string, unknown>): string {
    const raw = row['emp_number'] ?? row['empNumber'] ?? row['employee_number'] ?? row['employeeNumber'] ?? row['employee_no'] ?? row['emp_no'] ?? (() => {
      const k = Object.keys(row).find((c) => c.toLowerCase().replace(/[^a-z0-9]/g, '') === 'empnumber' || c.toLowerCase().replace(/[^a-z0-9]/g, '') === 'employeenumber');
      return k ? row[k] : '';
    })();
    return String(raw ?? '').trim();
  }

  // A column is a "position" column when it carries a pos_number / number /
  // position id we can deep-link into the Position Details drawer.
  function getPosNumber(row: Record<string, unknown>): string {
    const raw = row['pos_number'] ?? row['posNumber'] ?? row['position_no'] ?? row['position_number'] ?? row['position_id'] ?? row['positionId'] ?? (() => {
      const k = Object.keys(row).find((c) => c.toLowerCase().replace(/[^a-z0-9]/g, '') === 'posnumber' || c.toLowerCase().replace(/[^a-z0-9]/g, '') === 'positionnumber' || c.toLowerCase().replace(/[^a-z0-9]/g, '') === 'positionno');
      return k ? row[k] : '';
    })();
    return String(raw ?? '').trim();
  }

  function isPositionColumn(column: string): boolean {
    const norm = column.toLowerCase().replace(/[^a-z0-9]/g, '');
    return norm === 'posnumber' || norm === 'positionnumber' || norm === 'positionno' || norm === 'number' || norm === 'positionid' || norm === 'position';
  }

  function isPersonColumn(column: string): boolean {
    const norm = column.toLowerCase().replace(/[^a-z0-9]/g, '');
    return norm === 'fullname' || norm === 'name' || norm === 'person' || norm === 'employeename' || norm === 'empname' || norm === 'employee' || norm === 'empnumber' || norm === 'employeenumber';
  }

  function ruleMatchesRow(rule: ReportHighlightRule, row: Record<string, unknown>): boolean {
    return sharedRuleMatchesRow(rule, row);
  }

  const activeHighlightRule = useMemo(
    () => adminHighlightRules.find((r) => r.id === activeHighlightFilterId) ?? null,
    [adminHighlightRules, activeHighlightFilterId]
  );

  const displayRows = useMemo(() => {
    if (!activeHighlightRule) return filteredRows;
    return filteredRows.filter((row) => ruleMatchesRow(activeHighlightRule, row as Record<string, unknown>));
  }, [filteredRows, activeHighlightRule]);

  function toggleHighlightFilter(ruleId: string) {
    setActiveHighlightFilterId((prev) => (prev === ruleId ? null : ruleId));
  }

  const isDirty = useMemo(() => {
    if (!activeView) return draft.filterText !== '' || draft.hiddenColumns.length > 0 || draft.sort !== null || JSON.stringify(draft.columnOrder) !== JSON.stringify(result.columns);
    return isViewDirty(draft, activeView.definition);
  }, [draft, activeView, result.columns]);

  function toggleSort(column: string) {
    setDraft((prev) => {
      if (prev.sort?.column === column) {
        if (prev.sort.dir === 'asc') return { ...prev, sort: { column, dir: 'desc' } };
        return { ...prev, sort: null };
      }
      return { ...prev, sort: { column, dir: 'asc' } };
    });
  }

  function showColumn(column: string) {
    setDraft((prev) => ({ ...prev, hiddenColumns: prev.hiddenColumns.filter((c) => c !== column) }));
  }

  function hideColumn(column: string) {
    setDraft((prev) => ({ ...prev, hiddenColumns: prev.hiddenColumns.includes(column) ? prev.hiddenColumns : [...prev.hiddenColumns, column] }));
  }

  function showAllColumns() {
    setDraft((prev) => ({ ...prev, hiddenColumns: [] }));
  }

  // Move a column one position left/right among the *visible* columns. Hidden
  // columns keep their own slot in columnOrder so they don't jump around.
  function moveColumn(column: string, dir: -1 | 1) {
    setDraft((prev) => {
      const visible = prev.columnOrder.filter((c) => !prev.hiddenColumns.includes(c));
      const i = visible.indexOf(column);
      const j = i + dir;
      if (i === -1 || j < 0 || j >= visible.length) return prev;
      const other = visible[j];
      const order = [...prev.columnOrder];
      const a = order.indexOf(column);
      const b = order.indexOf(other);
      order[a] = other;
      order[b] = column;
      return { ...prev, columnOrder: order };
    });
  }

  function loadView(view: ReportView) {
    setActiveView(view);
    setDraft(normalizeViewDefinition(result.columns, view.definition));
    setViewsOpen(false);
  }

  function resetToDefault() {
    setActiveView(null);
    setDraft(defaultViewDefinition(result.columns));
  }

  async function handleSaveView() {
    if (!session) return;
    const name = saveName.trim();
    if (name.length < 3) {
      setSaveError('Name must be at least 3 characters.');
      return;
    }
    setSaveSaving(true);
    setSaveError('');
    try {
      if (activeView) {
        const updated = await updateReportView(session, activeView.id, {
          name,
          description: saveDescription.trim(),
          visibility: saveVisibility,
          definition: draft,
          expectedVersion: activeView.version
        });
        setActiveView(updated);
        setViews((prev) => prev.map((v) => (v.id === updated.id ? updated : v)));
      } else {
        const created = await createReportView(session, {
          reportId: result.report.id,
          organization: result.organization,
          name,
          description: saveDescription.trim(),
          visibility: saveVisibility,
          definition: draft
        });
        setActiveView(created);
        setViews((prev) => [...prev, created]);
      }
      setSaveOpen(false);
      setSaveName('');
      setSaveDescription('');
    } catch (err) {
      const code = err instanceof Error ? err.message : 'UNKNOWN';
      if (code === 'VIEW_NAME_CONFLICT') setSaveError('A view with that name already exists for this report and organization.');
      else if (code === 'VERSION_CONFLICT') setSaveError('This view was updated elsewhere. Please reload and try again.');
      else setSaveError('Could not save view. Please try again.');
    } finally {
      setSaveSaving(false);
    }
  }

  function openSaveModal() {
    setSaveName(activeView?.name ?? '');
    setSaveDescription(activeView?.description ?? '');
    setSaveVisibility(activeView?.visibility ?? 'private');
    setSaveError('');
    setSaveOpen(true);
  }

  async function handleShare() {
    if (!session || !activeView) return;
    const raw = shareInvitee.trim();
    if (!raw) {
      setShareError('Enter a Wake ID or email.');
      return;
    }
    setShareSaving(true);
    setShareError('');
    try {
      const isEmail = raw.includes('@');
      const invite = await createViewInvite(session, activeView.id, {
        inviteeId: isEmail ? undefined : raw,
        inviteeEmail: isEmail ? raw : undefined,
        inviteeName: raw,
        role: shareRole
      });
      setInvites((prev) => [...prev, invite]);
      setShareInvitee('');
    } catch (err) {
      const code = err instanceof Error ? err.message : 'UNKNOWN';
      if (code === 'INVITE_ALREADY_EXISTS') setShareError('That person has already been invited.');
      else if (code === 'INVITEE_REQUIRED') setShareError('Enter a Wake ID or email.');
      else setShareError('Could not send invite.');
    } finally {
      setShareSaving(false);
    }
  }

  async function handleAddComment() {
    if (!session || !activeView) return;
    const body = commentBody.trim();
    if (!body) return;
    try {
      const created = await createViewComment(session, activeView.id, {
        body,
        rowKey: commentRowKey,
        parentId: null
      });
      setComments((prev) => [...prev, created]);
      setCommentBody('');
      setCommentRowKey(null);
    } catch {
      // ignore
    }
  }

  async function handleDeleteView() {
    if (!session || !activeView) return;
    try {
      await deleteReportView(session, activeView.id);
      setViews((prev) => prev.filter((v) => v.id !== activeView.id));
      resetToDefault();
    } catch { /* ignore */ }
  }

  // Admin highlight: first-match-wins over displayRows (View highlight overrides admin highlight)
  function adminHighlightForRow(row: Record<string, unknown>): { color: HighlightColorId; bg: string; border: string } | null {
    // When a specific highlight filter chip is active, that rule's color takes precedence
    // so the filtered rows are highlighted with the selected chip's color (e.g. clicking
    // "contract_code eq NEXTYEAR" colors those rows green, not the color of an earlier
    // matching rule like "contract_desc eq Terminating").
    if (activeHighlightRule && ruleMatchesRow(activeHighlightRule, row)) {
      const p = HIGHLIGHT_PALETTE[activeHighlightRule.color];
      return p ? { color: activeHighlightRule.color, bg: p.bg, border: p.border } : null;
    }
    // Otherwise first-match-wins across all configured rules
    for (const rule of adminHighlightRules) {
      if (ruleMatchesRow(rule, row)) {
        const p = HIGHLIGHT_PALETTE[rule.color];
        return p ? { color: rule.color, bg: p.bg, border: p.border } : null;
      }
    }
    return null;
  }

  const exportRun = {
    report: result.report,
    organization: result.organization,
    columns: displayColumns,
    additionalColumns: result.report.additionalColumns ?? [],
    rows: displayRows.map((row) => {
      const out: Record<string, unknown> = {};
      for (const col of displayColumns) out[col] = (row as Record<string, unknown>)[col];
      return out;
    }),
    truncated: result.truncated,
    highlightRules: adminHighlightRules
  };

  return <div className="report-view">
    <div className="report-view-toolbar">
      <button className="back-button" onClick={onBack}><ArrowLeft size={17} />All reports</button>
      <div className="report-view-actions">
        <span className="report-view-meta">{displayRows.length} of {result.rows.length} rows{result.truncated ? ' (truncated)' : ''}</span>
        <div className="export-controls">
          <div className="export-format-dropdown">
            <button className="export-button export-button--secondary" onClick={() => setExportOpen((v) => !v)} aria-expanded={exportOpen} aria-haspopup="listbox" aria-label={`Export format: ${exportFormat}`} title="Select export format">
              {exportFormat === 'excel' ? <ExcelIcon /> : exportFormat === 'csv' ? <CsvIcon /> : <PdfIcon />}
              <span>Select format</span>
              <ChevronDown size={14} className={exportOpen ? 'chevron-open' : ''} />
            </button>
            {exportOpen && (
              <div className="export-format-menu" role="listbox" aria-label="Export format">
                <button role="option" aria-selected={exportFormat === 'excel'} className={`export-format-option${exportFormat === 'excel' ? ' active' : ''}`} onClick={() => { setExportFormat('excel'); setExportOpen(false); }}>
                  <span className="export-format-option-icon"><ExcelIcon size={16} /></span>
                  <span className="export-format-option-label">Excel<br /><small>.xlsx</small></span>
                  {exportFormat === 'excel' && <Check size={14} />}
                </button>
                <button role="option" aria-selected={exportFormat === 'csv'} className={`export-format-option${exportFormat === 'csv' ? ' active' : ''}`} onClick={() => { setExportFormat('csv'); setExportOpen(false); }}>
                  <span className="export-format-option-icon"><CsvIcon size={16} /></span>
                  <span className="export-format-option-label">CSV<br /><small>.csv</small></span>
                  {exportFormat === 'csv' && <Check size={14} />}
                </button>
                <button role="option" aria-selected={exportFormat === 'pdf'} className={`export-format-option${exportFormat === 'pdf' ? ' active' : ''}`} onClick={() => { setExportFormat('pdf'); setExportOpen(false); }}>
                  <span className="export-format-option-icon"><PdfIcon size={16} /></span>
                  <span className="export-format-option-label">PDF<br /><small>.pdf</small></span>
                  {exportFormat === 'pdf' && <Check size={14} />}
                </button>
              </div>
            )}
          </div>
          <button className="export-button" onClick={() => {
            if (exportFormat === 'excel') void exportGenericReport(exportRun);
            else if (exportFormat === 'csv') void exportGenericReportToCsv(exportRun);
            else void exportGenericReportToPdf(exportRun);
          }} aria-label={`Export to ${exportFormat.toUpperCase()}`} title={`Export to ${exportFormat.toUpperCase()}`}>Export</button>
        </div>
      </div>
      <div className="report-view-title"><p className="eyebrow">Report{result.report.sectionTitle ? ` — ${result.report.sectionTitle}` : ''}</p><h2>{result.report.title} <span className="report-scope">{result.organization}</span></h2></div>
    </div>

    {/* Views + filter bar */}
    <div className="report-views-bar">
      {/* Hidden per request — restore Default view / Save view by removing the false && wrapper */}
      {false && (
      <div className="report-views-bar-left">
        <div className="report-views-dropdown">
          <button className="report-views-trigger" onClick={() => setViewsOpen((v) => !v)} aria-expanded={viewsOpen} aria-haspopup="listbox">
            <Columns3 size={15} />
            <span>{activeView?.name ?? 'Default view'}</span>
            <ChevronDown size={14} className={viewsOpen ? 'chevron-open' : ''} />
          </button>
          {viewsOpen && (
            <div className="report-views-menu" role="listbox">
              <button role="option" className={`report-views-option ${!activeView ? 'active' : ''}`} onClick={resetToDefault}>
                <span>Default view</span>
                {!activeView && <Check size={14} />}
              </button>
              {views.length === 0 ? (
                <span className="report-views-empty">No saved views for this report.</span>
              ) : (
                views.map((view) => (
                  <button
                    key={view.id}
                    role="option"
                    className={`report-views-option ${activeView?.id === view.id ? 'active' : ''}`}
                    onClick={() => loadView(view)}
                  >
                    <span>{view.name}</span>
                    {activeView?.id === view.id && <Check size={14} />}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
        <button className={`export-button ${isDirty ? 'export-button--dirty' : ''}`} onClick={openSaveModal}>
          <Columns3 size={15} />{activeView ? 'Update view' : 'Save view'}{isDirty ? ' •' : ''}
        </button>
        {activeView && (
          <>
            <button className="icon-button subtle" onClick={() => setShareOpen(true)} aria-label="Share view" title="Share view"><Share2 size={16} /></button>
            <button className="icon-button subtle" onClick={() => setCommentsOpen(true)} aria-label="Comments" title="Comments">
              <MessageSquare size={16} />
              {comments.length > 0 && <span className="badge-count">{comments.length}</span>}
            </button>
            <button className="icon-button subtle" onClick={() => void handleDeleteView()} aria-label="Delete view" title="Delete view"><X size={16} /></button>
          </>
        )}
      </div>
      )}
      <div className="report-filter-row">
        <label className="report-filter-input">
          <Search size={15} aria-hidden="true" />
          <input
            placeholder="Filter rows…"
            value={filterInput}
            onChange={(e) => onFilterChange(e.target.value)}
            aria-label="Filter rows"
          />
          {filterInput && (
            <button className="field-clear" onClick={clearFilter} aria-label="Clear filter"><X size={14} /></button>
          )}
        </label>
        <button
          className="report-columns-trigger"
          onClick={() => setColumnsOpen(true)}
          aria-label="Choose columns"
          title="Choose columns"
        >
          <Columns3 size={15} />
          <span>Columns</span>
          <span className="report-columns-count">{displayColumns.length}/{result.columns.length}</span>
        </button>
        <button
          className={`report-columns-trigger report-fit-trigger${draft.fitWidth ? ' is-active' : ''}`}
          onClick={() => setDraft((prev) => ({ ...prev, fitWidth: !prev.fitWidth }))}
          aria-label={draft.fitWidth ? 'Turn off fit-to-width' : 'Fit all columns to width'}
          title={draft.fitWidth ? 'Turn off fit-to-width' : 'Fit all columns to width'}
          aria-pressed={draft.fitWidth}
        >
          <StretchHorizontal size={15} />
          <span>Fit</span>
        </button>
        <span className="report-filter-count">
          {displayRows.length === result.rows.length
            ? `${displayRows.length} rows`
            : `Showing ${displayRows.length} of ${result.rows.length} rows`}
          {activeHighlightRule && (
            <span className="report-filter-highlight-label"> · filtered by <em>{describeHighlightRule(activeHighlightRule)}</em></span>
          )}
          {displayRows.length === 0 && filterInput && (
            <button className="link-button" onClick={clearFilter}>Clear text filter</button>
          )}
          {displayRows.length === 0 && activeHighlightRule && (
            <button className="link-button" onClick={() => setActiveHighlightFilterId(null)}>Clear highlight filter</button>
          )}
        </span>
      </div>
      {columnsOpen && (
        <>
          <div className="report-columns-backdrop" onClick={() => setColumnsOpen(false)} aria-hidden="true" />
          <aside className="report-columns-panel" role="dialog" aria-modal="true" aria-label="Columns">
            <div className="report-columns-panel-head">
              <h3 className="report-columns-panel-title">Columns</h3>
              <span className="report-columns-panel-meta">{displayColumns.length} of {result.columns.length} shown</span>
              <button className="report-columns-close" onClick={() => setColumnsOpen(false)} aria-label="Close columns" title="Close"><X size={16} /></button>
            </div>
            <div className="report-columns-panel-tools">
              <button className="link-button" onClick={showAllColumns}>Show all</button>
            </div>
            <div className="report-columns-panel-body" role="listbox" aria-label="Columns">
              {draft.columnOrder.map((column) => {
                const visible = !hiddenColumns.includes(column);
                const visIndex = visible ? displayColumns.indexOf(column) : -1;
                const first = visIndex === 0;
                const last = visible && visIndex === displayColumns.length - 1;
                return (
                  <div key={column} className={`report-columns-row ${visible ? 'active' : ''}`}>
                    <button
                      role="option"
                      aria-selected={visible}
                      className={`report-columns-option ${visible ? 'active' : ''}`}
                      onClick={() => (visible ? hideColumn(column) : showColumn(column))}
                    >
                      <span className="report-columns-check">{visible && <Check size={14} />}</span>
                      <span className="report-columns-name">{column}</span>
                    </button>
                    {visible && (
                      <span className="report-columns-move">
                        <button
                          className="report-columns-move-btn"
                          type="button"
                          onClick={(e) => { e.stopPropagation(); moveColumn(column, -1); }}
                          disabled={first}
                          aria-label={`Move ${column} up`}
                          title="Move up"
                        >
                          <ChevronUp size={14} />
                        </button>
                        <button
                          className="report-columns-move-btn"
                          type="button"
                          onClick={(e) => { e.stopPropagation(); moveColumn(column, 1); }}
                          disabled={last}
                          aria-label={`Move ${column} down`}
                          title="Move down"
                        >
                          <ChevronDown size={14} />
                        </button>
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="report-columns-panel-foot">
              <button className="report-columns-done" onClick={() => setColumnsOpen(false)}>Done</button>
            </div>
          </aside>
        </>
      )}
      {hiddenColumns.length > 0 && (
        <div className="report-hidden-pill">
          <span>Hidden columns ({hiddenColumns.length})</span>
          {hiddenColumns.map((col) => (
            <button key={col} className="report-hidden-chip" onClick={() => showColumn(col)} title={`Show ${col}`}>
              {col} <X size={12} />
            </button>
          ))}
          <button className="link-button" onClick={showAllColumns}>Show all</button>
        </div>
      )}
      {adminHighlightRules.length > 0 && (
        <div className="highlight-legend" aria-label="Row highlighting legend">
          {adminHighlightRules.map((rule) => {
            const p = HIGHLIGHT_PALETTE[rule.color];
            if (!p) return null;
            const label = describeHighlightRule(rule);
            const active = activeHighlightFilterId === rule.id;
            return (
              <button
                key={rule.id}
                type="button"
                className={`highlight-legend-chip ${active ? 'highlight-legend-chip--active' : ''}`}
                data-color={rule.color}
                style={{ background: p.bg, borderColor: p.border }}
                title={active ? `${label} — click to show all rows` : `${label} — click to filter` }
                aria-pressed={active}
                onClick={() => toggleHighlightFilter(rule.id)}
              >
                {label}
              </button>
            );
          })}
          {activeHighlightRule && (
            <button type="button" className="link-button" onClick={() => setActiveHighlightFilterId(null)}>Show all</button>
          )}
        </div>
      )}
    </div>

    {result.columns.length === 0 || (displayRows.length === 0 && !filterInput && !activeHighlightRule)
      ? <div className="empty-state"><BarChart3 size={26} /><p>{filterInput ? 'No rows match your filter.' : 'No rows returned for this organization.'}</p></div>
      : displayRows.length === 0
        ? <div className="empty-state"><BarChart3 size={26} /><p>No rows match your filter.</p>
            {filterInput && <button className="link-button" onClick={clearFilter}>Clear text filter</button>}
            {activeHighlightRule && <button className="link-button" onClick={() => setActiveHighlightFilterId(null)}>Clear highlight filter</button>}
          </div>
        : <div className={`report-table-wrap${draft.fitWidth ? ' report-table-wrap--fit' : ''}`}>
          <table className="report-table">
            <thead>
              <tr>
                {displayColumns.map((column) => (
                  <th
                    key={column}
                    onClick={() => toggleSort(column)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSort(column); } }}
                    aria-label={`Sort by ${column}`}
                    title="Click to sort"
                    className="report-th-clickable"
                  >
                    {draft.fitWidth ? fitColumnShort(column) : column}
                    <svg className="report-th-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/></svg>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row, index) => {
                const key = rowKeyForRow(row as Record<string, unknown>, result.columns, declaredKey);
                const adminHl = adminHighlightForRow(row as Record<string, unknown>);
                const bg = adminHl?.bg;
                const adminClass = adminHl ? ` row-highlight row-highlight--admin row-highlight--${adminHl.color}` : '';
                const record = row as Record<string, unknown>;
                const empNo = getEmpNumber(record);
                const clickable = Boolean(empNo && onOpenRecord);
                const nameCol = displayColumns.find((c) => c.toLowerCase().includes('name')) ?? displayColumns[0];
                const sub = (record as GenericReportRowWithSubreport).__subreport;
                return (
                  <Fragment key={`${key}-${index}`}>
                    <tr
                      className={`report-card${adminClass}${clickable ? ' report-row--clickable' : ''}`}
                      style={bg ? { background: bg, borderLeft: `4px solid ${adminHl.border}` } : undefined}
                      title={clickable ? `Open employee record for ${empNo}` : adminHl ? `Highlighted ${adminHl.color}` : undefined}
                      onClick={clickable ? () => onOpenRecord!(empNo) : undefined}
                      role={clickable ? 'button' : undefined}
                      tabIndex={clickable ? 0 : undefined}
                      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenRecord!(empNo); } } : undefined}
                    >
                      {displayColumns.map((column) => {
                        const rawValue = record[column] === null || record[column] === undefined ? '' : String(record[column]);
                        const cellValue = formatCellValue(column, rawValue);
                        const posNo = getPosNumber(record);
                        const isPosition = isPositionColumn(column) && Boolean(posNo) && Boolean(onOpenPosition);
                        const isPerson = isPersonColumn(column) && Boolean(empNo) && Boolean(onOpenRecord);
                        if (isPosition) {
                          return (
                            <td key={column} data-label={column}>
                              <button
                                type="button"
                                className="report-cell-link"
                                onClick={(e) => { e.stopPropagation(); onOpenPosition!(posNo, result.organization); }}
                                title={`Open position ${posNo}`}
                              >
                                {cellValue}
                              </button>
                            </td>
                          );
                        }
                        if (isPerson) {
                          return (
                            <td key={column} data-label={column}>
                              <button
                                type="button"
                                className="report-cell-link"
                                onClick={(e) => { e.stopPropagation(); onOpenRecord!(empNo); }}
                                title={`Open employee record for ${empNo}`}
                              >
                                {cellValue}
                              </button>
                            </td>
                          );
                        }
                        return (
                          <td key={column} data-label={column}>
                            <span style={column === nameCol ? { display: 'inline-flex', alignItems: 'center', gap: 6 } : undefined}>
                              {cellValue}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                    {sub && sub.rows.length > 0 && (
                      <tr className="report-subreport-row">
                        <td colSpan={displayColumns.length + 1}>
                          <table className="report-subreport-table">
                            <thead>
                              <tr>
                                {sub.columns.map((col) => (
                                  <th key={col}>{col}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {sub.rows.map((childRow, childIndex) => (
                                <tr key={childIndex}>
                                  {sub.columns.map((col) => (
                                    <td key={col} data-label={col}>
                                      {childRow[col] === null || childRow[col] === undefined ? '' : String(childRow[col])}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>}

    {/* Save view modal */}
    {saveOpen && (
      <>
        <button className="settings-drawer-scrim" onClick={() => setSaveOpen(false)} aria-label="Close save view" />
        <div className="settings-editor settings-drawer" role="dialog" aria-modal="true" aria-label="Save view">
          <div className="settings-drawer-heading">
            <h3>{activeView ? 'Update view' : 'Save view'}</h3>
            <button className="icon-button subtle" onClick={() => setSaveOpen(false)} aria-label="Close"><X size={18} /></button>
          </div>
          {saveError && <div className="notice error"><AlertCircle size={16} /><span>{saveError}</span></div>}
          <label className="settings-field">
            View name
            <input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="e.g. My filtered view" maxLength={60} />
          </label>
          <label className="settings-field">
            Description
            <input value={saveDescription} onChange={(e) => setSaveDescription(e.target.value)} placeholder="Optional" maxLength={200} />
          </label>
          <label className="settings-field">
            Visibility
            <select value={saveVisibility} onChange={(e) => setSaveVisibility(e.target.value as 'private' | 'invite_only')}>
              <option value="private">Private (only you)</option>
              <option value="invite_only">Shared by invite</option>
            </select>
          </label>
          <div className="settings-actions">
            <button className="back-button" onClick={() => setSaveOpen(false)}>Cancel</button>
            <button className="export-button" onClick={() => void handleSaveView()} disabled={saveSaving}>
              {saveSaving ? 'Saving…' : activeView ? 'Update' : 'Save'}
            </button>
          </div>
        </div>
      </>
    )}

    {/* Share modal */}
    {shareOpen && activeView && (
      <>
        <button className="settings-drawer-scrim" onClick={() => setShareOpen(false)} aria-label="Close share" />
        <div className="settings-editor settings-drawer" role="dialog" aria-modal="true" aria-label="Share view">
          <div className="settings-drawer-heading">
            <h3>Share view</h3>
            <button className="icon-button subtle" onClick={() => setShareOpen(false)} aria-label="Close"><X size={18} /></button>
          </div>
          {shareError && <div className="notice error"><AlertCircle size={16} /><span>{shareError}</span></div>}
          <div className="settings-field">
            <span>Invite by Wake ID or email</span>
            <div className="settings-form-row">
              <input value={shareInvitee} onChange={(e) => setShareInvitee(e.target.value)} placeholder="Wake ID or email" style={{ flex: 1 }} />
              <select value={shareRole} onChange={(e) => setShareRole(e.target.value as typeof shareRole)}>
                <option value="viewer">Can view</option>
                <option value="commenter">Can comment</option>
                <option value="editor">Can edit</option>
              </select>
              <button className="export-button" onClick={() => void handleShare()} disabled={shareSaving}>
                {shareSaving ? 'Sending…' : 'Invite'}
              </button>
            </div>
          </div>
          {invites.length > 0 && (
            <div className="settings-preview">
              <h4>Invites</h4>
              <ul className="report-invite-list">
                {invites.map((invite) => (
                  <li key={invite.id} className="report-invite-item">
                    <span>{invite.inviteeName}</span>
                    <span className="report-invite-role">{invite.role}</span>
                    <span className={`report-invite-status report-invite-status--${invite.status}`}>{invite.status}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </>
    )}

    {/* Comments drawer */}
    {commentsOpen && activeView && (
      <>
        <button className="record-drawer-scrim" onClick={() => setCommentsOpen(false)} aria-label="Close comments" />
        <div className="record-drawer" role="dialog" aria-modal="true" aria-label="Comments">
          <div className="record-drawer-heading">
            <h3>Comments {comments.length > 0 && `(${comments.length})`}</h3>
            <button className="icon-button subtle" onClick={() => setCommentsOpen(false)} aria-label="Close"><X size={18} /></button>
          </div>
          {commentRowKey && (
            <div className="notice"><span>Replying to row: {commentRowKey}</span><button className="field-clear" onClick={() => setCommentRowKey(null)}><X size={14} /></button></div>
          )}
          <div className="report-comments-list">
            {comments.length === 0 ? (
              <p className="report-comments-empty">No comments yet.</p>
            ) : (
              comments.map((comment) => (
                <div key={comment.id} className="report-comment">
                  <div className="report-comment-head">
                    <strong>{comment.authorName}</strong>
                    <span className="report-comment-time">{new Date(comment.createdAt).toLocaleString()}</span>
                  </div>
                  {comment.rowKey && <span className="report-comment-row">↳ Row: {comment.rowKey}</span>}
                  <p className="report-comment-body">{comment.body}</p>
                </div>
              ))
            )}
          </div>
          <div className="report-comment-composer">
            <textarea
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              placeholder="Add a comment…"
              rows={3}
              maxLength={2000}
            />
            <button className="export-button" onClick={() => void handleAddComment()} disabled={!commentBody.trim()}>
              Post comment
            </button>
          </div>
        </div>
      </>
    )}
  </div>;
}

export function ReportsPage({ schools, session, onManage, onOpenRecord, onOpenPosition }: { schools: School[]; session: LoginSession | null; onManage?: () => void; onOpenRecord?: (employeeNumber: string) => void; onOpenPosition?: (posNumber: string, organization: string) => void }) {
  const [schoolId, setSchoolId] = useState('');
  const [sections, setSections] = useState<ReportSection[]>([]);
  const [reports, setReports] = useState<ReportDefinition[]>([]);
  const [catalogError, setCatalogError] = useState('');
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [activeReport, setActiveReport] = useState<ReportDefinition | null>(null);
  const [result, setResult] = useState<GenericReportRun | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState('');
  const [recentRuns, setRecentRuns] = useState<RecentRun[]>(() => loadRecentRuns(session?.user.id ?? ''));

  const isAdmin = session?.user.roles.includes('hr_admin') ?? false;
  const selectedSchool = schools.find((school) => school.id === schoolId) ?? null;
  const userId = session?.user.id ?? '';

  // Default to the user's last school (a school is required before a report can run).
  // Prefer the saved school when it still exists in the list; otherwise first school.
  useEffect(() => {
    if (!schoolId && schools.length > 0) {
      const saved = loadLastSchool(userId);
      const savedSchool = saved ? schools.find((school) => school.id === saved) : null;
      setSchoolId(savedSchool?.id ?? schools[0].id);
    }
  }, [schools, schoolId, userId]);

  // Persist the school selection per user.
  useEffect(() => {
    if (schoolId) saveLastSchool(userId, schoolId);
  }, [schoolId, userId]);

  // Persist the newly-opened report per user.
  useEffect(() => {
    if (activeReport) saveLastReport(userId, activeReport.id);
  }, [activeReport, userId]);

  useEffect(() => {
    setCatalogLoading(true);
    setCatalogError('');
    Promise.all([
      getReportSections(session, isAdmin),
      getReports(session, undefined, isAdmin)
    ])
      .then(([nextSections, nextReports]) => {
        setSections(nextSections);
        setReports(nextReports);
      })
      .catch(() => setCatalogError('The report catalog could not be loaded.'))
      .finally(() => setCatalogLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id]);

  useEffect(() => {
    if (!activeReport || !selectedSchool) {
      setResult(null);
      return;
    }
    setReportLoading(true);
    setReportError('');
    runReport(session, activeReport.id, selectedSchool.name)
      .then((run) => setResult(run))
      .catch((failure: unknown) => setReportError(failure instanceof Error && failure.message === 'REPORT_INACTIVE'
        ? 'This report is inactive. An admin can preview it from Settings.'
        : 'The report could not be loaded.'))
      .finally(() => setReportLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeReport?.id, selectedSchool?.name]);

  // Record each successful run into the user's recent-runs list (client v0).
  useEffect(() => {
    if (!result) return;
    setRecentRuns(recordRecentRun(userId, {
      reportId: result.report.id,
      reportTitle: result.report.title,
      organization: result.organization
    }));
  }, [result?.report.id, result?.organization, userId]);

  function openReport(reportDefinition: ReportDefinition) {
    setActiveReport(reportDefinition);
    setResult(null);
    setReportError('');
  }

  function backToCatalog() {
    setActiveReport(null);
    setResult(null);
    setReportError('');
  }

  // One-click re-run from the recent-runs strip: locate the report in the catalog
  // (by id) and the school (by name), then open it with that school selected.
  function runFromRecent(run: RecentRun) {
    const definition = reports.find((report) => report.id === run.reportId);
    if (!definition) return;
    const school = schools.find((school) => school.name === run.organization);
    if (school) setSchoolId(school.id);
    setActiveReport(definition);
    setResult(null);
    setReportError('');
  }

  const visibleReports = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return reports;
    return reports.filter((report) => `${report.title} ${report.description}`.toLowerCase().includes(needle));
  }, [reports, filter]);

  if (activeReport) {
    if (reportLoading) return <section className="reports-page"><div className="empty-state"><span className="loader" />Loading {activeReport.title}</div></section>;
    if (reportError) return <section className="reports-page"><div className="notice error"><AlertCircle size={18} /><span>{reportError}</span></div><button className="back-button" onClick={backToCatalog}><ArrowLeft size={17} />All reports</button></section>;
    if (result) return <section className="reports-page"><GenericReportView result={result} session={session} onBack={backToCatalog} onOpenRecord={onOpenRecord} onOpenPosition={onOpenPosition} /></section>;
    return <section className="reports-page"><div className="empty-state"><AlertCircle size={26} /><p>Select a school to run the report.</p></div><button className="back-button" onClick={backToCatalog}><ArrowLeft size={17} />All reports</button></section>;
  }

  return <section className="reports-page" aria-labelledby="reports-title">
    <div className="reports-page-heading">
      <div><p className="eyebrow">Report center</p><h2 id="reports-title">Choose a report.</h2><p className="reports-intro">Browse the available HR reports and spreadsheet exports. Select a school to filter report results.</p></div>
      <div className="report-count"><strong>{reports.length}</strong><span>report options</span></div>
    </div>
    <div className="report-toolbar">
      <SchoolCombobox
        schools={schools}
        value={schoolId}
        onChange={setSchoolId}
        emptyLabel="Select a school…"
        ariaLabel="Select school"
        leadingIcon={<Building2 size={17} aria-hidden="true" />}
      />
      <label className="report-search"><Search size={18} aria-hidden="true" /><span className="sr-only">Filter reports</span><input placeholder="Filter reports" value={filter} onChange={(event) => setFilter(event.target.value)} /></label>
    </div>
    {recentRuns.length > 0 && <div className="recent-runs" aria-label="Recently run">
      <div className="recent-runs-title"><span className="recent-runs-icon"><Clock size={16} aria-hidden="true" /></span>Recently run</div>
      <div className="recent-runs-strip">{recentRuns.map((run) => (
        <button className="recent-run-chip" key={`${run.reportId}:${run.organization}`} onClick={() => runFromRecent(run)}>
          <span className="recent-run-name">{run.reportTitle}</span>
          <span className="recent-run-org">{run.organization}</span>
          <span className="recent-run-meta">{formatRelativeTime(run.ranAt)}</span>
        </button>
      ))}</div>
    </div>}
    {catalogError && <div className="notice error"><AlertCircle size={18} /><span>{catalogError}</span></div>}
    {catalogLoading
      ? <div className="empty-state"><span className="loader" />Loading reports</div>
      : <div className="report-categories">{sections.map((section) => {
        const sectionReports = visibleReports.filter((report) => report.sectionId === section.id);
        if (sectionReports.length === 0) return null;
        return <section className="report-category" key={section.id}><div className="report-category-heading"><span className="category-icon"><BarChart3 size={17} /></span><h3>{section.title}</h3><span>{sectionReports.length} options</span></div><div className="report-options">{sectionReports.map((report) => <ReportOption key={report.id} report={report} onOpen={openReport} />)}</div></section>;
      })}</div>}
  </section>;
}
