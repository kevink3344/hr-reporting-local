import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Building2, Info } from 'lucide-react';
import { getSchoolKpi } from './api';
import { KpiBarList } from './KpiBarList';
import { KpiTile } from './KpiTile';
import { radioGroupKeys } from './radioGroupKeys';
import { SchoolCombobox } from './SchoolCombobox';
import type { KpiBar, KpiFacet, KpiMetricKey, KpiMetricValue, KpiTarget, LoginSession, School, SchoolKpiPayload } from './types';

const FACET_ORDER: KpiFacet[] = ['all', 'filled', 'vacant'];
const FACET_LABEL: Record<KpiFacet, string> = { all: 'All', filled: 'Filled', vacant: 'Vacant' };

type KpiDashboardPageProps = {
  session: LoginSession | null;
  schools: School[];
  schoolId: string;
  onSchoolChange: (schoolId: string) => void;
  /**
   * A list request handed over by the definition page. The facet travels with
   * the metric because a metric without a tile (active-staff) has no entry in
   * the dashboard payload to read a default facet from.
   */
  pendingRequest: { metric: KpiMetricKey; facet: KpiFacet } | null;
  onPendingHandled: () => void;
  onDrill: (target: KpiTarget) => void;
  onDefine: (metric: KpiMetricKey) => void;
};

/**
 * The KPI dashboard: pick a school, see four clickable tiles plus the seat
 * breakdown by Position Title.
 *
 * Everything on this page is clickable by design — a tile opens the list for
 * that metric, a bar opens the list filtered to that Position Title, and the ⓘ
 * opens the metric's definition page. Nothing opens a dialog.
 */
