import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Building2,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Clock,
  Columns3,
  RotateCcw,
  Search,
  X
} from 'lucide-react';
import { getAdvancedSearchOptions, runAdvancedSearch } from './api';
import { CsvIcon, ExcelIcon, PdfIcon } from './ExportFormatIcons';
import { exportGenericReport, exportGenericReportToCsv } from './reportExport';
import { exportGenericReportToPdf } from './reportPdf';
import { SchoolCombobox } from './SchoolCombobox';
import { formatRelativeTime } from './recentRuns';
import { loadLastSchool, saveLastSchool } from './lastRun';
import { recordRecentSearch, removeRecentSearch, loadRecentSearches, type RecentSearch } from './recentSearches';
import { applyFilter, applySort, defaultViewDefinition, normalizeViewDefinition, rowKeyForRow } from './reportViews';
import type {
  AdvancedSearchFilters,
  AdvancedSearchOptions,
  AdvancedSearchPositionType,
  AdvancedSearchResult,
  AdvancedSearchRow,
  ContractTypeOption,
  LoginSession,
  School,
  ViewDefinition
} from './types';

const REPORT_TITLE = 'Advanced Search';

type Filters = {
  positionName: string;
  positionType: AdvancedSearchPositionType;
  contractTypes: string[];
  contractCode: string;
  contractStart: string;
  contractEnd: string;
  positionStart: string;
  personStart: string;
};

const EMPTY_FILTERS: Filters = {
  positionName: '',
  positionType: 'all',
  contractTypes: [],
  contractCode: '',
  contractStart: '',
  contractEnd: '',
  positionStart: '',
  personStart: ''
};

function hasAnyFilter(filters: Filters): boolean {
  return Boolean(
    filters.positionName ||
    filters.positionType !== 'all' ||
    filters.contractTypes.length > 0 ||
    filters.contractCode ||
    filters.contractStart ||
    filters.contractEnd ||
    filters.positionStart ||
    filters.personStart
  );
}

/**
 * Advanced Search — a structured, parameterised alternative to the free-text
 * report filter. Every predicate is built and bound server-side; the client
 * only sends structured filters, then reuses the shared report view machinery
 * for sorting, column hiding, text filtering and export.
 */
