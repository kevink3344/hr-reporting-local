import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowLeft, Info, ListChecks } from 'lucide-react';
import { getKpiCatalog, getKpiDefinition } from './api';
import type { KpiCatalog, KpiFacet, KpiMetricDefinition, KpiMetricKey } from './types';

type KpiDefinitionPageProps = {
  metric: KpiMetricKey;
  onBack: () => void;
  onChooseMetric: (metric: KpiMetricKey) => void;
  /**
   * Opens the metric's list. The facet travels with the metric because the
   * dashboard has no payload entry for a metric without a tile, so it cannot
   * look the facet up the way it does for a tile click.
   */
  onDrill: (metric: KpiMetricKey, facet: KpiFacet) => void;
};

/**
 * How one metric is calculated.
 *
 * This is a page rather than a dialog on purpose: a metric's definition, its
 * filters, and its read-only SQL need to be linkable, printable, and citable in
 * a data question. It renders whatever the server's catalog says — the text and
 * the SQL are never duplicated on the client, so this page cannot drift from
 * the numbers on the dashboard.
 */
export function KpiDefinitionPage({ metric, onBack, onChooseMetric, onDrill }: KpiDefinitionPageProps) {
  const [definition, setDefinition] = useState<KpiMetricDefinition | null>(null);
  const [catalog, setCatalog] = useState<KpiCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    getKpiDefinition(metric)
      .then((result) => {
        if (!cancelled) setDefinition(result);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setDefinition(null);
        const code = cause instanceof Error ? cause.message : '';
        setError(code.startsWith('UNKNOWN_KPI_METRIC') ? 'That metric is not recognised.' : 'Could not load this definition.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [metric]);

  useEffect(() => {
    let cancelled = false;
    getKpiCatalog()
      .then((result) => {
        if (!cancelled) setCatalog(result);
      })
      .catch(() => {
        // The switcher is a convenience; the page stands without it.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const statements = useMemo(
    () =>
      definition
        ? [
            { key: 'count', label: 'Tile count — the number on the dashboard', sql: definition.sql.count },
            { key: 'rows', label: 'List rows — what the drill-down shows', sql: definition.sql.rows }
          ]
        : [],
    [definition]
  );

  // The catalogue carries a label for every metric so the switcher never shows a
  // raw key. Older payloads without `metrics` fall back to the bare key list.
  const switcher = useMemo<Array<{ key: KpiMetricKey; label: string; drillable: boolean }>>(
    () =>
      catalog?.metrics?.length
        ? catalog.metrics.map((entry) => ({ key: entry.key, label: entry.label, drillable: entry.drillable }))
        : (catalog?.keys ?? []).map((key) => ({ key, label: key, drillable: false })),
    [catalog]
  );

  return (
    <div className="kpi-page">
      <nav className="kpi-crumbs" aria-label="Breadcrumb">
        <button type="button" onClick={onBack} aria-label="Back to the KPI dashboard">
          <ArrowLeft size={14} aria-hidden /> Back to KPI dashboard
        </button>
        <span className="sep" aria-hidden>
          /
        </span>
        <span className="here" aria-current="page">
          How &ldquo;{definition?.label ?? metric}&rdquo; is calculated
        </span>
      </nav>

      <header className="kpi-page-head">
        <div>
          <h2>How &ldquo;{definition?.label ?? metric}&rdquo; is calculated</h2>
          <p className="kpi-intro">{definition?.definition ?? ''}</p>
        </div>
        {definition?.drilldown ? (
          <div className="kpi-actions">
            <button type="button" className="kpi-btn" onClick={() => onDrill(definition.key, definition.defaultFacet ?? 'all')}>
              <ListChecks size={14} aria-hidden /> Go to the list
            </button>
          </div>
        ) : null}
      </header>

      {catalog ? (
        <nav className="kpi-switcher" aria-label="Choose a metric">
          <span className="kpi-switcher-label">Metric</span>
          <span className="kpi-chips">
            {switcher.map((entry) => (
              <button key={entry.key} type="button" className={entry.key === metric ? 'kpi-chip active' : 'kpi-chip'} aria-current={entry.key === metric ? 'true' : undefined} title={entry.drillable ? `${entry.label} — has a list you can open` : `${entry.label} — documented here only`} onClick={() => onChooseMetric(entry.key)}>
                {entry.key === metric ? definition?.label ?? entry.label : entry.label}
              </button>
            ))}
          </span>
        </nav>
      ) : null}

      {error ? (
        <div className="empty-state" role="alert">
          <AlertCircle size={26} />
          <p>{error}</p>
        </div>
      ) : loading && !definition ? (
        <div className="empty-state">
          <span className="loader" />
          Loading definition
        </div>
      ) : definition ? (
        <>
          <div className="kpi-card">
            <div className="kpi-card-head">
              <h3>Definition</h3>
            </div>
            <div className="kpi-card-body">
              <p className="kpi-lead">{definition.definition}</p>
              <dl className="kpi-dl">
                <dt>Unit</dt>
                <dd>{definition.unit === 'people' ? 'People (a person holding two seats counts once)' : 'Positions (one row per budgeted seat)'}</dd>
                <dt>Aggregate</dt>
                <dd>{definition.aggregate === 'share' ? `A share, computed from ${definition.shareOf ?? 'another metric'}` : 'A count'}</dd>
                <dt>Tile</dt>
                <dd>{catalog?.tileOrder.includes(definition.key) ? 'Has its own tile on the dashboard' : catalog?.stripOrder.includes(definition.key) ? 'Shown in the dashboard strip' : 'Not shown on the dashboard; documented here only'}</dd>
                <dt>Drill-down</dt>
                <dd>{definition.drilldown ? 'Opens the list of positions this metric counts' : 'No list (a share is not a list of seats)'}</dd>
                <dt>Note</dt>
                <dd>{definition.note}</dd>
              </dl>
            </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-card-head">
              <h3>Filters applied</h3>
              <p className="kpi-card-sub">Every metric shares the same open-seat rules; the extra tests are what make each metric distinct.</p>
            </div>
            <div className="kpi-card-body">
              <table className="kpi-data-table">
                <caption>Filters applied to this metric</caption>
                <thead>
                  <tr>
                    <th scope="col">Columns involved</th>
                    <th scope="col">Rule, in plain English</th>
                  </tr>
                </thead>
                <tbody>
                  {definition.filters.map((filter) => (
                    <tr key={`${filter.column}-${filter.test}`}>
                      <td>
                        <code className="kpi-code">{filter.column}</code>
                      </td>
                      <td>{filter.test}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-card-head">
              <h3>Source tables</h3>
            </div>
            <div className="kpi-card-body">
              <ul>
                {definition.sourceTables.map((table) => (
                  <li key={table}>
                    <code className="kpi-code">{table}</code>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-card-head">
              <h3>Read-only SQL</h3>
              <p className="kpi-card-sub">
                The <b>count</b> query produces the number on the tile. The <b>rows</b> query produces the list. Both are built from the same predicate — only <code className="kpi-code">COUNT(*)</code> versus <code className="kpi-code">SELECT …</code> differs.
              </p>
            </div>
            <div className="kpi-card-body">
              {statements.map((statement) => (
                <div className="kpi-sql" key={statement.key}>
                  <div className="kpi-sql-label">{statement.label}</div>
                  <pre>
                    <code>{statement.sql}</code>
                  </pre>
                </div>
              ))}
              <p className="kpi-footnote">
                Static, author-scoped and school-parameterised — <code className="kpi-code">:organization</code> is bound server-side. Gated by <code className="kpi-code">validateReadOnlySql</code> in <code className="kpi-code">src/reports-sql.ts</code>. No salary columns are selected.
              </p>
            </div>
          </div>

          <div className="kpi-caveat">
            <Info size={15} aria-hidden />
            <div>
              <b>Why this list and the tile always agree.</b> The tile count and the drill-down list are generated from a single shared predicate, so the row count of the list can never drift from the number on the dashboard. This page is the third view of that same predicate — it is the definition, not a second implementation.
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
