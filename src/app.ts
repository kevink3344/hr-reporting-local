import express from 'express';
import swaggerUi from 'swagger-ui-express';
import { z } from 'zod';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Repo root = one level up from this module (dist/ or src/). Resolve the built
// React client relative to the module so it works regardless of process.cwd().
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = resolve(MODULE_DIR, '..', 'client', 'dist');
import { fixtureRepositories } from './repositories/fixture-repository.js';
import { mysqlRepositories } from './repositories/mysql-repository.js';
import { tursoRepositories } from './repositories/turso-repository.js';
import { hybridRepositories } from './repositories/hybrid-repository.js';
import type { Repositories } from './repositories/contracts.js';
import { authenticateFixtureUser } from './repositories/fixture-auth.js';
import { authenticateMysqlUser } from './repositories/mysql-auth.js';
import { getDataSource } from './config.js';
import { isDbReady } from './db.js';
import { isDbReady as isTursoDbReady } from './db-turso.js';
import { openApiDocument } from './openapi.js';
import { viewDefinitionSchema } from './report-views.js';
import { reportHighlightRulesSchema } from './report-highlight.js';
import { validateSubreportSql } from './reports-sql.js';
import {
  EXPIRY_WINDOW_DAYS,
  KPI_BAR_LIMIT,
  KPI_CATALOG_METRICS,
  KPI_METRIC_KEYS,
  KPI_STRIP_ORDER,
  KPI_TILE_ORDER,
  defaultFacetFor,
  getKpiMetric,
  isKpiMetricKey
} from './kpi-definitions.js';
import type { School, DirectoryResult } from './types.js';
import { isAiConfigured } from './config.js';
import { ask as aiAsk, listHistory as aiListHistory, getHistory as aiGetHistory, deleteHistory as aiDeleteHistory } from './ai/ai.js';

const querySchema = z.object({
  search: z.string().trim().optional(),
  schoolId: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25)
});

// Unified Directory search. `search` is REQUIRED and non-empty so a blank query
// can never trigger a full-table scan. Number-only: 6 digits = employee number,
// 7 digits = position number, anything else = people text search (unchanged).
const directoryQuerySchema = z.object({
  search: z.string().trim().min(1),
  schoolId: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50)
});

const EMPLOYEE_NUMBER_RE = /^\d{6}$/;
const POSITION_NUMBER_RE = /^\d{7}$/;

const loginSchema = z.object({
  wakeId: z.string().trim().min(1),
  employeeId: z.string().trim().min(1)
});

const openPositionQuerySchema = z.object({
  organization: z.string().trim().min(1)
});

// ---- Clickable KPI dashboard ----
//
// The dashboard is always scoped to exactly one school: the client sends the
// school id it already holds (the value `SchoolCombobox` uses everywhere else)
// and the route resolves it to the `position_info.organization` string. That
// keeps scoping id-based, so it uses the same `x-user-school-ids` comparison the
// rest of the API does.
const kpiFacetSchema = z.enum(['all', 'filled', 'vacant']);

const schoolKpiQuerySchema = z.object({
  schoolId: z.string().trim().min(1),
  facet: kpiFacetSchema.optional().default('all')
});

const schoolKpiRowsQuerySchema = z.object({
  schoolId: z.string().trim().min(1),
  // Validated against the catalog by `getKpiMetric`, which throws
  // UNKNOWN_KPI_METRIC — surfaced as a 400 rather than a 500.
  metric: z.string().trim().min(1),
  // Deliberately *not* defaulted to 'all': an omitted facet means "the facet
  // this metric's tile stands for", so the shortest call (`?metric=vacant`)
  // agrees with the Vacant tile. The UI widens by sending `facet=all`.
  facet: kpiFacetSchema.optional(),
  posName: z.string().trim().max(150).optional(),
  q: z.string().trim().max(150).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25)
});

const schoolKpiDefinitionQuerySchema = z.object({
  metric: z.string().trim().min(1)
});

const reportSectionSchema = z.object({
  title: z.string().trim().min(1).max(120),
  sortOrder: z.coerce.number().int().min(0).max(10000).optional(),
  isActive: z.coerce.boolean().optional()
});

const reportSectionPatchSchema = reportSectionSchema.partial();

const reportDefinitionSchema = z.object({
  sectionId: z.string().trim().min(1),
  title: z.string().trim().min(1).max(150),
  description: z.string().trim().max(2000).optional().default(''),
  sqlQuery: z.string().trim().min(1).max(20000),
  status: z.enum(['active', 'inactive']).optional().default('inactive'),
  rowKeyColumn: z.string().trim().min(1).max(64).nullable().optional(),
  highlightRules: reportHighlightRulesSchema.optional(),
  subreportQuery: z.string().trim().max(20000).optional(),
  subreportKeyColumn: z.string().trim().min(1).max(64).nullable().optional(),
  columns: z.array(z.string().trim().min(1).max(64)).max(200).optional(),
  additionalColumns: z.array(z.string().trim().min(1).max(64)).max(200).optional()
});

const reportDefinitionPatchSchema = reportDefinitionSchema.partial();

const reportListQuerySchema = z.object({
  sectionId: z.string().trim().optional(),
  includeInactive: z.coerce.boolean().optional().default(false)
});

const reportRunQuerySchema = z.object({
  organization: z.string().trim().min(1)
});

const validateSqlSchema = z.object({
  sqlQuery: z.string().trim().min(1).max(20000),
  subreport: z.boolean().optional()
});

/** Express 5 types route params as string | string[]; our ids are single segments. */
function routeId(value: unknown): string {
  return Array.isArray(value) ? (value[0] ?? '') : String(value ?? '');
}

// Admin identity for v1: the client sends the logged-in user's roles via the
// x-user-roles header (comma-separated). Writes require hr_admin. This keeps
// the fixture login flow working without a token round-trip; a bearer-token
// gate can replace it later without changing route shapes.
function callerRoles(request: express.Request): string[] {
  const header = request.header('x-user-roles') ?? '';
  return header.split(',').map((role) => role.trim()).filter(Boolean);
}

function callerName(request: express.Request): string {
  return request.header('x-user-name')?.trim() || 'admin';
}

function callerId(request: express.Request): string {
  return request.header('x-user-id')?.trim() || request.header('x-user-name')?.trim() || 'anonymous';
}

function callerEmail(request: express.Request): string | undefined {
  return request.header('x-user-email')?.trim() || undefined;
}

/**
 * Fixture auth (users.json / schools.json) grants synthetic school ids like
 * `school-001`, while the live data sources (turso/mysql) identify schools by
 * their real `school_no` (e.g. `0501`). To make school scoping work across any
 * data source, translate the granted fixture ids to the active repository's
 * school ids by matching on school name (the only field stable everywhere).
 * The fixture id -> name map is read once; the live id list is resolved lazily
 * so login still works while a live DB is warming up.
 */
let fixtureIdToName: Record<string, string> | null = null;

async function getFixtureIdToName(): Promise<Record<string, string>> {
  if (!fixtureIdToName) {
    try {
      const { readFile } = await import('node:fs/promises');
      const { resolve } = await import('node:path');
      const schools = JSON.parse(await readFile(resolve(process.cwd(), 'docs', 'data', 'schools.json'), 'utf8')) as School[];
      fixtureIdToName = Object.fromEntries(schools.map((school) => [school.id, school.name]));
    } catch {
      // If the fixture schools file is unavailable, keep an empty map so the
      // caller's ids pass through unchanged rather than being dropped.
      fixtureIdToName = {};
    }
  }
  return fixtureIdToName;
}

/**
 * Resolve a single granted id to the id understood by `repositories`. It
 * accepts either a fixture id ("school-002") or a real school_no ("0501").
 */
function resolveGrantedSchoolId(
  grantedId: string,
  fixtureToName: Record<string, string>,
  liveById: Map<string, School>,
  liveByName: Map<string, School>
): string {
  if (liveById.has(grantedId)) return grantedId;
  const name = fixtureToName[grantedId];
  const live = name ? liveByName.get(name) : undefined;
  return live?.id ?? grantedId;
}

async function reconcileSchoolIds(repositories: Repositories, grantedIds: string[]): Promise<string[]> {
  const fixtureToName = await getFixtureIdToName();
  const liveSchools = await repositories.schools.list().catch(() => []);
  const liveById = new Map(liveSchools.map((school) => [school.id, school]));
  const liveByName = new Map(liveSchools.map((school) => [school.name, school]));
  return grantedIds.map((id) => resolveGrantedSchoolId(id, fixtureToName, liveById, liveByName));
}

// School scoping for non-admins: the client forwards the signed-in user's
// allowed school ids and view-all flag. When a scope is present and the user
// cannot view all schools, list/filter endpoints return only those schools.
function callerSchoolIds(request: express.Request): string[] {
  const header = request.header('x-user-school-ids') ?? '';
  return header.split(',').map((id) => id.trim()).filter(Boolean);
}

