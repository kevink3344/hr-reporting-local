import type { GenericReportRow, GenericReportRowWithSubreport, GenericReportRun } from '../types.js';
import type { Repositories } from './contracts.js';
import { mysqlRepositories } from './mysql-repository.js';
import { tursoRepositories } from './turso-repository.js';
import { query } from '../db.js';
import { REPORT_ROW_CAP, bindNamedParam, bindOrganization, validateReportSql, validateSubreportSql } from '../reports-sql.js';

/**
 * Hybrid repository: MySQL answers report DATA, Turso persists CONFIG.
 *
 * Rationale: with DATA_SOURCE=mysql the report *data* runs against the live
 * MySQL database, but every configurable piece (report sections, definitions,
 * views, invites, comments, pins, flags, future positions) falls back to the
 * in-memory fixture seed and is lost on restart. That is the gap this closes.
 *
 * The wiring mirrors the real-world split the user asked for:
 *   - DATA  (people, schools, personRecords, reports, positions): MySQL
 *   - CONFIG (reportSections, reportViews, reportViewInvites, reportViewComments,
 *     positionPins, positionComments, systemMessages, futurePositions,
 *     featureFlags): Turso (persisted, survives restarts, shared across runs)
 *   - reportDefinitions: config (list/getById/create/update/delete/
 *     countBySection/explain) from Turso, but `run()` executes the stored SQL
 *     against the LIVE MySQL database.
 *
 * Why the run() override: `tursoRepositories.reportDefinitions.run` executes
 * against the Turso (SQLite) replica, which only has the synthetic seed rows.
 * `mysqlRepositories.reportDefinitions.run` already sources its definition via
 * `fixtureRepositories.getById` but executes against live MySQL. Here we take
 * the definition from Turso (real persisted config) and reuse the proven
 * MySQL execution path with subreport hydration.
 */
export const hybridRepositories: Repositories = {
  // ---- DATA: MySQL ----
  people: mysqlRepositories.people,
  schools: mysqlRepositories.schools,
  personRecords: mysqlRepositories.personRecords,
  reports: mysqlRepositories.reports,
  positions: mysqlRepositories.positions,
  schoolKpi: mysqlRepositories.schoolKpi,

  // ---- CONFIG: Turso ----
  reportSections: tursoRepositories.reportSections,
  reportViews: tursoRepositories.reportViews,
  reportViewInvites: tursoRepositories.reportViewInvites,
  reportViewComments: tursoRepositories.reportViewComments,
  positionPins: tursoRepositories.positionPins,
  positionComments: tursoRepositories.positionComments,
  systemMessages: tursoRepositories.systemMessages,
  users: mysqlRepositories.users,
  futurePositions: tursoRepositories.futurePositions,
  featureFlags: tursoRepositories.featureFlags,
  styleThemes: tursoRepositories.styleThemes,
  aiHistory: tursoRepositories.aiHistory,

  // ---- CONFIG: Turso, DATA: MySQL ----
  reportDefinitions: {
    ...tursoRepositories.reportDefinitions,
    async run(id, organization) {
      // Source the persisted definition from Turso (real config).
      const definition = await tursoRepositories.reportDefinitions.getById(id);
      if (!definition || !definition.sqlQuery) return null;

      // Defense in depth: re-validate the stored SQL at run time.
      const safety = validateReportSql(definition.sqlQuery);
      if (!safety.ok) throw new Error(safety.error);
      if (definition.subreportQuery) {
        const subSafety = validateSubreportSql(definition.subreportQuery);
        if (!subSafety.ok) throw new Error(subSafety.error);
      }

      // Execute against the LIVE MySQL database.
      const { text, params } = bindOrganization(definition.sqlQuery, organization);
      const rows = await query<Record<string, unknown>>(text, params as never);
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
      const mainRows: GenericReportRowWithSubreport[] = rows.slice(0, REPORT_ROW_CAP).map((row) => {
        const record: GenericReportRow = {};
        for (const column of columns) {
          const value = row[column];
          record[column] = value === null ? null : value;
        }
        return record;
      });

      // Subreport support: mirror the MySQL repo's per-row child hydration.
      if (definition.subreportQuery && definition.subreportKeyColumn) {
        const keyColumn = definition.subreportKeyColumn;
        let subColumns: string[] = [];
        const childCache = new Map<string, GenericReportRow[]>();
        try {
          const probe = bindNamedParam(definition.subreportQuery, 'person_id', '___probe___');
          const subProbe = await query<Record<string, unknown>>(probe.text, probe.params as never);
          subColumns = subProbe.length > 0 ? Object.keys(subProbe[0]) : ([] as string[]);
        } catch {
          subColumns = [];
        }
        for (const row of mainRows) {
          const keyValue = row[keyColumn];
          if (keyValue === undefined || keyValue === null) continue;
          const cacheKey = String(keyValue);
          if (!childCache.has(cacheKey)) {
            const child = bindNamedParam(definition.subreportQuery, 'person_id', keyValue as string);
            const childRows = await query<Record<string, unknown>>(child.text, child.params as never);
            childCache.set(
              cacheKey,
              childRows.slice(0, REPORT_ROW_CAP).map((r) => {
                const record: GenericReportRow = {};
                for (const column of subColumns.length > 0 ? subColumns : Object.keys(r)) {
                  record[column] = r[column] === null ? null : r[column];
                }
                return record;
              })
            );
          }
          (row as GenericReportRowWithSubreport).__subreport = {
            keyColumn,
            columns: subColumns,
            rows: childCache.get(cacheKey) ?? [],
            truncated: false
          };
        }
        return {
          report: {
            id: definition.id,
            title: definition.title,
            description: definition.description,
            sectionTitle: definition.sectionTitle,
            highlightRules: definition.highlightRules,
            additionalColumns: definition.additionalColumns
          },
          organization,
          columns: definition.columns && definition.columns.length > 0 ? definition.columns : columns,
          rows: mainRows,
          subreport: { keyColumn },
          truncated: rows.length > REPORT_ROW_CAP
        } satisfies GenericReportRun;
      }

      return {
        report: {
          id: definition.id,
          title: definition.title,
          description: definition.description,
          sectionTitle: definition.sectionTitle,
          highlightRules: definition.highlightRules,
          additionalColumns: definition.additionalColumns
        },
        organization,
        columns: definition.columns && definition.columns.length > 0 ? definition.columns : columns,
        rows: mainRows,
        subreport: null,
        truncated: rows.length > REPORT_ROW_CAP
      } satisfies GenericReportRun;
    },
    // Override the inherited Turso explain(): it EXPLAINs against the SQLite
    // replica, but the stored report SQL uses MySQL dialect (concat(), now(),
    // derived tables) that SQLite cannot parse — yielding a false
    // 'SQL_EXPLAIN_FAILED'. Since hybrid runs report DATA against live MySQL,
    // validate against MySQL here so the Settings page's Validate button
    // accepts MySQL-dialect queries.
    async explain(sqlQuery: string) {
      const safety = validateReportSql(sqlQuery);
      if (!safety.ok) return safety;
      try {
        const { text, params } = bindOrganization(sqlQuery.trim(), '__validate__');
        await query(`EXPLAIN ${text}`, params as never);
        return { ok: true };
      } catch {
        return { ok: false, error: 'SQL_EXPLAIN_FAILED' };
      }
    }
  }
};
