import { ChevronRight } from 'lucide-react';
import type { KpiMetricKey, KpiMetricValue } from './types';

type KpiTileProps = {
  metric: KpiMetricValue;
  /** Secondary line under the label — usually the share of authorized seats. */
  sub: string;
  onDrill: (metric: KpiMetricValue) => void;
  onDefine: (key: KpiMetricKey) => void;
};

/**
 * One KPI tile.
 *
 * The body is a real `<button>` so the whole tile is keyboard-reachable and
 * announces itself as a control. The ⓘ affordance is a *sibling* `<a>` — never
 * nested inside the button, because interactive content cannot contain
 * interactive content. A tile without a `drilldown` renders inert.
 */
export function KpiTile({ metric, sub, onDrill, onDefine }: KpiTileProps) {
  // The mock highlights exactly one tile in the accent colour: the one that
  // counts what is missing. `defaultFacet === 'vacant'` identifies it without
  // hard-coding a metric key.
  const accent = metric.defaultFacet === 'vacant';
  const defines = `${metric.label} — how this is calculated`;

  const body = (
    <>
      <span className="kpi-tile-value">{metric.displayValue}</span>
      <span className="kpi-tile-label">{metric.label}</span>
      <span className="kpi-tile-sub">{sub}</span>
      <span className="kpi-tile-open">
        View {metric.unit === 'people' ? 'people' : 'positions'}
        <ChevronRight size={13} aria-hidden />
      </span>
    </>
  );

  return (
    <div className={accent ? 'kpi-tile accent' : 'kpi-tile'}>
      {metric.drillable ? (
        <button type="button" className="kpi-tile-main" onClick={() => onDrill(metric)} aria-label={`${metric.label}: ${metric.displayValue}. View the ${metric.label.toLowerCase()} list.`}>
          {body}
        </button>
      ) : (
        <div className="kpi-tile-main">{body}</div>
      )}
      <button type="button" className="kpi-info" title={defines} aria-label={`${defines}. Opens the definition page.`} onClick={() => onDefine(metric.key)}>
        i
      </button>
    </div>
  );
}