function hasSchoolScope(request: express.Request): boolean {
  return request.header('x-user-school-ids') != null;
}

function canViewAllSchools(request: express.Request): boolean {
  return request.header('x-user-view-all') === '1' || callerRoles(request).includes('hr_admin');
}

/** True when an org id is visible to the caller (any admin or unscoped/anon request sees everything). */
function orgIsVisible(request: express.Request, organizationId: string): boolean {
  if (canViewAllSchools(request) || !hasSchoolScope(request)) return true;
  return callerSchoolIds(request).includes(organizationId);
}

function isAdmin(request: express.Request): boolean {
  return callerRoles(request).includes('hr_admin');
}

function isDataTeam(request: express.Request): boolean {
  return callerRoles(request).includes('data_team');
}

function requireAdmin(request: express.Request, response: express.Response, next: express.NextFunction) {
  if (!isAdmin(request)) {
    response.status(403).json({ error: 'FORBIDDEN' });
    return;
  }
  next();
}

function requireDataTeam(request: express.Request, response: express.Response, next: express.NextFunction) {
  if (!isDataTeam(request) && !isAdmin(request)) {
    response.status(403).json({ error: 'FORBIDDEN' });
    return;
  }
  next();
}

/**
 * Feature gate for the Future Positions workflow. Returns the flag value so
 * handlers can also surface it to the client. When off, all future-positions
 * routes reject with FEATURE_DISABLED.
 */
async function requireFuturePositionsEnabled(repositories: Repositories): Promise<{ enabled: boolean } | null> {
  const flag = await repositories.featureFlags.get('future_positions');
  if (!flag?.enabled) return null;
  return { enabled: true };
}

/** Feature gate for the AI Assistant. Returns null when the flag is off. */
async function requireAiAssistantEnabled(repositories: Repositories): Promise<{ enabled: boolean } | null> {
  const flag = await repositories.featureFlags.get('ai_assistant');
  if (!flag?.enabled) return null;
  return { enabled: true };
}

/** Feature gate for Style Configuration. Returns null when the flag is off. */
async function requireStyleConfigurationEnabled(repositories: Repositories): Promise<{ enabled: boolean } | null> {
  const flag = await repositories.featureFlags.get('style_configuration');
  if (!flag?.enabled) return null;
  return { enabled: true };
}

/**
 * True when the error means the table isn't usable yet — either it doesn't
 * exist (MySQL 1146 / SQLite "no such table") or the app user has no grants
 * on it (MySQL 1142, which is what an uncreated table reports for INSERT).
 * Used to degrade gracefully before the DBA has created a new table.
 */
function isMissingTableError(error: unknown): boolean {
  const code = (error as { code?: string; errno?: number } | null)?.code;
  const errno = (error as { errno?: number } | null)?.errno;
  const message = error instanceof Error ? error.message : '';
  return (
    code === 'ER_NO_SUCH_TABLE' ||
    code === 'ER_TABLEACCESS_DENIED_ERROR' ||
    errno === 1146 ||
    errno === 1142 ||
    /no such table/i.test(message) ||
    /command denied to user .* for table/i.test(message)
  );
}

function stripSqlForReader<T extends { sqlQuery?: string; subreportQuery?: string }>(report: T, admin: boolean): T {
  if (admin) return report;
  const { sqlQuery: _omitted, subreportQuery: _omittedSub, ...rest } = report;
  return rest as T;
}

function repoErrorToStatus(error: unknown): { status: number; body: { error: string } } {
  const code = (error as { code?: string } | null)?.code ?? (error instanceof Error ? error.message : '');
  // `getKpiMetric` throws `UNKNOWN_KPI_METRIC:<key>` for a metric the catalog
  // does not define. That is a bad request (a typo'd query param), not a server
  // fault, so it is reported as 400 while keeping the offending key visible.
  if (code.startsWith('UNKNOWN_KPI_METRIC')) {
    return { status: 400, body: { error: code } };
  }
  switch (code) {
    case 'TITLE_REQUIRED':
    case 'TITLE_TOO_LONG':
    case 'SQL_QUERY_REQUIRED':
    case 'SQL_QUERY_TOO_LONG':
    case 'MULTI_STATEMENT_NOT_ALLOWED':
    case 'ONLY_SELECT_ALLOWED':
    case 'FORBIDDEN_KEYWORD':
    case 'ORGANIZATION_SCOPE_REQUIRED':
    case 'SUBREPORT_SCOPE_REQUIRED':
    case 'SQL_EXPLAIN_FAILED':
    case 'SECTION_NOT_FOUND':
    case 'VIEW_NAME_REQUIRED':
    case 'VIEW_DEFINITION_INVALID':
    case 'INVITEE_REQUIRED':
    case 'COMMENT_BODY_REQUIRED':
    case 'HIGHLIGHT_RULE_INVALID':
    case 'PIN_REQUIRED':
    case 'QUESTION_REQUIRED':
    case 'AI_SQL_REJECTED':
    case 'AI_SCOPE_REQUIRED':
      return { status: 400, body: { error: code } };
    case 'AI_NOT_CONFIGURED':
      return { status: 503, body: { error: code } };
    case 'AI_UPSTREAM_ERROR':
      return { status: 502, body: { error: code } };
    case 'SECTION_TITLE_CONFLICT':
    case 'REPORT_TITLE_CONFLICT':
    case 'VIEW_NAME_CONFLICT':
    case 'INVITE_ALREADY_EXISTS':
    case 'VERSION_CONFLICT':
    case 'PIN_EXISTS':
    case 'FUTURE_POSITION_EXISTS':
    case 'FUTURE_POSITION_LOCKED':
    case 'FUTURE_POSITION_NOT_LOCKED':
    case 'FUTURE_POSITION_COMPLETED':
      return { status: 409, body: { error: code } };
    case 'FORBIDDEN':
      return { status: 403, body: { error: code } };
    case 'FEATURE_DISABLED':
      return { status: 403, body: { error: code } };
    case 'VIEW_NOT_FOUND':
    case 'INVITE_NOT_FOUND':
    case 'COMMENT_NOT_FOUND':
    case 'MESSAGE_NOT_FOUND':
    case 'FUTURE_POSITION_NOT_FOUND':
    case 'AI_HISTORY_NOT_FOUND':
    case 'FEATURE_NOT_FOUND':
      return { status: 404, body: { error: code } };
    case 'MESSAGE_REQUIRED':
    case 'MESSAGE_TOO_LONG':
    case 'USER_FIELDS_REQUIRED':
      return { status: 400, body: { error: code } };
    case 'SPLASH_ALREADY_ACTIVE':
    case 'USER_FIELD_CONFLICT':
      return { status: 409, body: { error: code } };
    case 'USER_NOT_FOUND':
      return { status: 404, body: { error: code } };
    default:
      return { status: 500, body: { error: 'INTERNAL_SERVER_ERROR' } };
  }
}

const positionPinInputSchema = z.object({
  posNumber: z.string().trim().min(1).max(64),
  posName: z.string().trim().min(1).max(200),
  organization: z.string().trim().min(1).max(200),
  incumbentName: z.string().trim().max(200).nullable().optional(),
  employeeNumber: z.string().trim().max(32).nullable().optional()
});

const positionCommentInputSchema = z.object({
  organization: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(2000)
});

const systemMessageSchema = z.object({
  title: z.string().trim().max(200),
  message: z.string().trim().min(1).max(2000),
  type: z.enum(['splash', 'banner']),
  isActive: z.boolean().optional().default(true)
});

const systemMessagePatchSchema = systemMessageSchema.partial();

// ---- System users (admin account management) ----
// Admin CRUD for accounts in the `users` table. The provided roles/schoolIds
// arrive as arrays from the client; the repo layer joins them into the CSV
// columns. Employees that must never be edited (the signed-in admin) are not
// special-cased here — all are manageable, but attempts to delete self are
// guarded in the route handler.
const userCreateSchema = z.object({
  username: z.string().trim().min(1).max(64),
  wakeId: z.string().trim().min(1).max(128),
  employeeNumber: z.string().trim().min(1).max(64),
  displayName: z.string().trim().min(1).max(255),
  email: z.string().trim().email().max(255).nullable().optional(),
  roles: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
  schoolIds: z.array(z.string().trim().min(1).max(128)).max(200).optional(),
  canViewAllSchools: z.boolean().optional()
});

// NOTE: Partial must NOT inherit defaults. userCreateSchema uses .optional()
// (not .default()) so that a PATCH that omits roles/schoolIds/canViewAllSchools
// does NOT clobber those columns back to stale values.
const userUpdateSchema = userCreateSchema.partial();

