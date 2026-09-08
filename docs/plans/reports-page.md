# Reports Page Implementation Plan

## Objective

Replace the legacy flat collection of report buttons with a clear Reports selection page. Add a hamburger menu on the left side of the authenticated Home page, with a Reports navigation option. The Reports page should make all current report choices visible, organize report variants into understandable groups, and remain easy to extend when report schemas are provided later.

The first implementation should focus on navigation, report discovery, and selection. It should not invent report filters, columns, query schemas, or export behavior before the sample schemas are available.

## Legacy Report Inventory

The reference image shows these current report actions:

### Person

- Person Report
- Person Report Excel

### Certification and evaluation

- Certification Report
- Evaluation Planning Report
- Evaluation Planning Excel

### Positions and leave

- Open Position Report
- Leave Balance Report
- Leave Used Report Excel

### Staffing and contracts

- Staff Planning Report
- Staff Planning Spreadsheet
- Staff Report
- Staff Spreadsheet
- Contract Report
- Contract Spreadsheet
- Extended Employment List
- Extended Employment Spreadsheet

The implementation should preserve these as report catalog entries even if some remain disabled or marked as awaiting schema details.

## Proposed User Experience

### Authenticated Home page

1. Add a compact hamburger menu button at the upper-left of the authenticated application shell.
2. Clicking the button opens a left navigation drawer or rail.
3. The menu includes:
   - Home
   - Reports
   - People
   - Future entries to be added later
4. The Reports item includes a Lucide `FileBarChart` or equivalent icon and a visible text label.
5. The active route is visually distinct and remains accessible by keyboard.
6. Clicking outside the drawer or pressing Escape closes it.
7. On mobile, the menu becomes an overlay drawer; on desktop, it can remain a persistent narrow rail when open.
8. Preserve the existing upper-right greeting, sign-out button, and help button.

### Reports page

The Reports page should use a structured selection surface rather than a vertical stack of unrelated buttons.

Recommended layout:

- Page heading: `Reports`
- Supporting text: a short sentence explaining that users can select a report or spreadsheet export.
- Optional search field for report names as the catalog grows.
- Category sections or grouped rows:
  - Person
  - Certification and evaluation
  - Positions and leave
  - Staffing and contracts
- Each report appears as a selectable item with:
  - Report name
  - Short description placeholder
  - Report type badge such as `Report` or `Spreadsheet`
  - Appropriate Lucide icon
  - Availability state
  - Chevron or action affordance
- Pair related report and spreadsheet actions in the same row or card so users understand that they represent the same data in different output formats.
- Avoid hiding report choices behind nested menus; all currently known options should be visible on the page.

## Report Catalog Model

Create a typed frontend catalog rather than hardcoding a series of buttons in JSX.

Recommended model:

```ts
type ReportFormat = 'screen' | 'xlsx';
type ReportAvailability = 'available' | 'schema-pending' | 'restricted';

type ReportDefinition = {
  id: string;
  title: string;
  category: 'person' | 'certification' | 'positions' | 'staffing';
  format: ReportFormat;
  description: string;
  availability: ReportAvailability;
  route: string;
  icon: string;
  requiredPermission?: string;
};
```

Initial IDs should be stable and descriptive, for example:

- `person-report`
- `person-report-xlsx`
- `certification-report`
- `evaluation-planning-report`
- `evaluation-planning-xlsx`
- `open-position-report`
- `leave-balance-report`
- `leave-used-xlsx`
- `staff-planning-report`
- `staff-planning-xlsx`
- `staff-report`
- `staff-xlsx`
- `contract-report`
- `contract-xlsx`
- `extended-employment-list`
- `extended-employment-xlsx`

Descriptions and schemas should be updated when the sample report definitions are provided.

## Routing Plan

Introduce lightweight route state or a router for the authenticated application shell.

Recommended routes:

- `/` or `/home`: current People lookup workspace
- `/reports`: Reports selection page
- `/reports/:reportId`: report parameter/output screen once its schema is available

For the initial Reports page:

- Clicking an available report navigates to its stable report route.
- Clicking a schema-pending report can show a clear non-blocking placeholder state: `Report definition pending`.
- The page should not make a database request simply to render the catalog.
- Future report implementations should replace the placeholder route without changing the catalog or navigation model.

