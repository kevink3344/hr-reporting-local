# Employee Record Detail Plan

## Objective

Replace the current narrow `Employee record` side panel with a full employee report view based on `docs/screenshots/person-report-full.png`.

After a user performs a People lookup and selects a person, the application should display a complete employee record using synthetic fixture data. On desktop, the People lookup and employee record should each use approximately 50% of the available workspace width. On smaller screens, the layout should stack without requiring horizontal scrolling for the report sections.

The requested filename is intentionally preserved as `empoyee-record.md`.

## Reference Layout

The reference image is a compact, information-dense report rather than a conventional profile card. Preserve that character while matching the existing HR Reporting visual system.

### Report groups shown in the reference

1. Identity header
   - Full name
   - NC UID or equivalent identifier
   - Employee ID
   - Gender
   - Ethnicity
   - Date of birth
   - Email and personal email
2. Contact information
   - Address
   - City
   - State and ZIP
   - Phone
3. Assignment information
   - Location/organization
   - Classroom assignment
   - Months
   - Position
   - Account code
   - TAP percentage
   - Pay grade
   - Group
   - Mail stop
   - School type
   - Supervisor
4. Compensation and assignment status
   - Step
   - Proposed salary
   - Fixed supplement
   - Off-scale amount
   - Supplement
   - TOS state
   - TOS supplement
   - AP/teacher differential
5. Employment dates and contract
   - Hire date
   - Continuous date
   - Last changed date
   - Contract type
   - Contract start
   - Contract end
   - Contract renewal year
   - Change type
   - Board number or equivalent
6. Licensure
   - License type
   - License renewal year
   - License expiration
   - License area
   - Area description
   - Years/status
   - NC license code
7. Service summary
   - Longevity
   - Years of service
   - Months of service
   - Last updated
8. Leave balances
   - Leave type
   - Carryover
   - Accrued
   - Used
   - Adjustment
   - Balance
   - Accrual rate
   - Last updated

## Current State

The current React detail panel only displays:

- Employee number
- Email
- Organization
- Position
- Cost center
- Object code

The existing fixture `docs/data/people.json` also only contains directory fields. It does not yet contain the report-level employee, compensation, licensure, or leave data required by the reference layout.

## Implementation Plan

### 1. Expand the fixture data model

Create a separate detail-oriented fixture file, preferably `docs/data/person-records.json`, keyed by `personId`. Keep `people.json` as the lightweight lookup dataset.

Add synthetic records for all three existing fixture people, with at least one complete record used for visual testing.

Recommended shape:

```json
{
  "personId": "person-001",
  "identity": {
    "fullName": "Example, Alex",
    "employeeNumber": "900001",
    "ncUid": "NCUID-TEST-001",
    "gender": "Not specified",
    "ethnicity": "Not specified",
    "dateOfBirth": "1988-04-12",
    "email": "alex.example@example.test",
    "personalEmail": "alex.personal@example.test"
  },
  "contact": {
    "address": "100 Example Street",
    "city": "Testville",
    "state": "NC",
    "zip": "27000",
    "phone": "555-0100"
  },
  "assignment": {
    "organizationId": "school-001",
    "organization": "Test Oak Elementary",
    "classroom": "Room 101",
    "months": 10,
    "position": "Teacher",
    "accountCode": "01.0000.000.000.0001",
    "tapPercent": 100,
    "payGrade": "Teacher",
    "group": "Instructional Staff",
    "mailStop": "TEST-01",
    "schoolType": "Elementary",
    "supervisor": "Sample, Morgan"
  },
  "compensation": {
    "step": "5",
    "proposedSalary": 58400,
    "fixedSupplement": 0,
    "offScale": 0,
    "supplement": 0,
    "tosState": 0,
    "tosSupplement": 0,
    "teacherDifferential": 0
  },
  "contract": {
    "hireDate": "2018-08-15",
    "continuousDate": "2018-08-15",
    "lastChanged": "2026-07-01",
    "type": "Regular",
    "start": "2026-08-01",
    "end": "2027-06-30",
    "renewalYear": "2027",
    "changeType": "Annual update",
    "boardNumber": "TEST-BOARD-001"
  },
  "licensure": {
    "type": "Regular",
    "renewalYear": "2029-06-30",
    "expires": "2029-06-30",
    "areas": [
      {
        "area": "00025",
        "description": "Elementary Grades K-6",
        "years": "05",
        "status": "04",
        "code": "TEST-LICENSE-001"
      }
    ]
  },
  "service": {
    "yearsOfService": 8,
    "monthsOfService": 0,
    "lastUpdated": "2026-08-31"
  },
  "leaveBalances": [
    {
      "leaveType": "PTO Absence Bonus Annual",
      "carryover": 0,
      "accrued": 0,
      "used": 0,
      "adjustment": 0,
      "balance": 0,
      "accrualRate": 0,
      "lastUpdated": "2026-08-31"
    }
  ]
}
```

Use synthetic values only. Do not copy the real employee, address, SSN, phone, email, salary, or license values shown in the reference screenshot.