const futurePositionSchema = z.object({
  posNumber: z.string().trim().min(1).max(64),
  posName: z.string().trim().min(1).max(255),
  organization: z.string().trim().min(1).max(255),
  accountNumber: z.string().trim().max(255).nullable().optional(),
  incumbentName: z.string().trim().max(255).nullable().optional(),
  employeeNumber: z.string().trim().max(64).nullable().optional(),
  positionType: z.enum(['vacant', 'replacement', 'new']).optional(),
  hireDate: z.string().trim().max(32).nullable().optional(),
  classroomAssigned: z.string().trim().max(255).nullable().optional(),
  contractType: z.string().trim().max(255).nullable().optional(),
  contractStartDate: z.string().trim().max(32).nullable().optional(),
  contractEndDate: z.string().trim().max(32).nullable().optional(),
  letterNeeded: z.enum(['Change', 'Rehire', 'Other']).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional()
});

// POST body omits posNumber (it comes from the URL path /api/positions/:posNumber/future).
const futurePositionCreateSchema = futurePositionSchema.omit({ posNumber: true });

const futurePositionPatchSchema = futurePositionSchema.partial().omit({ posNumber: true, organization: true });

const futurePositionListQuerySchema = z.object({
  posNumber: z.string().trim().optional(),
  organization: z.string().trim().optional(),
  status: z.enum(['pending', 'locked', 'completed']).optional()
});

const featureFlagPatchSchema = z.object({
  enabled: z.boolean()
});