## Backend and OpenAPI Preparation

No report query implementation should be created until sample schemas are supplied. Prepare the contracts without guessing the database shape:

1. Add a future report catalog endpoint only if report availability or permissions must be server-driven.
2. Otherwise, keep the initial catalog in typed frontend configuration and move it server-side later when role-specific availability is known.
3. Reserve API boundaries such as:
   - `GET /api/reports/catalog`
   - `GET /api/reports/:reportId`
   - `POST /api/reports/:reportId/run`
   - `GET /api/reports/:reportId/export`
4. Document these as planned endpoints, not active endpoints, until schemas and authorization rules are approved.
5. Each report must eventually define request filters, response shape, export format, pagination, date/fiscal-year semantics, and required permissions.
6. Add every active report endpoint to Swagger UI when implemented.

## Permissions and Availability

The legacy application contains role and school-scope rules. The Reports page should be designed to support them without embedding business rules in the UI:

- The backend remains the authority for report authorization.
- The frontend may hide or mark unavailable reports for usability, but must not rely on hiding as security.
- Use the authenticated user’s roles, school IDs, and `canViewAllSchools` context once production claims are confirmed.
- Reserve `restricted` and `schema-pending` states in the model.
- Show disabled states with explanatory text rather than silently removing known report options during migration.

## Component Plan

Create focused components as the Reports page grows:

- `AppShell`
- `HamburgerMenuButton`
- `SideNavigation`
- `ReportsPage`
- `ReportCategory`
- `ReportOption`
- `ReportFormatBadge`
- `ReportStatus`

Use `lucide-react` icons for the menu, home, reports, people, spreadsheets, restricted states, and navigation affordances. Icon-only controls must have accessible labels and tooltips.

## Visual Direction

Maintain the established HR Reporting design language:

- Cream background with teal primary actions
- Ochre metadata and category accents
- Charcoal text
- Restrained borders and small-radius surfaces
- Dense, scan-friendly operational layout
- Clear grouping instead of a long centered button stack

The Reports page should feel like a working tool, not a marketing landing page. Use repeated report rows or compact cards only for the report options themselves; keep the page structure unframed and organized.

## Sample Data and Schema Handoff

When sample schemas are provided, capture for each report:

- Report ID and display name
- Input filters and required fields
- User/school scope rules
- Source tables or service dependencies
- Screen columns and sort order
- Empty-state behavior
- Error states
- Spreadsheet columns and formatting
- Expected date and fiscal-year behavior
- Representative sample response

Use those definitions to replace the placeholder descriptions and availability states. Do not copy live employee data into fixtures; keep report examples synthetic like the existing files in `docs/data`.

## Testing Plan

### Navigation

- Hamburger menu opens and closes.
- Reports navigation item routes to `/reports`.
- Active navigation state is visible.
- Escape and outside-click close the menu.
- Keyboard users can reach and activate all navigation items.
- Mobile drawer does not block or overflow the viewport.

### Reports catalog

- All 16 listed report actions are visible in the correct category.
- Screen reports and spreadsheet variants are clearly paired.
- Search filters the catalog when implemented.
- Schema-pending options show a useful placeholder state.
- Selecting an available report uses its stable route.
- Restricted options never bypass backend authorization.

### Visual QA

- Desktop layout supports quick scanning of all report options.
- Mobile layout remains readable without horizontal scrolling.
- The menu does not obscure the greeting or page content incorrectly.
- Icons, badges, and text remain aligned across report rows.
- Existing People lookup and employee record views continue to work after navigation is added.

## Acceptance Criteria

- An authenticated user can open a left-side hamburger menu from Home.
- The menu includes Home, Reports, and People entries, with room for future entries.
- The Reports page displays every report option from the legacy reference image.
- Related screen and spreadsheet options are grouped together.
- The report catalog is typed and data-driven rather than a set of repeated hardcoded buttons.
- Report schemas and database behavior remain deferred until sample schemas are provided.
- The page supports future report routes, permissions, filters, and Swagger documentation.
- Existing login, greeting, People lookup, and employee record functionality remains intact.