### 2. Add a detail repository contract

Extend the repository layer with a detail repository, for example:

- `PersonRecordRepository.getByPersonId(personId)`
- Fixture implementation reading `person-records.json`
- Future MySQL/Oracle implementation behind the same interface

The detail endpoint should not make the initial People list response unnecessarily large.

### 3. Add a detail API endpoint

Add:

- `GET /api/people/:personId/record`

Behavior:

- Return the complete report record for a selected person.
- Return `404 PERSON_RECORD_NOT_FOUND` when no detail fixture or database record exists.
- Apply authentication and school-scope authorization before returning sensitive fields.
- Keep the endpoint response grouped by report section rather than flattening every field into one large object.
- Document the endpoint and all nested schemas in OpenAPI/Swagger.

### 4. Change the React selection workflow

When a row is selected:

1. Set the selected person immediately so the detail region can show a loading state.
2. Fetch `/api/people/:personId/record`.
3. Replace the current narrow detail panel with the full report view.
4. Show a clear error state if detail retrieval fails.
5. Retain the selected row highlight.
6. Keep the close action available so the user can return to the lookup-only view.

The initial lookup list should remain lightweight and continue using `people.json`-shaped records.

### 5. Rebalance the desktop layout

Change the desktop workspace from the current directory-plus-320px-sidebar arrangement to a two-column layout:

- People lookup: approximately 50% width
- Employee record: approximately 50% width

Use CSS grid with stable minimum widths and a reasonable maximum content width. The employee report may scroll vertically within the page, but it should not create an unusable nested horizontal scroller.

Recommended behavior:

- Desktop: `grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)`
- Medium widths: keep two columns only while both columns remain usable.
- Mobile/tablet: stack lookup above the employee record.
- When no employee is selected, show a neutral empty state in the right half rather than collapsing the layout.

### 6. Build the report presentation

Create focused React components instead of one large conditional block:

- `EmployeeRecord`
- `RecordSection`
- `IdentitySection`
- `ContactSection`
- `AssignmentSection`
- `CompensationSection`
- `ContractSection`
- `LicensureSection`
- `ServiceSummary`
- `LeaveBalanceTable`

Use a dense two- or three-column definition-list layout inside sections. Use a real table for licensure rows and leave balances because those records are naturally tabular.

Visual direction:

- Keep the existing cream, teal, ochre, and charcoal palette.
- Use restrained borders and section dividers to echo the reference report.
- Use a muted green section header for Leave Balances, matching the reference without copying its exact styling.
- Use `lucide-react` icons only where they aid navigation or status; do not decorate every data field.
- Add a print-friendly style so the report can eventually be printed or exported.

### 7. Formatting and data rules

- Format dates consistently as `YYYY-MM-DD` initially, with a later locale decision for production.
- Format currency with two decimal places and a currency symbol.
- Format percentages with a percent sign.
- Display zero values explicitly where the source report expects them.
- Display missing values as an intentional em dash or `Not provided`, chosen consistently.
- Never display sensitive fields such as SSN in the first implementation unless explicitly approved and protected by policy.
- Avoid using real-looking production identifiers in fixtures.

### 8. Authentication and authorization

The current fixture login should continue to establish the session context. The eventual production endpoint must use the approved Wake identity provider/JWT boundary.

Before exposing a full record:

- Confirm the user can view the selected person’s school.
- Allow cross-school access only when the authenticated user has `canViewAllSchools` or the corresponding production policy.
- Add tests for same-school access, cross-school denial, and admin/all-school access.
- Keep the employee record endpoint protected even if the lookup endpoint is temporarily read-only.

## Testing Plan

### Backend

- Return a complete fixture record for `person-001`.
- Return `404` for an unknown person.
- Validate nested record shape.
- Verify authorization scope behavior.
- Verify OpenAPI documents the new route and nested schemas.

### Frontend

- Successful login displays the directory.
- Selecting a person fetches and renders the full record.
- The lookup and record regions are approximately equal width on desktop.
- No selected person shows the right-side empty state.
- Loading and error states are visible and non-layout-shifting.
- Mobile layout stacks the report below the lookup.
- Leave balance rows and licensure rows render from sample data.
- Print stylesheet does not clip the employee record.

### Visual QA

Use the running client with the fixture account `hr.admin` / `900003`, select a person, and compare the resulting structure against the reference image:

- Identity and contact information are visible near the top.
- Assignment, compensation, contract, licensure, service, and leave sections are all represented.
- The right-side report has enough width to scan without excessive wrapping.
- The design remains consistent with the existing theme.

## Acceptance Criteria

- A user can log in with the existing fixture credentials.
- A People lookup result can be selected to open a full employee record.
- The employee record contains all eight report groups listed above.
- The record is powered by synthetic sample data in `docs/data`.
- Lookup and record occupy approximately 50% each on desktop.
- The record is responsive and usable on smaller screens.
- The full record endpoint is validated, documented in Swagger, and protected by authorization.
- Backend tests, client build, and visual QA pass before merging.
