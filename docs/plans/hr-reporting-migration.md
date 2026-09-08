# HR Reporting PHP to Node/React Migration Plan

## 1. Discovery Verification

The legacy application at `C:\Users\kkey2\Desktop\Gitlab code\hr-reporting-main` was verified to exist and be readable.

Initial inventory:

- 1,398 files
- Approximately 348,000 lines including dependencies and public libraries
- PHP endpoint-per-workflow structure with many shared `.inc` files
- MySQL access through `mysqli`
- Session-based authentication and authorization
- Approximately 762 SQL-related source matches
- Approximately 956 session-related source matches
- PhpSpreadsheet declared in `composer.json`
- Legacy JavaScript and third-party assets under `public/js`
- Oracle-related integration files are present
- The folder is not currently a Git repository
- The README is still the default GitLab template

Representative files inspected:

- `index.php`
- `db_conn.php`
- `includes/db_conn.php`
- `includes/utilities.php`
- `person_lookup.php`
- `osha301_save.php`
- `composer.json`
- `deploy/pre_deploy.php`

## 2. Goals and Guiding Principles

### Goals

- Preserve current HR workflows and authorization behavior.
- Replace server-rendered PHP pages with a Node.js API and React application.
- Improve security, testability, observability, and deployment repeatability.
- Migrate incrementally so the existing application remains available during development.
- Avoid coupling the UI rewrite to an immediate database rewrite.

### Principles

- Use a strangler migration rather than a simultaneous rewrite.
- Characterize existing behavior before changing it.
- Treat authorization rules as business requirements that must be documented and tested.
- Keep MySQL and Oracle access behind explicit adapters.
- Migrate by business workflow, not by copying PHP files one-to-one.
- Do not remove a PHP workflow until the replacement has passed functional and operational acceptance checks.

## 3. Phase 0: Preserve and Baseline the Legacy Application

1. Create a Git repository for the legacy source and record the current baseline.
2. Document required PHP, MySQL, Oracle, web-server, filesystem, and deployment configuration.
3. Archive or separately classify generated and third-party content, including:
   - `vendor/`
   - `public/js/` libraries
   - `_vti_cnf/`
   - downloaded archives and old copies
4. Identify the canonical production URL, deployment process, scheduled tasks, logs, and external integrations.
5. Capture screenshots and representative outputs for each major workflow.

**Deliverables:** versioned legacy baseline, environment checklist, deployment runbook, and workflow catalog.

## 4. Phase 1: Functional and Data Inventory

### Application inventory

Catalog every PHP entry point and shared include. Group them into business domains:

- Authentication and user routing
- Employee/person lookup
- Staff and position management
- Licensure
- Internal actions
- OSHA reporting
- Leave and employment reports
- Certification and mismatch reports
- Excel and other report exports
- Specialized and administrator-only workflows

### Authorization inventory

Document the role matrix encoded in `index.php` and related files, including HR users, school administrators, principals, secretaries, bookkeepers, specialized users, and administrator overrides.

Document the meaning and lifecycle of session values such as:

- `id_data`
- `pos_data`
- `domain`
- `person_id`
- `admin`
- `sch_detail`
- Employee and school scope values

### Data inventory

1. Extract all tables, columns, joins, indexes, views, stored procedures, and external database calls.
2. Determine which data is held in MySQL and which is read from or written to Oracle.
3. Identify duplicate SQL, implicit business rules, and fiscal-year calculations.
4. Create a data dictionary with source system, ownership, sensitivity, and retention requirements.
5. Identify large queries and report workloads that may require pagination, caching, or asynchronous processing.

**Deliverables:** endpoint catalog, authorization matrix, data dictionary, dependency map, and report inventory.

## 5. Phase 2: Characterization Tests

Add tests around the current behavior before rewriting it. Use sanitized fixtures or a controlled database snapshot.

Cover at least:

- Login and session initialization
- Role-based routing from `index.php`
- Person lookup visibility rules
- School scoping and administrator overrides
- CRUD operations such as OSHA record creation
- Fiscal-year and date boundary behavior
- Report filters, totals, and row counts
- XLSX/CSV output contents
- Error and unauthorized-access behavior

Add browser-level tests for the highest-value user journeys. These tests become the compatibility contract for each replacement workflow.