export function KpiDashboardPage({ session, schools, schoolId, onSchoolChange, pendingRequest, onPendingHandled, onDrill, onDefine }: KpiDashboardPageProps) {
  const [payload, setPayload] = useState<SchoolKpiPayload | null>(null);
  const [facet, setFacet] = useState<KpiFacet>('vacant');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!session || !schoolId) {
      setPayload(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    getSchoolKpi(session, schoolId, facet)
      .then((result) => {
        if (!cancelled) setPayload(result);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setPayload(null);
        const code = cause instanceof Error ? cause.message : '';
        if (code === 'SCHOOL_NOT_PERMITTED') setError('Your account cannot view that school.');
        else if (code === 'SCHOOL_NOT_FOUND') setError('That school no longer exists.');
        else setError('Could not load the dashboard for that school.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session, schoolId, facet]);

  const stripByKey = useMemo(() => {
    const map = new Map<KpiMetricKey, KpiMetricValue>();
    for (const metric of payload?.strip ?? []) map.set(metric.key, metric);
    return map;
  }, [payload]);

  const authorized = stripByKey.get('authorized');
  const vacancyRate = stripByKey.get('vacancy-rate');
  const authorizedCount = authorized?.value ?? 0;

  const tileSub = useCallback(
    (metric: KpiMetricValue): string => {
      if (metric.key === 'filled' || metric.key === 'vacant') {
        if (authorizedCount <= 0) return `of 0 authorized`;
        return `${((metric.value / authorizedCount) * 100).toFixed(1)}% of ${authorized?.displayValue ?? '0'} authorized`;
      }
      // The window travels on the metric, so the certificate tile can honestly
      // say a longer look-ahead than the contract tile next to it.
      return typeof metric.windowDays === 'number' ? `within ${metric.windowDays} days` : '';
    },
    [authorizedCount, authorized?.displayValue]
  );

  function drill(metric: KpiMetricValue) {
    if (!metric.drillable || !payload) return;
    onDrill({
      metric: metric.key,
      // The tile stands for its own default facet — that is what makes the
      // list count equal the number on the tile.
      facet: metric.defaultFacet,
      posName: '',
      q: '',
      schoolId,
      schoolName: payload.school
    });
  }

  function drillBar(bar: KpiBar) {
    if (!payload) return;
    const metric = payload.tiles.find((tile) => tile.drillable && tile.defaultFacet === facet) ?? payload.tiles.find((tile) => tile.drillable);
    onDrill({
      metric: metric?.key ?? 'vacant',
      facet,
      posName: bar.posName,
      q: '',
      schoolId,
      schoolName: payload.school
    });
  }

  const barMax = useMemo(() => payload?.breakdown.bars.reduce((max, bar) => Math.max(max, bar.value), 0) ?? 0, [payload]);

  // The definition page can link straight to "the list" for a metric, but it
  // does not know which school is on screen. So it parks the request here and we
  // open the list as soon as a school is chosen — including for a metric that
  // has no tile, which the dashboard payload could never resolve.
  useEffect(() => {
    if (!pendingRequest || !schoolId) return;
    onPendingHandled();
    onDrill({
      metric: pendingRequest.metric,
      facet: pendingRequest.facet,
      posName: '',
      q: '',
      schoolId,
      schoolName: schools.find((school) => school.id === schoolId)?.name ?? payload?.school ?? ''
    });
  }, [pendingRequest, schoolId, schools, payload?.school, onDrill, onPendingHandled]);

  return (
    <div className="kpi-page">
      <header className="kpi-page-head">
        <div>
          <h2>KPI dashboard</h2>
          <p className="kpi-intro">Every tile, bar, and number here opens the exact list it was counted from. Pick a school to scope the whole page.</p>
        </div>
      </header>

      <div className="kpi-scope">
        <div className="kpi-field">
          <span id="kpi-school-label">School</span>
          <SchoolCombobox schools={schools} value={schoolId} onChange={onSchoolChange} ariaLabel="School" leadingIcon={<Building2 size={15} />} emptyLabel="Select a school…" allowEmpty />
        </div>
        {payload ? (
          <div className="kpi-meta">
            <div>
              <span className="kpi-meta-k">Authorized</span>
              <span className="kpi-meta-v">{authorized?.displayValue ?? '0'}</span>
            </div>
            <div>
              <span className="kpi-meta-k">Vacancy rate</span>
              <span className="kpi-meta-v warn">{vacancyRate?.displayValue ?? '—'}</span>
            </div>
            <div>
              <span className="kpi-meta-k">As of</span>
              <span className="kpi-meta-v">{payload.asOf}</span>
            </div>
          </div>
        ) : null}
      </div>

      <p className="kpi-hint">
        <Info size={15} aria-hidden />
        <span>
          <b>Everything here is clickable.</b> Click a tile for the full list, a row below for one position title, or the ⓘ for how the number is defined.
        </span>
      </p>

      {!schoolId ? (
        <div className="empty-state">
          <Building2 size={26} />
          <p>Choose a school above to see its KPIs. Authorized seats, vacancy rate, expiring certificates, and the Position Title breakdown all scope to that school.</p>
        </div>
      ) : error ? (
        <div className="empty-state" role="alert">
          <AlertCircle size={26} />
          <p>{error}</p>
        </div>
      ) : loading && !payload ? (
        <div className="empty-state">
          <span className="loader" />
          Loading KPIs
        </div>
      ) : payload ? (
        <>
          <h3 className="kpi-section-title">Overview · {payload.school}</h3>
          <div className="kpi-tiles">
            {payload.tiles.map((metric) => (
              <KpiTile key={metric.key} metric={metric} sub={tileSub(metric)} onDrill={drill} onDefine={onDefine} />
            ))}
          </div>

          <div className="kpi-card">
            <div className="kpi-card-head">
              <div>
                <h3>{payload.breakdown.title}</h3>
                <p className="kpi-card-sub">
                  {payload.breakdown.bars.length === 0
                    ? 'No positions in this view.'
                    : `Showing the top ${payload.breakdown.bars.length} of ${payload.breakdown.titleCount} position titles in this view.`}
                </p>
              </div>
              <div className="segmented-control" role="radiogroup" aria-label="Seat status">
                {FACET_ORDER.map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={facet === option}
                    tabIndex={facet === option ? 0 : -1}
                    className={facet === option ? 'active' : ''}
                    onClick={() => setFacet(option)}
                    onKeyDown={radioGroupKeys(FACET_ORDER, facet, setFacet)}
                  >
                    {FACET_LABEL[option]}
                  </button>
                ))}
              </div>
            </div>

            {payload.breakdown.bars.length === 0 ? (
              <p className="kpi-empty">No positions match this view. Try switching back to <b>Vacant</b>.</p>
            ) : (
              <KpiBarList bars={payload.breakdown.bars} max={barMax} accent={payload.breakdown.bars.some((bar) => bar.value > 0) && payload.facet === 'vacant'} onPick={drillBar} />
            )}

            <div className="kpi-card-foot">
              <span>
                Excludes placeholder seats <code className="kpi-code">pos_number LIKE &apos;888%&apos;</code>
              </span>
              <span>{payload.breakdown.truncated ? `Bars are capped at ${payload.breakdown.limit}; use the list for the complete set.` : 'All position titles shown.'}</span>
            </div>
          </div>

          <p className="kpi-footnote">
            <b>Why this list and the tile always agree.</b> Each tile and its list are generated from one shared predicate on the server, so the row count of the list can never drift from the number on the dashboard. The definition page shows that predicate and its read-only SQL.
          </p>
        </>
      ) : null}
    </div>
  );
}