export function AdvancedSearchPage({
  session,
  schools,
  onOpenPosition
}: {
  session: LoginSession | null;
  schools: School[];
  onOpenPosition?: (posNumber: string, organization: string) => void;
}) {
  const userId = session?.user.id ?? null;

  const [schoolId, setSchoolId] = useState('');
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [options, setOptions] = useState<AdvancedSearchOptions | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsError, setOptionsError] = useState('');

  const [result, setResult] = useState<AdvancedSearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searched, setSearched] = useState(false);

  const [recents, setRecents] = useState<RecentSearch[]>([]);

  const [view, setView] = useState<ViewDefinition | null>(null);
  const [filterInput, setFilterInput] = useState('');
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const columnsRef = useRef<HTMLDivElement>(null);

  const school = useMemo(() => schools.find((entry) => entry.id === schoolId) ?? null, [schools, schoolId]);
  const organization = school?.name ?? '';

  // Restore the user's last school (shared with Reports) once schools load.
  useEffect(() => {
    if (!userId || schoolId || schools.length === 0) return;
    const last = loadLastSchool(userId);
    if (last && schools.some((entry) => entry.id === last)) setSchoolId(last);
  }, [userId, schools, schoolId]);

  useEffect(() => {
    setRecents(userId ? loadRecentSearches(userId) : []);
  }, [userId]);

  // Options are per-school: reload on change and drop any name/code that the
  // new school does not offer, so a stale filter can never yield an empty grid.
  useEffect(() => {
    if (!organization) {
      setOptions(null);
      setOptionsError('');
      return;
    }
    let cancelled = false;
    setOptionsLoading(true);
    setOptionsError('');
    getAdvancedSearchOptions(session, organization)
      .then((next) => {
        if (cancelled) return;
        setOptions(next);
      })
      .catch(() => {
        if (cancelled) return;
        setOptions(null);
        setOptionsError('The search options could not be loaded for this school.');
      })
      .finally(() => {
        if (cancelled) return;
        setOptionsLoading(false);
      });
    return () => { cancelled = true; };
  }, [session, organization]);

  // Changing school invalidates every option-backed filter and the results.
  function changeSchool(nextId: string) {
    setSchoolId(nextId);
    if (nextId) saveLastSchool(session?.user.id ?? 'anon', nextId);
    setFilters((prev) => ({ ...prev, positionName: '', contractCode: '' }));
    setResult(null);
    setSearched(false);
    setSearchError('');
  }

  function setFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  // Single-select drop-down: "Any Contract Type" (the empty value) clears it.
  function setContractType(code: string) {
    setFilters((prev) => ({ ...prev, contractTypes: code ? [code] : [] }));
  }

  // A vacant position has no contract and no incumbent, so contract dates and
  // Person start are both meaningless and (server-side) dropped. Clear them
  // here so what the user sees always matches what is sent. Position start is
  // kept — it belongs to the seat, and a vacant seat still has one.
  function setPositionType(next: AdvancedSearchPositionType) {
    setFilters((prev) => next === 'vacant'
      ? { ...prev, positionType: next, contractTypes: [], contractStart: '', contractEnd: '', personStart: '' }
      : { ...prev, positionType: next });
  }

  function resetFilters() {
    setFilters(EMPTY_FILTERS);
    setResult(null);
    setSearched(false);
    setSearchError('');
    setView(null);
  }

  function buildPayload(org: string, effective: Filters): AdvancedSearchFilters {
    const payload: AdvancedSearchFilters = {
      organization: org,
      positionType: effective.positionType,
      contractTypes: effective.contractTypes
    };
    if (effective.positionName) payload.positionName = effective.positionName;
    if (effective.contractCode) payload.contractCode = effective.contractCode;
    // Vacant positions have no contract and no incumbent, so the server drops
    // these anyway — not sending them keeps the request honest.
    if (effective.positionType !== 'vacant') {
      if (effective.contractStart) payload.contractStart = effective.contractStart;
      if (effective.contractEnd) payload.contractEnd = effective.contractEnd;
      if (effective.personStart) payload.personStart = effective.personStart;
    }
    // Seat-owned, so it is sent for every position type including vacant.
    if (effective.positionStart) payload.positionStart = effective.positionStart;
    return payload;
  }

  async function executeSearch(org: string, effective: Filters) {
    if (!org) {
      setSearchError('Select a school first.');
      return;
    }
    setSearching(true);
    setSearchError('');
    try {
      const next = await runAdvancedSearch(session, buildPayload(org, effective));
      setResult(next);
      setSearched(true);
      setView(defaultViewDefinition(next.columns));
      setFilterInput('');
      setColumnsOpen(false);
      if (userId) {
        setRecents(recordRecentSearch(userId, {
          organization: org,
          positionName: effective.positionName || undefined,
          positionType: effective.positionType,
          contractTypes: effective.contractTypes,
          contractCode: effective.contractCode || undefined,
          contractStart: effective.positionType === 'vacant' ? undefined : (effective.contractStart || undefined),
          contractEnd: effective.positionType === 'vacant' ? undefined : (effective.contractEnd || undefined),
          personStart: effective.positionType === 'vacant' ? undefined : (effective.personStart || undefined),
          positionStart: effective.positionStart || undefined,
          total: next.total
        }));
      }
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : '';
      setSearchError(
        message === 'ORGANIZATION_FORBIDDEN'
          ? 'You do not have access to that school.'
          : 'The search could not be completed.'
      );
      setResult(null);
      setSearched(false);
    } finally {
      setSearching(false);
    }
  }

  function runSearch() {
    if (searching) return;
    void executeSearch(organization, filters);
  }

  function replayRecent(recent: RecentSearch) {
    const schoolMatch = schools.find((entry) => entry.name === recent.organization);
    const nextFilters: Filters = {
      positionName: recent.positionName ?? '',
      positionType: recent.positionType,
      contractTypes: [...recent.contractTypes],
      contractCode: recent.contractCode ?? '',
      contractStart: recent.contractStart ?? '',
      contractEnd: recent.contractEnd ?? '',
      positionStart: recent.positionStart ?? '',
      personStart: recent.personStart ?? ''
    };
    if (schoolMatch && schoolMatch.id !== schoolId) {
      setSchoolId(schoolMatch.id);
      saveLastSchool(session?.user.id ?? 'anon', schoolMatch.id);
    }
    setFilters(nextFilters);
    void executeSearch(schoolMatch?.name ?? organization, nextFilters);
  }

  /** Label a chip shows; reused for its remove button's accessible name. */
  function recentChipName(recent: RecentSearch): string {
    const base = recent.positionName
      || (recent.positionType === 'vacant' ? 'Vacant positions'
        : recent.positionType === 'filled' ? 'Filled positions'
          : 'All positions');
    return recent.contractTypes.length ? `${base} · ${recent.contractTypes.join(', ')}` : base;
  }

  function removeRecent(recent: RecentSearch) {
    if (!userId) return;
    setRecents(removeRecentSearch(userId, recent));
  }

  // ---- results view ----

  const columns = result?.columns ?? [];
  const activeView = useMemo(() => view ?? (columns.length ? defaultViewDefinition(columns) : null), [view, columns]);

  const displayColumns = useMemo(() => {
    if (!activeView) return [];
    return normalizeViewDefinition(columns, activeView).columnOrder
      .filter((column) => !activeView.hiddenColumns.includes(column));
  }, [activeView, columns]);

  const displayRows = useMemo(() => {
    if (!result || !activeView) return [] as AdvancedSearchRow[];
    const filtered = applyFilter(result.rows as unknown as Record<string, unknown>[], filterInput, displayColumns);
    const sorted = applySort(filtered, activeView.sort);
    return sorted as unknown as AdvancedSearchRow[];
  }, [result, activeView, filterInput, displayColumns]);

  function toggleSort(column: string) {
    setView((prev) => {
      const base = prev ?? defaultViewDefinition(columns);
      const current = base.sort;
      const nextDir = current && current.column === column && current.dir === 'asc' ? 'desc' : 'asc';
      return { ...base, sort: { column, dir: nextDir } };
    });
  }

  function toggleColumn(column: string) {
    setView((prev) => {
      const base = prev ?? defaultViewDefinition(columns);
      const hidden = base.hiddenColumns.includes(column)
        ? base.hiddenColumns.filter((entry) => entry !== column)
        : [...base.hiddenColumns, column];
      // Never let the user hide every column.
      if (hidden.length === base.columnOrder.length) return base;
      return { ...base, hiddenColumns: hidden };
    });
  }

  useEffect(() => {
    if (!columnsOpen) return;
    function onDocClick(event: MouseEvent) {
      if (columnsRef.current && !columnsRef.current.contains(event.target as Node)) setColumnsOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [columnsOpen]);

  const exportRun = useMemo(() => {
    if (!result) return null;
    return {
      report: { title: REPORT_TITLE },
      organization: result.organization,
      columns: displayColumns,
      rows: displayRows as unknown as (Record<string, unknown> & { __subreport?: undefined })[],
      truncated: result.truncated
    };
  }, [result, displayColumns, displayRows]);

  async function runExport(kind: 'excel' | 'csv' | 'pdf') {
    if (!exportRun || exporting) return;
    setExporting(true);
    try {
      if (kind === 'csv') await exportGenericReportToCsv(exportRun);
      else if (kind === 'excel') await exportGenericReport(exportRun);
      else await exportGenericReportToPdf(exportRun);
    } catch {
      setSearchError('The export could not be created.');
    } finally {
      setExporting(false);
    }
  }

  // A vacant position has no contract at all, so every contract-backed filter
  // (type, start, end) is unavailable while Vacant is selected.
  const contractsDisabled = filters.positionType === 'vacant';
  const datesDisabled = contractsDisabled;

  return <section className="advanced-search-page" aria-labelledby="advanced-search-title">
    <div className="reports-page-heading">
      <div>
        <p className="eyebrow">Advanced search</p>
        <h2 id="advanced-search-title">Find positions by any combination.</h2>
        <p className="reports-intro">Search positions by name, vacancy, contract type, contract code and contract dates. Every filter is combined — leave a field blank to ignore it.</p>
      </div>
      <div className="report-count"><strong>{result ? result.total : '—'}</strong><span>{result ? 'positions found' : 'no search yet'}</span></div>
    </div>

    <div className="advanced-search-panel">
      <div className="advanced-search-grid">
        <label className="advanced-search-field advanced-search-field--school">
          <span className="advanced-search-label">School</span>
          <SchoolCombobox
            schools={schools}
            value={schoolId}
            onChange={changeSchool}
            emptyLabel="Select a school…"
            ariaLabel="Select school for advanced search"
            leadingIcon={<Building2 size={17} aria-hidden="true" />}
          />
        </label>

        <label className="advanced-search-field">
          <span className="advanced-search-label">Position name</span>
          <select
            value={filters.positionName}
            onChange={(event) => setFilter('positionName', event.target.value)}
            disabled={!options}
          >
            <option value="">All positions</option>
            {(options?.positionNames ?? []).map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>

        <label className="advanced-search-field">
          <span className="advanced-search-label">Position type</span>
          <select
            value={filters.positionType}
            onChange={(event) => setPositionType(event.target.value as AdvancedSearchPositionType)}
          >
            <option value="all">All positions</option>
            <option value="filled">Filled only</option>
            <option value="vacant">Vacant only</option>
          </select>
        </label>

        <label className="advanced-search-field">
          <span className="advanced-search-label">Contract type</span>
          <select
            value={filters.contractTypes[0] ?? ''}
            onChange={(event) => setContractType(event.target.value)}
            disabled={!options || contractsDisabled}
            title={contractsDisabled ? 'Vacant positions have no contract type' : undefined}
          >
            <option value="">Any Contract Type</option>
            {(options?.contractTypes ?? []).map((type: ContractTypeOption) => (
              <option key={type.code} value={type.code}>
                {type.description ? `${type.code} — ${type.description}` : type.code}
                {type.count ? ` (${type.count})` : ''}
              </option>
            ))}
          </select>
          {!optionsLoading && options && options.contractTypes.length === 0 && (
            <span className="advanced-search-hint">No contract types recorded for this school.</span>
          )}
        </label>

        <label className="advanced-search-field">
          <span className="advanced-search-label">Contract code</span>
          <select
            value={filters.contractCode}
            onChange={(event) => setFilter('contractCode', event.target.value)}
            disabled={!options}
          >
            <option value="">Any code</option>
            {(options?.contractCodes ?? []).map((code) => <option key={code} value={code}>{code}</option>)}
          </select>
        </label>

        <label className="advanced-search-field">
          <span className="advanced-search-label">Contract start</span>
          <input
            type="date"
            value={filters.contractStart}
            onChange={(event) => setFilter('contractStart', event.target.value)}
            disabled={datesDisabled}
            title={datesDisabled ? 'Vacant positions have no contract dates' : undefined}
          />
        </label>

        <label className="advanced-search-field">
          <span className="advanced-search-label">Contract end</span>
          <input
            type="date"
            value={filters.contractEnd}
            onChange={(event) => setFilter('contractEnd', event.target.value)}
            disabled={datesDisabled}
            title={datesDisabled ? 'Vacant positions have no contract dates' : undefined}
          />
        </label>

        {/* Seat-owned: kept enabled for vacant rows, where it is the only way
            to ask which empty seats open on a given date. */}
        <label className="advanced-search-field">
          <span className="advanced-search-label">Position start</span>
          <input
            type="date"
            value={filters.positionStart}
            onChange={(event) => setFilter('positionStart', event.target.value)}
            title="The seat’s own start date — applies to vacant positions too"
          />
        </label>

        <label className="advanced-search-field">
          <span className="advanced-search-label">Person start</span>
          <input
            type="date"
            value={filters.personStart}
            onChange={(event) => setFilter('personStart', event.target.value)}
            disabled={datesDisabled}
            title={datesDisabled ? 'A vacant position has no incumbent to start' : undefined}
          />
        </label>
      </div>

      {optionsLoading && <span className="advanced-search-hint"><span className="loader" />Loading options…</span>}
      {optionsError && <div className="notice error"><AlertCircle size={18} /><span>{optionsError}</span></div>}
      {searchError && <div className="notice error"><AlertCircle size={18} /><span>{searchError}</span></div>}

      <div className="advanced-search-actions">
        <button
          className="primary-button"
          onClick={() => void runSearch()}
          disabled={!organization || searching}
        >
          {searching ? 'Searching…' : 'Search'}<ArrowRight size={17} />
        </button>
        <button className="link-button" onClick={resetFilters} disabled={!hasAnyFilter(filters)}>
          <RotateCcw size={15} />Reset filters
        </button>
      </div>
      <p className="advanced-search-note">
        {optionsLoading
          ? 'Loading the filters this school actually uses…'
          : datesDisabled
            ? 'Vacant positions have no contract or incumbent, so contract dates, contract type and Person start are not applied. Position start still applies — it belongs to the seat.'
            : 'Contract types come from the school’s own data, so every option returns rows. Leave it at “Any Contract Type” to ignore contract types.'}
      </p>
    </div>

    {recents.length > 0 && (
      <div className="recent-runs" aria-label="Recently searched">
        <div className="recent-runs-title"><span className="recent-runs-icon"><Clock size={16} aria-hidden="true" /></span>Recently searched</div>
        <div className="recent-runs-strip">{recents.map((recent) => (
          // A chip is two controls, so the pill is only a container: replay on
          // the left, remove on the right. Nesting a button inside a button is
          // invalid markup and would leave the ✕ unfocusable.
          <div className="recent-run-chip" key={`${recent.organization}:${recent.ranAt}`}>
            <button type="button" className="recent-run-chip-main" onClick={() => replayRecent(recent)}>
              <span className="recent-run-name">{recentChipName(recent)}</span>
              <span className="recent-run-org">{recent.organization}</span>
              <span className="recent-run-meta">{recent.total} row{recent.total === 1 ? '' : 's'} · {formatRelativeTime(recent.ranAt)}</span>
            </button>
            <button
              type="button"
              className="recent-run-remove"
              onClick={() => removeRecent(recent)}
              aria-label={`Remove recent search: ${recentChipName(recent)}, ${recent.organization}`}
              title="Remove from recent searches"
            >
              <X size={13} aria-hidden="true" />
            </button>
          </div>
        ))}</div>
      </div>
    )}

    {!searched && !searching && (
      <div className="empty-state">
        <Search size={26} />
        <p>{organization ? 'Set your filters and run a search.' : 'Select a school to begin.'}</p>
      </div>
    )}

    {searched && result && (
      <>
        <div className="report-toolbar advanced-search-toolbar">
          <label className="report-search">
            <Search size={18} aria-hidden="true" />
            <span className="sr-only">Filter results</span>
            <input placeholder="Filter these results" value={filterInput} onChange={(event) => setFilterInput(event.target.value)} />
          </label>
          <div className="columns-menu" ref={columnsRef}>
            <button className="toolbar-button" onClick={() => setColumnsOpen((open) => !open)} aria-expanded={columnsOpen} aria-haspopup="true">
              <Columns3 size={16} />Columns<ChevronDown size={14} />
            </button>
            {columnsOpen && (
              <div className="columns-popover" role="menu">
                {activeView?.columnOrder.map((column) => (
                  <label key={column} className="columns-option">
                    <input
                      type="checkbox"
                      checked={!activeView.hiddenColumns.includes(column)}
                      onChange={() => toggleColumn(column)}
                    />
                    {column}
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="export-buttons">
            <button className="toolbar-button" onClick={() => void runExport('csv')} disabled={exporting || displayRows.length === 0} title="Export CSV"><CsvIcon />CSV</button>
            <button className="toolbar-button" onClick={() => void runExport('excel')} disabled={exporting || displayRows.length === 0} title="Export Excel"><ExcelIcon />Excel</button>
            <button className="toolbar-button" onClick={() => void runExport('pdf')} disabled={exporting || displayRows.length === 0} title="Export PDF"><PdfIcon />PDF</button>
          </div>
        </div>

        <div className="advanced-search-summary">
          <span className="result-count">{result.total} {result.total === 1 ? 'position' : 'positions'}</span>
          {hasAnyFilter(filters) && <span className="advanced-search-summary-filters">
            {filters.positionName && <span className="filter-pill">{filters.positionName}</span>}
            {filters.positionType !== 'all' && <span className="filter-pill">{filters.positionType === 'vacant' ? 'Vacant' : 'Filled'}</span>}
            {!contractsDisabled && filters.contractTypes.map((code) => <span className="filter-pill" key={code}>{code}</span>)}
            {filters.contractCode && <span className="filter-pill">Code {filters.contractCode}</span>}
            {!datesDisabled && filters.contractStart && <span className="filter-pill">From {filters.contractStart}</span>}
            {!datesDisabled && filters.contractEnd && <span className="filter-pill">To {filters.contractEnd}</span>}
            {filters.positionStart && <span className="filter-pill">Position start {filters.positionStart}</span>}
            {!datesDisabled && filters.personStart && <span className="filter-pill">Person start {filters.personStart}</span>}
          </span>}
          <button className="link-button" onClick={resetFilters}><X size={14} />Clear filters</button>
        </div>

        {result.truncated && (
          <div className="notice"><AlertCircle size={18} /><span>More than {result.total} positions matched. Only the first {result.total} are shown — narrow your filters to see the rest.</span></div>
        )}

        {displayRows.length === 0
          ? <div className="empty-state">
              <CalendarClock size={26} />
              <p>{filterInput ? 'No rows match your filter.' : 'No positions matched these filters.'}</p>
              {filterInput && <button className="link-button" onClick={() => setFilterInput('')}>Clear text filter</button>}
            </div>
          : <div className="report-table-wrap">
              <table className="report-table">
                <thead>
                  <tr>
                    {displayColumns.map((column) => (
                      <th
                        key={column}
                        role="button"
                        tabIndex={0}
                        onClick={() => toggleSort(column)}
                        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleSort(column); } }}
                        aria-label={`Sort by ${column}`}
                        title="Click to sort"
                        className="report-th-clickable"
                      >
                        <span className="th-inner">
                          {column}
                          {activeView?.sort?.column === column && (activeView.sort.dir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map((row, index) => {
                    const key = rowKeyForRow(row as unknown as Record<string, unknown>, result.columns, 'Pos No') || String(index);
                    const clickable = Boolean(onOpenPosition && row['Pos No']);
                    return <tr key={`${key}:${index}`} className={row.Vacant ? 'advanced-search-row--vacant' : undefined}>
                      {displayColumns.map((column) => {
                        if (column === 'Name') {
                          return <td key={column} className="advanced-search-name-cell">
                            {row.Vacant
                              // The API can only send plain text (exports have no HTML),
                              // so the badge is rendered here from the `Vacant` flag. This
                              // is the exact badge the People lookup renders.
                              ? <span className="badge-vacant">Vacant</span>
                              : clickable
                                ? <button className="link-button" onClick={() => onOpenPosition?.(row['Pos No'], row.Organization)}>{row.Name}</button>
                                : row.Name}
                          </td>;
                        }
                        if (column === 'Pos No' && clickable) {
                          return <td key={column}><button className="link-button" onClick={() => onOpenPosition?.(row['Pos No'], row.Organization)}>{row['Pos No']}</button></td>;
                        }
                        const value = row[column as keyof AdvancedSearchRow];
                        return <td key={column}>{value === null || value === undefined ? '' : String(value)}</td>;
                      })}
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>}
      </>
    )}
  </section>;
}