**Exit criteria:** representative legacy workflows have repeatable expected inputs, outputs, permissions, and error behavior.

## 6. Phase 3: Target Architecture

### Backend

- TypeScript Node.js service using the conventions already established in the target project.
- Express or Fastify with centralized routing and error handling.
- `mysql2` or an established typed query layer for MySQL.
- An Oracle adapter if Oracle remains an active source or target system.
- Connection pooling, health checks, timeouts, and retry policies where appropriate.
- Zod or equivalent schemas for request and response validation.
- Structured logging, correlation IDs, audit logging, and metrics.

### Frontend

- React with TypeScript.
- Use the open-source `lucide-react` library for interface icons.
- Route-based application shell with shared navigation and layout.
- Central authentication state and role-aware route guards.
- Shared components for tables, filters, forms, dialogs, loading states, and errors.
- API client with consistent parsing and error handling.

### Icon usage conventions

- Use Lucide icons for navigation, search, filtering, sorting, export, edit, delete, refresh, status, and other familiar actions.
- Prefer icon-only buttons for universally recognizable actions; provide an accessible `aria-label` and tooltip for every icon-only control.
- Use text or icon-plus-text buttons when the action or icon meaning is not immediately obvious.
- Keep icon sizing, stroke width, and color consistent through shared button and navigation components.
- Do not hand-draw replacement SVG icons when an appropriate Lucide icon exists.
- Treat icons as supplemental visual cues; do not rely on color or the icon alone to communicate errors, permissions, or status.

### Reports and exports

- Separate report query and presentation services.
- Streaming or paginated handling for large results.
- Dedicated XLSX/CSV generation using a maintained Node-compatible library.
- Compatibility tests that compare report data and exported columns with the PHP output.

### Authentication and authorization

Initially preserve the existing identity provider and user semantics, but expose them through an explicit Node authentication boundary. Do not copy the global-session model into the new service.

Represent authorization as named policies such as:

- `canViewPerson`
- `canEditStaff`
- `canRunReport`
- `canViewAllSchools`
- `canExportSensitiveData`

## 7. Phase 4: Security and Platform Foundation

Before migrating write workflows:

- Replace concatenated SQL with parameterized queries.
- Validate all request bodies, query parameters, and route parameters.
- Apply output encoding in React and avoid rendering untrusted HTML.
- Add CSRF protection if cookie-based authentication is used.
- Configure secure, HTTP-only, appropriately scoped cookies.
- Add security headers, including a suitable Content Security Policy.
- Centralize authorization checks in backend middleware or policies.
- Add audit events for sensitive reads, writes, and exports.
- Move credentials and environment settings into managed configuration.
- Define sanitized error responses so database details are not exposed.
- Add rate limiting and request-size limits where appropriate.

The existing `sanitize_input` function must not be treated as a substitute for parameterized SQL or schema validation.

## 8. Phase 5: Incremental Strangler Migration

Migrate workflow groups in this order:

1. Authentication and the React application shell
2. Read-only person lookup
3. School, staff, and position lookup
4. One contained CRUD workflow, such as OSHA reporting
5. Licensure and internal actions
6. Leave, employment, certification, and mismatch reports
7. XLSX/CSV and other exports
8. Specialized and administrator-only workflows

For every migrated workflow, deliver:

- Node API routes
- Database repository/service code
- Explicit authorization policies
- React route and UI
- Unit and integration tests
- Browser coverage for the primary journey
- Legacy-versus-new comparison checks
- Documented rollback routing

The first implementation milestone should be read-only person lookup because it exercises authentication, role filtering, database access, shared business rules, and React integration without immediately changing the most sensitive write workflows.

## 9. API Contract Guidelines

- Use resource-oriented endpoints rather than one endpoint per PHP file.
- Separate read, write, and export operations.
- Return consistent JSON success and error shapes.
- Use explicit validation errors with field-level details.
- Add pagination, filtering, and sorting for large employee and report datasets.
- Define stable identifiers and avoid exposing database-specific implementation details.
- Version the API if PHP and React clients must coexist for an extended period.

Example domain boundaries:

- `/api/auth`
- `/api/people`
- `/api/schools`
- `/api/staff`
- `/api/licensure`
- `/api/internal-actions`
- `/api/osha`
- `/api/reports`
- `/api/exports`