// ---- Style Configuration ----
// A style theme is a named CSS style staff can apply. mainFont drives body +
// headings; monoFont drives numbers/codes. Colors are hex strings.
const hexColorSchema = z.string().trim().regex(/^#[0-9a-fA-F]{3,8}$/, 'INVALID_COLOR');
const styleThemeSchema = z.object({
  name: z.string().trim().min(1).max(128),
  description: z.string().trim().max(255).nullable().optional(),
  mainFont: z.string().trim().min(1).max(255),
  monoFont: z.string().trim().min(1).max(255),
  primaryColor: hexColorSchema,
  accentColor: hexColorSchema,
  backgroundColor: hexColorSchema,
  textColor: hexColorSchema,
  radius: z.number().int().min(0).max(40).optional(),
  noBackgroundImage: z.boolean().optional()
});
const styleThemeUpdateSchema = styleThemeSchema.partial();

const aiAskSchema = z.object({
  question: z.string().trim().min(1).max(2000)
});

export function createApp(
  repositories: Repositories = fixtureRepositories,
  options?: { serveClient?: boolean }
) {
  const application = express();
  application.use(express.json());

  application.post('/api/auth/login', async (request, response, next) => {
    try {
      const credentials = loginSchema.parse(request.body);
      const useMysqlAuth = repositories === mysqlRepositories || repositories === hybridRepositories;
      const session = useMysqlAuth
        ? await authenticateMysqlUser(credentials.wakeId, credentials.employeeId)
        : await authenticateFixtureUser(credentials.wakeId, credentials.employeeId);
      if (!session) {
        response.status(401).json({ error: 'INVALID_CREDENTIALS' });
        return;
      }
      // Translate fixture school ids (school-001) to the active repository's
      // ids (e.g. real school_no) so scoping works against turso/mysql.
      const schoolIds = await reconcileSchoolIds(repositories, session.user.schoolIds);
      response.json({
        ...session,
        user: { ...session.user, schoolIds }
      });
    } catch (error) {
      next(error);
    }
  });

  application.get('/api/health', async (_request, response) => {
    const dataSource =
      repositories === mysqlRepositories
        ? 'mysql'
        : repositories === tursoRepositories
          ? 'turso'
          : repositories === hybridRepositories
            ? 'hybrid'
            : 'fixtures';
    // Hybrid needs BOTH its MySQL data side AND its Turso config side ready.
    // Report ready only when they are, so the client's warming banner clears
    // at the right moment.
    const dbReady =
      dataSource === 'mysql'
        ? await isDbReady()
        : dataSource === 'turso'
          ? await isTursoDbReady()
          : dataSource === 'hybrid'
            ? (await isDbReady()) && (await isTursoDbReady())
            : false;
    response.json({ ok: true, dataSource, dbReady, aiConfigured: isAiConfigured() });
  });

  application.get('/api/people', async (request, response, next) => {
    try {
      const query = querySchema.parse(request.query);
      const search = query.search?.toLowerCase();
      const people = (await repositories.people.list()).filter((person) => {
        const matchesSearch = !search || [person.fullName, person.employeeNumber, person.organization]
          .some((value) => value.toLowerCase().includes(search));
        const matchesSchool = !query.schoolId || person.organizationId === query.schoolId;
        // Scoping only applies when the client forwards school-permission headers.
        return matchesSearch && matchesSchool && orgIsVisible(request, person.organizationId);
      });
      const start = (query.page - 1) * query.pageSize;
      response.json({
        data: people.slice(start, start + query.pageSize),
        page: query.page,
        pageSize: query.pageSize,
        total: people.length
      });
    } catch (error) {
      next(error);
    }
  });

  // ---- Unified Directory search (people + positions) ----
  // Number-only classification:
  //   ^\d{6}$ -> employee number -> people only
  //   ^\d{7}$ -> position number -> positions only (incl. vacant seats)
  //   anything else -> people text search (existing behaviour, unchanged)
  // Position titles are deliberately NOT matched — a "Teacher" search returns
  // hundreds of seats and was rejected. `pos_name` is displayed, never searched.
  // A pasted position number has NO pos_ending filter: an ended seat still
  // resolves ("if it is in the database, show it").
  application.get('/api/directory', async (request, response, next) => {
    try {
      const query = directoryQuerySchema.parse(request.query);
      const search = query.search.trim();

      const scopedOrgNames = async (): Promise<string[] | undefined> => {
        if (canViewAllSchools(request) || !hasSchoolScope(request)) return undefined;
        const ids = callerSchoolIds(request);
        const schools = await repositories.schools.list();
        return schools.filter((school) => ids.includes(school.id)).map((school) => school.name);
      };

      const page = query.page;
      const pageSize = query.pageSize;
      const start = (page - 1) * pageSize;

      // --- Position number: 7 digits ---
      if (POSITION_NUMBER_RE.test(search)) {
        const organizations = await scopedOrgNames();
        const hits = await repositories.positions.search({ posNumber: search, organizations, limit: pageSize });
        // Resolve each hit's organization id from its name so the client can
        // open the Position Details drawer (which needs org + pos number).
        const schools = await repositories.schools.list();
        const data: DirectoryResult[] = hits.map((hit) => ({
          kind: 'position' as const,
          positionNumber: hit.positionNumber,
          positionName: hit.positionName,
          organization: hit.organization,
          organizationId: schools.find((school) => school.name === hit.organization)?.id ?? '',
          personId: null,
          employeeNumber: hit.incumbentEmployeeNumber,
          fullName: hit.incumbentName,
          email: '',
          vacant: hit.vacant
        }));
        response.json({
          data: data.slice(start, start + pageSize),
          page,
          pageSize,
          total: data.length,
          counts: { people: 0, positions: data.length }
        });
        return;
      }

      // --- Employee number (6 digits) or free text: people ---
      // 6-digit searches match the employee number exactly; text keeps the
      // existing substring behaviour over name / employee number / organization.
      const lower = search.toLowerCase();
      const exactEmployee = EMPLOYEE_NUMBER_RE.test(search);
      const people = (await repositories.people.list()).filter((person) => {
        const matchesSearch = exactEmployee
          ? person.employeeNumber === search
          : [person.fullName, person.employeeNumber, person.organization]
              .some((value) => value.toLowerCase().includes(lower));
        const matchesSchool = !query.schoolId || person.organizationId === query.schoolId;
        return matchesSearch && matchesSchool && orgIsVisible(request, person.organizationId);
      });
      const data: DirectoryResult[] = people.map((person) => ({
        kind: 'person' as const,
        personId: person.personId,
        employeeNumber: person.employeeNumber,
        fullName: person.fullName,
        email: person.email,
        organization: person.organization,
        organizationId: person.organizationId,
        positionName: person.positionName,
        positionNumber: '',
        vacant: false as const
      }));
      response.json({
        data: data.slice(start, start + pageSize),
        page,
        pageSize,
        total: data.length,
        counts: { people: data.length, positions: 0 }
      });
    } catch (error) {
      next(error);
    }
  });

  application.get('/api/people/:personId', async (request, response, next) => {
    try {
      const person = (await repositories.people.list()).find((candidate) => candidate.personId === request.params.personId);
      if (!person) {
        response.status(404).json({ error: 'PERSON_NOT_FOUND' });
        return;
      }
      response.json(person);
    } catch (error) {
      next(error);
    }
  });
  application.get('/api/people/:personId/record', async (request, response, next) => {
    try {
      const record = await repositories.personRecords.getByPersonId(request.params.personId);
      if (!record) {
        response.status(404).json({ error: 'PERSON_RECORD_NOT_FOUND' });
        return;
      }
      response.json(record);
    } catch (error) {
      next(error);
    }
  });

  // ---- Employee auto-lookup (future-incumbent form) ----
  // Narrow single-row lookup keyed by the 6-digit employee number. A miss is a
  // normal 200 `{ found: false }` (NOT 404) so the SPA can show "No matches
  // found" instead of throwing. Out-of-scope employees also answer
  // `found:false` so the endpoint can't probe existence outside the caller's
  // schools.
  application.get('/api/employees/lookup', async (request, response, next) => {
    try {
      const raw = typeof request.query.employeeNumber === 'string' ? request.query.employeeNumber.trim() : '';
      if (!/^\d{6}$/.test(raw)) {
        response.status(400).json({ error: 'EMPLOYEE_NUMBER_INVALID' });
        return;
      }
      const employee = await repositories.people.findByEmployeeNumber(raw);
      if (!employee) {
        response.json({ found: false });
        return;
      }
      // Scope check: resolve the employee's org NAME to a school id and apply
      // the same visibility rule as the other list endpoints.
      if (hasSchoolScope(request) && !canViewAllSchools(request)) {
        const schools = await repositories.schools.list();
        const match = schools.find((school) => school.name === employee.organization);
        if (!match || !callerSchoolIds(request).includes(match.id)) {
          response.json({ found: false });
          return;
        }
      }
      response.json({ found: true, employee });
    } catch (error) {
      next(error);
    }
  });

  application.get('/api/schools', async (request, response, next) => {
    try {
      const schools = await repositories.schools.list();
      // Scoping only applies when the client forwards the signed-in user's
      // school permission headers. Anonymous / unscoped requests (and admins
      // who can view all schools) see the full list. Restricted users see only
      // the schools granted via x-user-school-ids.
      const visible = !hasSchoolScope(request) || canViewAllSchools(request)
        ? schools
        : schools.filter((school) => callerSchoolIds(request).includes(school.id));
      response.json(visible);
    } catch (error) {
      next(error);
    }
  });

  application.get('/api/reports/open-positions', async (request, response, next) => {
    try {
      const query = openPositionQuerySchema.parse(request.query);
      const rows = await repositories.reports.openPositions(query.organization);
      response.json({
        organization: query.organization,
        columns: [
          'Pos. Starting', 'Pos. Ending', 'Name', 'Number', 'Account Code',
          'Months Available', 'Months Used', 'Classroom Assignment', 'Employee', 'Mailstop'
        ],
        rows
      });
    } catch (error) {
      next(error);
    }
  });

  // ---- Clickable KPI dashboard ----
  //
  // Three read-only endpoints over ONE metric catalog (`src/kpi-definitions.ts`).
  // Every number the dashboard shows — tile, breakdown bar, list header — is the
  // length of the same predicate applied to the same position rows, so a tile
  // and the list it opens cannot disagree.
  //
  // Scope handling is explicit rather than silent: a signed-in user restricted
  // to certain schools gets 403 when asking for a school they cannot see, so the
  // UI can explain itself instead of rendering an empty dashboard.

  /**
   * Resolve the requested school to the organization value stored on
   * `position_info.organization` (`'<School Name> - <school_no>'`, identical to
   * `schools.school_name`), and enforce the caller's school scope.
   */
  const resolveKpiSchool = async (
    request: express.Request,
    response: express.Response,
    schoolId: string
  ): Promise<string | null> => {
    if (!orgIsVisible(request, schoolId)) {
      response.status(403).json({ error: 'SCHOOL_NOT_PERMITTED' });
      return null;
    }
    const schools = await repositories.schools.list();
    const school = schools.find((candidate) => candidate.id === schoolId);
    if (!school) {
      response.status(404).json({ error: 'SCHOOL_NOT_FOUND' });
      return null;
    }
    return school.name;
  };

  application.get('/api/schools/kpi', async (request, response, next) => {
    try {
      const query = schoolKpiQuerySchema.parse(request.query);
      const organization = await resolveKpiSchool(request, response, query.schoolId);
      if (organization === null) return;
      response.json(await repositories.schoolKpi.getSchoolKpi(organization, query.facet));
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) { response.status(mapped.status).json(mapped.body); return; }
      next(error);
    }
  });

  application.get('/api/schools/kpi/rows', async (request, response, next) => {
    try {
      const query = schoolKpiRowsQuerySchema.parse(request.query);
      // Narrow the free-form key to the catalog before it reaches the
      // repository, so a typo is a clear 400 instead of a 500.
      if (!isKpiMetricKey(query.metric)) {
        response.status(400).json({ error: `UNKNOWN_KPI_METRIC:${query.metric}` });
        return;
      }
      const organization = await resolveKpiSchool(request, response, query.schoolId);
      if (organization === null) return;
      response.json(
        await repositories.schoolKpi.getSchoolKpiRows(organization, {
          metric: query.metric,
          facet: query.facet,
          posName: query.posName,
          q: query.q,
          page: query.page,
          pageSize: query.pageSize
        })
      );
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) { response.status(mapped.status).json(mapped.body); return; }
      next(error);
    }
  });

  // The definition endpoint is deliberately unauthenticated and school-agnostic:
  // it returns the catalog entry (prose, filters, source tables, generated SQL)
  // and touches no data, so the "ⓘ why does this number say that?" page works
  // for any signed-in user regardless of which schools they can see.
  application.get('/api/schools/kpi/definition', async (request, response, next) => {
    try {
      const query = schoolKpiDefinitionQuerySchema.parse(request.query);
      const metric = getKpiMetric(query.metric);
      // `defaultFacet` is what makes the definition page able to send the user
      // to the *right* list for a metric that has no tile (active-staff): the
      // dashboard has no payload entry to read it from.
      response.json({ ...metric, defaultFacet: defaultFacetFor(metric) });
    } catch (error) {
      // `getKpiMetric` throws `UNKNOWN_KPI_METRIC:<key>` for a key the catalog
      // does not define; map that to a 400 like the sibling routes do.
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) { response.status(mapped.status).json(mapped.body); return; }
      next(error);
    }
  });

  // The metric catalog as a whole, so a client can render the definition page's
  // metric switcher without hard-coding the key list.
  application.get('/api/schools/kpi/metrics', (_request, response) => {
    response.json({
      windowDays: EXPIRY_WINDOW_DAYS,
      barLimit: KPI_BAR_LIMIT,
      tileOrder: KPI_TILE_ORDER,
      stripOrder: KPI_STRIP_ORDER,
      keys: KPI_METRIC_KEYS,
      metrics: KPI_CATALOG_METRICS
    });
  });

  // Read-only Position Details — any authenticated staff can view a position by
  // its 7-digit pos_number. Organization is required to scope the lookup.
  application.get('/api/positions/:posNumber', async (request, response, next) => {
    try {
      const query = openPositionQuerySchema.parse(request.query);
      const posNumber = routeId(request.params.posNumber);
      const details = await repositories.positions.getPositionDetails(posNumber, query.organization);
      if (!details) {
        response.status(404).json({ error: 'POSITION_NOT_FOUND' });
        return;
      }
      response.json(details);
    } catch (error) {
      next(error);
    }
  });

  // ---- Configurable reports (Settings page) ----

  application.get('/api/report-sections', async (request, response, next) => {
    try {
      const includeInactive = request.query.includeInactive === '1' && isAdmin(request);
      response.json(await repositories.reportSections.list(includeInactive));
    } catch (error) {
      next(error);
    }
  });

  application.post('/api/report-sections', requireAdmin, async (request, response, next) => {
    try {
      const input = reportSectionSchema.parse(request.body);
      const created = await repositories.reportSections.create({
        title: input.title,
        sortOrder: input.sortOrder,
        isActive: input.isActive
      });
      response.status(201).json(created);
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) {
        response.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  });

  application.patch('/api/report-sections/:id', requireAdmin, async (request, response, next) => {
    try {
      const patch = reportSectionPatchSchema.parse(request.body);
      const updated = await repositories.reportSections.update(routeId(request.params.id), {
        title: patch.title,
        sortOrder: patch.sortOrder,
        isActive: patch.isActive
      });
      if (!updated) {
        response.status(404).json({ error: 'SECTION_NOT_FOUND' });
        return;
      }
      response.json(updated);
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) {
        response.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  });

  application.delete('/api/report-sections/:id', requireAdmin, async (request, response, next) => {
    try {
      const result = await repositories.reportSections.delete(routeId(request.params.id));
      if (!result.deleted) {
        response.status(result.reason === 'HAS_REPORTS' ? 409 : 404).json({
          error: result.reason === 'HAS_REPORTS' ? 'SECTION_HAS_REPORTS' : 'SECTION_NOT_FOUND'
        });
        return;
      }
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  application.get('/api/reports', async (request, response, next) => {
    try {
      const filter = reportListQuerySchema.parse(request.query);
      const admin = isAdmin(request);
      const reports = await repositories.reportDefinitions.list({
        sectionId: filter.sectionId,
        includeInactive: admin && (filter.includeInactive || request.query.includeInactive === '1')
      });
      response.json(reports.map((report) => stripSqlForReader(report, admin)));
    } catch (error) {
      next(error);
    }
  });

  application.post('/api/reports/validate', requireAdmin, async (request, response, next) => {
    try {
      const input = validateSqlSchema.parse(request.body);
      const result = input.subreport
        ? validateSubreportSql(input.sqlQuery)
        : await repositories.reportDefinitions.explain(input.sqlQuery);
      if (!result.ok) {
        response.status(400).json({ error: result.error });
        return;
      }
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  application.post('/api/reports', requireAdmin, async (request, response, next) => {
    try {
      const input = reportDefinitionSchema.parse(request.body);
      const created = await repositories.reportDefinitions.create({
        sectionId: input.sectionId,
        title: input.title,
        description: input.description ?? '',
        sqlQuery: input.sqlQuery,
        status: input.status ?? 'inactive',
        rowKeyColumn: input.rowKeyColumn ?? null,
        highlightRules: input.highlightRules,
        subreportQuery: input.subreportQuery,
        subreportKeyColumn: input.subreportKeyColumn ?? null,
        columns: input.columns,
        additionalColumns: input.additionalColumns,
        createdBy: callerName(request)
      });
      response.status(201).json(created);
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) {
        response.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  });

  application.get('/api/reports/:id', async (request, response, next) => {
    try {
      const report = await repositories.reportDefinitions.getById(routeId(request.params.id));
      if (!report) {
        response.status(404).json({ error: 'REPORT_NOT_FOUND' });
        return;
      }
      response.json(stripSqlForReader(report, isAdmin(request)));
    } catch (error) {
      next(error);
    }
  });

  application.patch('/api/reports/:id', requireAdmin, async (request, response, next) => {
    try {
      const patch = reportDefinitionPatchSchema.parse(request.body);
      const updated = await repositories.reportDefinitions.update(routeId(request.params.id), {
        sectionId: patch.sectionId,
        title: patch.title,
        description: patch.description,
        sqlQuery: patch.sqlQuery,
        status: patch.status,
        rowKeyColumn: patch.rowKeyColumn,
        highlightRules: patch.highlightRules,
        subreportQuery: patch.subreportQuery,
        subreportKeyColumn: patch.subreportKeyColumn ?? null,
        columns: patch.columns,
        additionalColumns: patch.additionalColumns
      });
      if (!updated) {
        response.status(404).json({ error: 'REPORT_NOT_FOUND' });
        return;
      }
      response.json(updated);
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) {
        response.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  });

  application.delete('/api/reports/:id', requireAdmin, async (request, response, next) => {
    try {
      const deleted = await repositories.reportDefinitions.delete(routeId(request.params.id));
      if (!deleted) {
        response.status(404).json({ error: 'REPORT_NOT_FOUND' });
        return;
      }
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  application.get('/api/reports/:id/run', async (request, response, next) => {
    try {
      const runQuery = reportRunQuerySchema.parse(request.query);
      const runId = routeId(request.params.id);
      const definition = await repositories.reportDefinitions.getById(runId);
      if (!definition) {
        response.status(404).json({ error: 'REPORT_NOT_FOUND' });
        return;
      }
      if (definition.status !== 'active' && !isAdmin(request)) {
        response.status(403).json({ error: 'REPORT_INACTIVE' });
        return;
      }
      const result = await repositories.reportDefinitions.run(runId, runQuery.organization);
      if (!result) {
        response.status(404).json({ error: 'REPORT_NOT_FOUND' });
        return;
      }
      response.json(result);
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) {
        response.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  });

  // ---- Report Views (Phase 2) ----

  const reportViewCreateSchema = z.object({
    reportId: z.string().trim().min(1),
    organization: z.string().trim().min(1),
    name: z.string().trim().min(3).max(60),
    description: z.string().trim().max(200).optional().default(''),
    visibility: z.enum(['private', 'invite_only']).optional().default('private'),
    definition: viewDefinitionSchema
  });

  const reportViewPatchSchema = z.object({
    name: z.string().trim().min(3).max(60).optional(),
    description: z.string().trim().max(200).optional(),
    visibility: z.enum(['private', 'invite_only']).optional(),
    definition: viewDefinitionSchema.optional(),
    expectedVersion: z.number().int().min(1).optional()
  });

  const reportViewListQuerySchema = z.object({
    reportId: z.string().trim().optional(),
    organization: z.string().trim().optional()
  });

  const inviteCreateSchema = z.object({
    inviteeId: z.string().trim().optional(),
    inviteeEmail: z.string().trim().email().optional(),
    inviteeName: z.string().trim().min(1).max(120),
    role: z.enum(['viewer', 'commenter', 'editor'])
  });

  const inviteStatusSchema = z.object({
    status: z.enum(['accepted', 'declined', 'revoked'])
  });

  const commentCreateSchema = z.object({
    body: z.string().trim().min(1).max(2000),
    rowKey: z.string().trim().max(500).nullable().optional(),
    parentId: z.string().trim().min(1).nullable().optional()
  });

  const commentPatchSchema = z.object({
    body: z.string().trim().min(1).max(2000)
  });

  application.get('/api/report-views', async (request, response, next) => {
    try {
      const filter = reportViewListQuerySchema.parse(request.query);
      const views = await repositories.reportViews.list({
        reportId: filter.reportId,
        organization: filter.organization,
        callerId: callerId(request),
        callerEmail: callerEmail(request)
      });
      response.json(views);
    } catch (error) {
      next(error);
    }
  });

  application.post('/api/report-views', async (request, response, next) => {
    try {
      const input = reportViewCreateSchema.parse(request.body);
      const report = await repositories.reportDefinitions.getById(input.reportId);
      if (!report) {
        response.status(404).json({ error: 'REPORT_NOT_FOUND' });
        return;
      }
      const created = await repositories.reportViews.create({
        reportId: input.reportId,
        organization: input.organization,
        name: input.name,
        description: input.description ?? '',
        visibility: input.visibility ?? 'private',
        definition: input.definition,
        ownerId: callerId(request),
        ownerName: callerName(request)
      });
      response.status(201).json(created);
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) {
        response.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  });

  application.get('/api/report-views/invites', async (request, response, next) => {
    try {
      const status = request.query.status as string | undefined;
      const allowed = status === undefined || ['pending', 'accepted', 'declined', 'revoked'].includes(status);
      if (!allowed) {
        response.status(400).json({ error: 'VALIDATION_ERROR' });
        return;
      }
      const invites = await repositories.reportViewInvites.listInbox(
        callerId(request),
        callerEmail(request),
        status as import('./types.js').ReportViewInviteStatus | undefined
      );
      response.json(invites);
    } catch (error) {
      next(error);
    }
  });

  application.get('/api/report-views/:id', async (request, response, next) => {
    try {
      const view = await repositories.reportViews.getById(routeId(request.params.id), callerId(request), callerEmail(request));
      if (!view) {
        response.status(404).json({ error: 'VIEW_NOT_FOUND' });
        return;
      }
      response.json(view);
    } catch (error) {
      next(error);
    }
  });

  application.patch('/api/report-views/:id', async (request, response, next) => {
    try {
      const patch = reportViewPatchSchema.parse(request.body);
      const updated = await repositories.reportViews.update(routeId(request.params.id), patch, callerId(request));
      if (!updated) {
        response.status(404).json({ error: 'VIEW_NOT_FOUND' });
        return;
      }
      response.json(updated);
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) {
        response.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  });

  application.delete('/api/report-views/:id', async (request, response, next) => {
    try {
      const deleted = await repositories.reportViews.delete(routeId(request.params.id), callerId(request));
      if (!deleted) {
        response.status(404).json({ error: 'VIEW_NOT_FOUND' });
        return;
      }
      response.status(204).end();
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) {
        response.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  });

  application.get('/api/report-views/:id/invites', async (request, response, next) => {
    try {
      const viewId = routeId(request.params.id);
      const view = await repositories.reportViews.getById(viewId, callerId(request), callerEmail(request));
      if (!view) {
        response.status(404).json({ error: 'VIEW_NOT_FOUND' });
        return;
      }
      const invites = await repositories.reportViewInvites.listByView(viewId, callerId(request));
      response.json(invites);
    } catch (error) {
      next(error);
    }
  });

  application.post('/api/report-views/:id/invites', async (request, response, next) => {
    try {
      const viewId = routeId(request.params.id);
      const view = await repositories.reportViews.getById(viewId, callerId(request), callerEmail(request));
      if (!view) {
        response.status(404).json({ error: 'VIEW_NOT_FOUND' });
        return;
      }
      if (view.ownerId !== callerId(request)) {
        response.status(403).json({ error: 'FORBIDDEN' });
        return;
      }
      const input = inviteCreateSchema.parse(request.body);
      if (!input.inviteeId && !input.inviteeEmail) {
        response.status(400).json({ error: 'INVITEE_REQUIRED' });
        return;
      }
      const created = await repositories.reportViewInvites.create({
        viewId,
        inviterId: callerId(request),
        inviteeId: input.inviteeId ?? null,
        inviteeEmail: input.inviteeEmail ?? null,
        inviteeName: input.inviteeName,
        role: input.role
      });
      response.status(201).json(created);
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) {
        response.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  });

  application.patch('/api/report-views/:id/invites/:inviteId', async (request, response, next) => {
    try {
      const input = inviteStatusSchema.parse(request.body);
      const updated = await repositories.reportViewInvites.updateStatus(
        routeId(request.params.id),
        routeId(request.params.inviteId),
        input.status,
        callerId(request),
        callerEmail(request)
      );
      if (!updated) {
        response.status(404).json({ error: 'INVITE_NOT_FOUND' });
        return;
      }
      response.json(updated);
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) {
        response.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  });

  application.delete('/api/report-views/:id/invites/:inviteId', async (request, response, next) => {
    try {
      const removed = await repositories.reportViewInvites.remove(routeId(request.params.id), routeId(request.params.inviteId), callerId(request));
      if (!removed) {
        response.status(404).json({ error: 'INVITE_NOT_FOUND' });
        return;
      }
      response.status(204).end();
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) {
        response.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  });

  application.get('/api/report-views/:id/comments', async (request, response, next) => {
    try {
      const viewId = routeId(request.params.id);
      const limit = request.query.limit ? Number(request.query.limit) : 50;
      const comments = await repositories.reportViewComments.list(viewId, callerId(request), callerEmail(request), limit);
      response.json(comments);
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) {
        response.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  });

  application.post('/api/report-views/:id/comments', async (request, response, next) => {
    try {
      const viewId = routeId(request.params.id);
      const view = await repositories.reportViews.getById(viewId, callerId(request), callerEmail(request));
      if (!view) {
        response.status(404).json({ error: 'VIEW_NOT_FOUND' });
        return;
      }
      // canComment: owner or invite with commenter/editor
      const isOwner = view.ownerId === callerId(request);
      let canComment = isOwner;
      if (!canComment) {
        const invites = await repositories.reportViewInvites.listByView(viewId, callerId(request));
        const invite = invites.find(
          (candidate) =>
            candidate.status === 'accepted' &&
            ((candidate.inviteeId !== null && candidate.inviteeId === callerId(request)) ||
              (candidate.inviteeEmail !== null && callerEmail(request) !== undefined && candidate.inviteeEmail.toLowerCase() === callerEmail(request)!.toLowerCase()))
        );
        canComment = !!invite && (invite.role === 'commenter' || invite.role === 'editor');
      }
      if (!canComment) {
        response.status(403).json({ error: 'FORBIDDEN' });
        return;
      }
      const input = commentCreateSchema.parse(request.body);
      const created = await repositories.reportViewComments.create({
        viewId,
        authorId: callerId(request),
        authorName: callerName(request),
        body: input.body,
        rowKey: input.rowKey ?? null,
        parentId: input.parentId ?? null
      });
      response.status(201).json(created);
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) {
        response.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  });

  application.patch('/api/report-views/:id/comments/:commentId', async (request, response, next) => {
    try {
      const input = commentPatchSchema.parse(request.body);
      const updated = await repositories.reportViewComments.update(
        routeId(request.params.id),
        routeId(request.params.commentId),
        input.body,
        callerId(request)
      );
      if (!updated) {
        response.status(404).json({ error: 'COMMENT_NOT_FOUND' });
        return;
      }
      response.json(updated);
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) {
        response.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  });

  application.delete('/api/report-views/:id/comments/:commentId', async (request, response, next) => {
    try {
      const deleted = await repositories.reportViewComments.delete(routeId(request.params.id), routeId(request.params.commentId), callerId(request));
      if (!deleted) {
        response.status(404).json({ error: 'COMMENT_NOT_FOUND' });
        return;
      }
      response.status(204).end();
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) {
        response.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  });

  // ---- Position Pins (one per position per user) ----
  application.get('/api/pins', async (request, response, next) => {
    try {
      const userId = callerId(request);
      const organization = typeof request.query.organization === 'string' ? request.query.organization.trim() || undefined : undefined;
      const search = typeof request.query.search === 'string' ? request.query.search.trim() || undefined : undefined;
      const page = request.query.page ? Number(request.query.page) : 1;
      const pageSize = request.query.pageSize ? Number(request.query.pageSize) : 50;
      const result = await repositories.positionPins.list(userId, { organization, search, page, pageSize });
      response.json(result);
    } catch (error) { next(error); }
  });

  application.get('/api/pins/check', async (request, response, next) => {
    try {
      const userId = callerId(request);
      const raw = typeof request.query.keys === 'string' ? request.query.keys : '';
      const keys = raw.split(';').map((chunk) => {
        const [posNumber, organization] = chunk.split(':').map((s) => s.trim());
        return { posNumber, organization };
      }).filter((k) => k.posNumber && k.organization).slice(0, 100);
      const result = await repositories.positionPins.check(userId, keys);
      response.json(result);
    } catch (error) { next(error); }
  });

  application.post('/api/pins', async (request, response, next) => {
    try {
      const userId = callerId(request);
      const input = positionPinInputSchema.parse(request.body);
      const created = await repositories.positionPins.create(userId, {
        posNumber: input.posNumber,
        posName: input.posName,
        organization: input.organization,
        incumbentName: input.incumbentName ?? null,
        employeeNumber: input.employeeNumber ?? null
      });
      response.status(201).json(created);
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) { response.status(mapped.status).json(mapped.body); return; }
      next(error);
    }
  });

  application.delete('/api/pins/by-key/:posNumber', async (request, response, next) => {
    try {
      const userId = callerId(request);
      const posNumber = routeId(request.params.posNumber);
      const organization = typeof request.query.organization === 'string' ? request.query.organization.trim() : '';
      const removed = await repositories.positionPins.deleteByKey(userId, posNumber, organization);
      if (!removed) { response.status(404).json({ error: 'PIN_NOT_FOUND' }); return; }
      response.status(204).end();
    } catch (error) { next(error); }
  });

  application.delete('/api/pins/:id', async (request, response, next) => {
    try {
      const userId = callerId(request);
      const removed = await repositories.positionPins.delete(userId, routeId(request.params.id));
      if (!removed) { response.status(404).json({ error: 'PIN_NOT_FOUND' }); return; }
      response.status(204).end();
    } catch (error) { next(error); }
  });

  // ---- Position Notes (comments on a position) ----
  application.get('/api/positions/:posNumber/comments', async (request, response, next) => {
    try {
      const posNumber = routeId(request.params.posNumber);
      const organization = typeof request.query.organization === 'string' ? request.query.organization.trim() : '';
      const comments = await repositories.positionComments.list(posNumber, organization);
      response.json(comments);
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) { response.status(mapped.status).json(mapped.body); return; }
      next(error);
    }
  });

  application.post('/api/positions/:posNumber/comments', async (request, response, next) => {
    try {
      const posNumber = routeId(request.params.posNumber);
      const input = positionCommentInputSchema.parse(request.body);
      // The path posNumber is the source of truth for which position gets the note.
      const created = await repositories.positionComments.create({
        posNumber,
        organization: input.organization,
        authorId: callerId(request),
        authorName: callerName(request),
        body: input.body
      });
      response.status(201).json(created);
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) { response.status(mapped.status).json(mapped.body); return; }
      next(error);
    }
  });

  application.delete('/api/positions/:posNumber/comments/:commentId', async (request, response, next) => {
    try {
      const posNumber = routeId(request.params.posNumber);
      const commentId = routeId(request.params.commentId);
      const removed = await repositories.positionComments.delete(commentId, callerId(request));
      if (!removed) { response.status(404).json({ error: 'COMMENT_NOT_FOUND' }); return; }
      response.status(204).end();
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) { response.status(mapped.status).json(mapped.body); return; }
      next(error);
    }
  });

  // ---- System-wide messages (Splash / Banner) ----
  // Any authenticated user reads active announcements; admins CRUD all.
  application.get('/api/system-messages', async (_request, response, next) => {
    try {
      const messages = await repositories.systemMessages.listActive();
      response.json(messages);
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) { response.status(mapped.status).json(mapped.body); return; }
      next(error);
    }
  });

  application.get('/api/system-messages/all', requireAdmin, async (_request, response, next) => {
    try {
      const messages = await repositories.systemMessages.listAll();
      response.json(messages);
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) { response.status(mapped.status).json(mapped.body); return; }
      next(error);
    }
  });

  application.post('/api/system-messages', requireAdmin, async (request, response, next) => {
    try {
      const input = systemMessageSchema.parse(request.body);
      const created = await repositories.systemMessages.create({
        title: input.title,
        message: input.message,
        type: input.type,
        isActive: input.isActive,
        createdBy: callerId(request)
      });
      response.status(201).json(created);
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) { response.status(mapped.status).json(mapped.body); return; }
      next(error);
    }
  });

  application.patch('/api/system-messages/:id', requireAdmin, async (request, response, next) => {
    try {
      const id = routeId(request.params.id);
      const patch = systemMessagePatchSchema.parse(request.body);
      const updated = await repositories.systemMessages.update(id, patch);
      if (!updated) { response.status(404).json({ error: 'MESSAGE_NOT_FOUND' }); return; }
      response.json(updated);
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) { response.status(mapped.status).json(mapped.body); return; }
      next(error);
    }
  });

  application.delete('/api/system-messages/:id', requireAdmin, async (request, response, next) => {
    try {
      const id = routeId(request.params.id);
      const removed = await repositories.systemMessages.delete(id);
      if (!removed) { response.status(404).json({ error: 'MESSAGE_NOT_FOUND' }); return; }
      response.status(204).end();
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) { response.status(mapped.status).json(mapped.body); return; }
      next(error);
    }
  });

  // ---- System users (admin account management) ----
  // Admins can list, create, update, and delete accounts in the `users` table.
  application.get('/api/users', requireAdmin, async (_request, response, next) => {
    try {
      const users = await repositories.users.listAll();
      response.json(users);
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) { response.status(mapped.status).json(mapped.body); return; }
      next(error);
    }
  });

  application.post('/api/users', requireAdmin, async (request, response, next) => {
    try {
      const input = userCreateSchema.parse(request.body);
      const created = await repositories.users.create(input);
      response.status(201).json(created);
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) { response.status(mapped.status).json(mapped.body); return; }
      next(error);
    }
  });

  application.patch('/api/users/:id', requireAdmin, async (request, response, next) => {
    try {
      const id = routeId(request.params.id);
      const patch = userUpdateSchema.parse(request.body);
      const updated = await repositories.users.update(id, patch);
      if (!updated) { response.status(404).json({ error: 'USER_NOT_FOUND' }); return; }
      response.json(updated);
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) { response.status(mapped.status).json(mapped.body); return; }
      next(error);
    }
  });

  application.delete('/api/users/:id', requireAdmin, async (request, response, next) => {
    try {
      const id = routeId(request.params.id);
      // Guard against an admin deleting their own account (locks them out).
      if (id === callerId(request)) {
        response.status(400).json({ error: 'USER_DELETE_SELF' });
        return;
      }
      const removed = await repositories.users.delete(id);
      if (!removed) { response.status(404).json({ error: 'USER_NOT_FOUND' }); return; }
      response.status(204).end();
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) { response.status(mapped.status).json(mapped.body); return; }
      next(error);
    }
  });

  // ---- Feature flags (Settings toggle) ----
  // Any authenticated user reads the toggle so the client can hide the UI;
  // only an admin may change it. Returns every known flag so the client can
  // gate all optional features in one call.
  application.get('/api/feature-flags', async (_request, response, next) => {
    try {
      const [futurePositions, autoLookup, aiAssistant, styleConfiguration, kpiDashboard] = await Promise.all([
        repositories.featureFlags.get('future_positions'),
        repositories.featureFlags.get('employee_auto_lookup'),
        repositories.featureFlags.get('ai_assistant'),
        repositories.featureFlags.get('style_configuration'),
        repositories.featureFlags.get('kpi_dashboard')
      ]);
      response.json({
        future_positions: futurePositions?.enabled ?? false,
        employee_auto_lookup: autoLookup?.enabled ?? false,
        ai_assistant: aiAssistant?.enabled ?? false,
        style_configuration: styleConfiguration?.enabled ?? false,
        // Opt-OUT, unlike every other flag here. The KPI Dashboard is already
        // live, so a missing row (or a database where the flag was never
        // seeded) must leave it visible: an absent flag must never take a
        // shipped page away from staff. Only an explicit `false` hides it.
        kpi_dashboard: kpiDashboard?.enabled ?? true
      });
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) { response.status(mapped.status).json(mapped.body); return; }
      next(error);
    }
  });

  application.patch('/api/feature-flags/:key', requireAdmin, async (request, response, next) => {
    try {
      const key = routeId(request.params.key);
      if (key !== 'future_positions' && key !== 'employee_auto_lookup' && key !== 'ai_assistant' && key !== 'style_configuration' && key !== 'kpi_dashboard') {
        response.status(404).json({ error: 'FEATURE_NOT_FOUND' });
        return;
      }
      const patch = featureFlagPatchSchema.parse(request.body);
      const flag = await repositories.featureFlags.set(key, patch.enabled, callerId(request));
      response.json(flag);
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) { response.status(mapped.status).json(mapped.body); return; }
      next(error);
    }
  });

  // ---- Style Configuration (admin-authored CSS styles) ----
  // Any authenticated user may READ the available styles so staff can apply
  // one; only an admin may create / update / delete. Gated by the
  // style_configuration feature flag.
  application.get('/api/style-themes', async (_request, response, next) => {
    try {
      const gate = await requireStyleConfigurationEnabled(repositories);
      if (!gate) { response.status(403).json({ error: 'FEATURE_DISABLED' }); return; }
      const themes = await repositories.styleThemes.list();
      response.json(themes);
    } catch (error) {
      // Graceful degradation: if the style_themes table has not been created
      // yet (DBA migration pending), return an empty list so the built-in
      // styles still work instead of failing the whole page.
      if (isMissingTableError(error)) { response.json([]); return; }
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) { response.status(mapped.status).json(mapped.body); return; }
      next(error);
    }
  });

  application.post('/api/style-themes', requireAdmin, async (request, response, next) => {
    try {
      const gate = await requireStyleConfigurationEnabled(repositories);
      if (!gate) { response.status(403).json({ error: 'FEATURE_DISABLED' }); return; }
      const input = styleThemeSchema.parse(request.body);
      const created = await repositories.styleThemes.create(input, callerId(request));
      response.status(201).json(created);
    } catch (error) {
      if (isMissingTableError(error)) { response.status(503).json({ error: 'STYLE_STORAGE_NOT_READY' }); return; }
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) { response.status(mapped.status).json(mapped.body); return; }
      next(error);
    }
  });

  application.patch('/api/style-themes/:id', requireAdmin, async (request, response, next) => {
    try {
      const gate = await requireStyleConfigurationEnabled(repositories);
      if (!gate) { response.status(403).json({ error: 'FEATURE_DISABLED' }); return; }
      const id = routeId(request.params.id);
      const patch = styleThemeUpdateSchema.parse(request.body);
      const updated = await repositories.styleThemes.update(id, patch);
      if (!updated) { response.status(404).json({ error: 'STYLE_NOT_FOUND' }); return; }
      response.json(updated);
    } catch (error) {
      if (isMissingTableError(error)) { response.status(503).json({ error: 'STYLE_STORAGE_NOT_READY' }); return; }
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) { response.status(mapped.status).json(mapped.body); return; }
      next(error);
    }
  });

  application.delete('/api/style-themes/:id', requireAdmin, async (request, response, next) => {
    try {
      const gate = await requireStyleConfigurationEnabled(repositories);
      if (!gate) { response.status(403).json({ error: 'FEATURE_DISABLED' }); return; }
      const id = routeId(request.params.id);
      const removed = await repositories.styleThemes.delete(id);
      if (!removed) { response.status(404).json({ error: 'STYLE_NOT_FOUND' }); return; }
      response.status(204).end();
    } catch (error) {
      if (isMissingTableError(error)) { response.status(503).json({ error: 'STYLE_STORAGE_NOT_READY' }); return; }
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) { response.status(mapped.status).json(mapped.body); return; }
      next(error);
    }
  });

  // ---- Future Positions (staged new incumbents) ----
  // Every route is gated by the future_positions flag. Reads are staff+;
  // writes to "complete" are data_team / hr_admin.
  application.get('/api/future-positions', requireDataTeam, async (request, response, next) => {
    try {
      const gate = await requireFuturePositionsEnabled(repositories);
      if (!gate) { response.status(403).json({ error: 'FEATURE_DISABLED' }); return; }
      const query = futurePositionListQuerySchema.parse(request.query);
      const items = await repositories.futurePositions.list({
        posNumber: query.posNumber,
        organization: query.organization,
        status: query.status
      });
      response.json(items);
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) { response.status(mapped.status).json(mapped.body); return; }
      next(error);
    }
  });

  application.get('/api/positions/:posNumber/future', async (request, response, next) => {
    try {
      const gate = await requireFuturePositionsEnabled(repositories);
      if (!gate) { response.status(403).json({ error: 'FEATURE_DISABLED' }); return; }
      const posNumber = routeId(request.params.posNumber);
      const organization = typeof request.query.organization === 'string' ? request.query.organization.trim() : '';
      const item = await repositories.futurePositions.getForPosition(posNumber, organization);
      response.json(item);
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) { response.status(mapped.status).json(mapped.body); return; }
      next(error);
    }
  });

  application.post('/api/positions/:posNumber/future', async (request, response, next) => {
    try {
      const gate = await requireFuturePositionsEnabled(repositories);
      if (!gate) { response.status(403).json({ error: 'FEATURE_DISABLED' }); return; }
      const posNumber = routeId(request.params.posNumber);
      const input = futurePositionCreateSchema.parse(request.body);
      const created = await repositories.futurePositions.create({
        posNumber,
        posName: input.posName,
        organization: input.organization,
        accountNumber: input.accountNumber ?? null,
        incumbentName: input.incumbentName ?? null,
        employeeNumber: input.employeeNumber ?? null,
        positionType: input.positionType,
        hireDate: input.hireDate ?? null,
        classroomAssigned: input.classroomAssigned ?? null,
        contractType: input.contractType ?? null,
        contractStartDate: input.contractStartDate ?? null,
        contractEndDate: input.contractEndDate ?? null,
        letterNeeded: input.letterNeeded ?? null,
        notes: input.notes ?? null,
        submittedBy: callerId(request),
        submittedByName: callerName(request)
      });
      response.status(201).json(created);
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) { response.status(mapped.status).json(mapped.body); return; }
      next(error);
    }
  });

  application.patch('/api/future-positions/:id', async (request, response, next) => {
    try {
      const gate = await requireFuturePositionsEnabled(repositories);
      if (!gate) { response.status(403).json({ error: 'FEATURE_DISABLED' }); return; }
      const id = routeId(request.params.id);
      const patch = futurePositionPatchSchema.parse(request.body);
      const updated = await repositories.futurePositions.update(id, patch, callerId(request));
      if (!updated) { response.status(404).json({ error: 'FUTURE_POSITION_NOT_FOUND' }); return; }
      response.json(updated);
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) { response.status(mapped.status).json(mapped.body); return; }
      next(error);
    }
  });

  application.post('/api/future-positions/:id/send-now', async (request, response, next) => {
    try {
      const gate = await requireFuturePositionsEnabled(repositories);
      if (!gate) { response.status(403).json({ error: 'FEATURE_DISABLED' }); return; }
      const id = routeId(request.params.id);
      const updated = await repositories.futurePositions.sendNow(id, callerId(request));
      if (!updated) { response.status(404).json({ error: 'FUTURE_POSITION_NOT_FOUND' }); return; }
      response.json(updated);
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) { response.status(mapped.status).json(mapped.body); return; }
      next(error);
    }
  });

  // Reverse of send-now: put a locked record back into 'pending' so it can be
  // edited again. Open to any signed-in staff member (no ownership check).
  application.post('/api/future-positions/:id/unlock', async (request, response, next) => {
    try {
      const gate = await requireFuturePositionsEnabled(repositories);
      if (!gate) { response.status(403).json({ error: 'FEATURE_DISABLED' }); return; }
      const id = routeId(request.params.id);
      const updated = await repositories.futurePositions.unlock(id, callerId(request));
      if (!updated) { response.status(404).json({ error: 'FUTURE_POSITION_NOT_FOUND' }); return; }
      response.json(updated);
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) { response.status(mapped.status).json(mapped.body); return; }
      next(error);
    }
  });

  application.post('/api/future-positions/:id/complete', requireDataTeam, async (request, response, next) => {
    try {
      const gate = await requireFuturePositionsEnabled(repositories);
      if (!gate) { response.status(403).json({ error: 'FEATURE_DISABLED' }); return; }
      const id = routeId(request.params.id);
      const updated = await repositories.futurePositions.complete(id, callerId(request));
      if (!updated) { response.status(404).json({ error: 'FUTURE_POSITION_NOT_FOUND' }); return; }
      response.json(updated);
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) { response.status(mapped.status).json(mapped.body); return; }
      next(error);
    }
  });

  // ---- AI Assistant (natural-language reporting) ----
  // Gate everything behind the ai_assistant flag. Body (question) is validated.
  application.post('/api/ai/ask', async (request, response, next) => {
    try {
      const gate = await requireAiAssistantEnabled(repositories);
      if (!gate) { response.status(403).json({ error: 'FEATURE_DISABLED' }); return; }
      const { question } = aiAskSchema.parse(request.body);
      const scoped = !canViewAllSchools(request) && hasSchoolScope(request);
      const entry = await aiAsk({
        userId: callerId(request),
        question,
        schoolIds: callerSchoolIds(request),
        scoped,
        organization: callerSchoolIds(request)[0] ?? null,
        repositories
      });
      response.json(entry);
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) { response.status(mapped.status).json(mapped.body); return; }
      next(error);
    }
  });

  application.get('/api/ai/history', async (request, response, next) => {
    try {
      const gate = await requireAiAssistantEnabled(repositories);
      if (!gate) { response.status(403).json({ error: 'FEATURE_DISABLED' }); return; }
      const history = await aiListHistory(repositories, callerId(request), 20);
      response.json(history);
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) { response.status(mapped.status).json(mapped.body); return; }
      next(error);
    }
  });

  application.get('/api/ai/history/:id', async (request, response, next) => {
    try {
      const gate = await requireAiAssistantEnabled(repositories);
      if (!gate) { response.status(403).json({ error: 'FEATURE_DISABLED' }); return; }
      const id = routeId(request.params.id);
      const entry = await aiGetHistory(repositories, id, callerId(request));
      if (!entry) { response.status(404).json({ error: 'AI_HISTORY_NOT_FOUND' }); return; }
      response.json(entry);
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) { response.status(mapped.status).json(mapped.body); return; }
      next(error);
    }
  });

  application.delete('/api/ai/history/:id', async (request, response, next) => {
    try {
      const gate = await requireAiAssistantEnabled(repositories);
      if (!gate) { response.status(403).json({ error: 'FEATURE_DISABLED' }); return; }
      const id = routeId(request.params.id);
      const removed = await aiDeleteHistory(repositories, id, callerId(request));
      if (!removed) { response.status(404).json({ error: 'AI_HISTORY_NOT_FOUND' }); return; }
      response.status(204).end();
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) { response.status(mapped.status).json(mapped.body); return; }
      next(error);
    }
  });

  application.get('/api/docs.json', (_request, response) => {
    response.json(openApiDocument);
  });
  application.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));

  // Serve the built React client (single-host deployment). Only mounts when a
  // production build exists; in dev the Vite dev server runs separately on 5173.
  if (options?.serveClient) mountClientStatic(application);

  application.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    if (error instanceof z.ZodError) {
      response.status(400).json({ error: 'VALIDATION_ERROR', details: error.issues });
      return;
    }
    console.error('[app] unhandled error:', error);
    response.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
  });

  return application;
}

// Default `app` uses fixtures — deterministic, no network. Tests import this.
export const app = createApp();

// Server bootstrap: honors DATA_SOURCE (mysql | turso vs fixtures) so the
// running server can switch to a live/synthetic DB while tests stay on fixtures.
export function createRuntimeApp(): ReturnType<typeof createApp> {
  const dataSource = getDataSource();
  const repositories =
    dataSource === 'mysql'
      ? mysqlRepositories
      : dataSource === 'turso'
        ? tursoRepositories
        : dataSource === 'hybrid'
          ? hybridRepositories
          : fixtureRepositories;
  return createApp(repositories, { serveClient: true });
}

// Mount the built SPA and fall back to index.html for client-side routes
// (e.g. /reports, /settings) so deep links work on a single host. Skips /api.
function mountClientStatic(application: express.Express): void {
  const indexHtml = resolve(CLIENT_DIST, 'index.html');
  if (!existsSync(indexHtml)) return;
  application.use(express.static(CLIENT_DIST));
  application.use((request, response, next) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return next();
    if (request.path.startsWith('/api')) return next();
    response.sendFile(indexHtml);
  });
}