## 10. Full Swagger UI and OpenAPI Contract

Provide a complete, interactive Swagger UI for every Node API endpoint. The documentation is part of the migration deliverable, not an optional developer convenience.

### Required coverage

Document all current and future API domains, including:

- `/api/auth`
- `/api/people`
- `/api/schools`
- `/api/staff`
- `/api/licensure`
- `/api/internal-actions`
- `/api/osha`
- `/api/reports`
- `/api/exports`
- Health, readiness, and operational endpoints

For every endpoint, document:

- HTTP method and complete path
- Summary, description, tags, and operation identifier
- Path, query, header, and cookie parameters
- Request body schemas and validation constraints
- Successful responses, including JSON and file/download responses
- Authentication and authorization requirements
- Standard validation, unauthorized, forbidden, not-found, conflict, and server-error responses
- Pagination, filtering, sorting, date, and fiscal-year semantics where applicable
- Examples for representative requests and responses

### Implementation approach

1. Define an OpenAPI 3.1 specification with reusable schemas, parameters, security schemes, and response components.
2. Serve Swagger UI from a protected route such as `/api/docs` and expose the source specification at `/api/docs.json`.
3. Use the same Zod or TypeScript schemas that validate requests and responses to reduce contract drift where the selected tooling supports it.
4. Model cookie or bearer authentication accurately, including refresh behavior and role/school-scope requirements.
5. Add an authorization note to sensitive operations so Swagger UI users can understand required roles without exposing secrets or production data.
6. Provide safe mock/example values and disable or restrict the Try It Out feature in production according to the deployment security policy.

### Contract validation and maintenance

- Add CI checks that parse the OpenAPI document and fail on invalid schemas or missing operation identifiers.
- Check that every registered API route has an OpenAPI operation and that every documented operation maps to a registered route.
- Validate response payloads in integration tests for representative endpoints.
- Add contract tests for authentication failures, role restrictions, pagination, exports, and standard error shapes.
- Version the OpenAPI document alongside the API and update it in the same change as any endpoint, request, or response change.
- Generate TypeScript client types or a frontend API client from the specification when practical, while keeping the backend as the source of truth.

**Acceptance criteria:** Swagger UI loads successfully, all registered endpoints are documented, protected operations show their security requirements, examples are usable against a non-production environment, and CI prevents undocumented or invalid API changes.

## 11. Validation and Cutover

1. Run legacy-versus-new comparisons with identical inputs and user identities.
2. Compare report row counts, totals, permissions, filters, and exported files.
3. Test security properties, including injection, authorization bypass, CSRF, XSS, and session fixation.
4. Deploy behind a feature flag, reverse proxy, or route-level migration switch.
5. Migrate users workflow by workflow.
6. Monitor errors, latency, database load, export duration, and audit events.
7. Keep a documented rollback route to PHP for every migrated workflow.
8. Retire each PHP workflow only after an agreed observation period and business-owner sign-off.

## 12. Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Authorization is embedded in hard-coded position and domain checks | Create a documented policy matrix and test every role/school scope before migration |
| SQL is assembled through string concatenation | Require parameterized queries and integration tests for all new repositories |
| HTML is generated directly with `echo` | Return structured data from APIs and use React escaping by default |
| Session state is shared through globals and `$_SESSION` | Create a typed authenticated-user context and avoid global mutable state |
| MySQL and Oracle responsibilities are unclear | Build separate database adapters and document system ownership first |
| Reports may be slow or memory-intensive | Add pagination, streaming, query profiling, and asynchronous export handling where needed |
| Third-party and generated files inflate the apparent scope | Classify active source separately from `vendor`, public libraries, archives, and `_vti_cnf` |
| No Git history is available at the legacy path | Create a baseline repository and recover history from the original GitLab source if available |
| Behavioral differences are discovered late | Add characterization and comparison tests before each workflow rewrite |

## 13. Completion Criteria

The migration is complete when:

- All supported workflows have Node API and React replacements.
- Authentication and authorization behavior is documented and tested.
- Report outputs and exports meet agreed compatibility requirements.
- No new code uses concatenated SQL or unvalidated request data.
- Observability, audit logging, backups, and rollback procedures are operational.
- PHP traffic has reached zero for the agreed monitoring period.
- The legacy application can be archived or decommissioned with business-owner approval.
