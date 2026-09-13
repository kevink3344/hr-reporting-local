export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'HR Reporting API',
    version: '0.1.0',
    description: 'Initial fixture-backed migration slice for HR people and school lookups.'
  },
  servers: [{ url: '/api', description: 'Current API server' }],
  tags: [
    { name: 'Auth', description: 'Authentication and identity' },
    { name: 'Health', description: 'Service readiness' },
    { name: 'People', description: 'Employee and person lookups' },
    { name: 'Schools', description: 'School and department lookups' },
    { name: 'Positions', description: 'Position lookups and notes' },
    { name: 'Reports', description: 'Report generation and scoping' },
    {
      name: 'KPI',
      description:
        'Clickable KPI dashboard. Every number is the length of one shared predicate from the metric ' +
        'catalog, so a tile, a breakdown bar and the list it opens can never disagree.'
    },
    {
      name: 'Advanced Search',
      description: 'Structured, parameterised position search (name, vacancy, contract type/code/dates)'
    },
    {
      name: 'Admin',
      description:
        'Administrator-only diagnostics. The data-load report is read-only and gateable by a feature ' +
        'flag, so it can be turned off without removing the route.'
    }
  ],
  paths: {
    '/auth/login': {
      post: {
        tags: ['Auth'],
        operationId: 'login',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } } }
        },
        responses: {
          '200': { description: 'Authenticated fixture user' },
          '401': { description: 'Invalid Wake ID or Employee ID' }
        }
      }
    },
    '/health': {
      get: {
        tags: ['Health'],
        operationId: 'getHealth',
        responses: {
          '200': {
            description: 'Service health',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/HealthResponse' } } }
          }
        }
      }
    },
    '/system-info': {
      get: {
        tags: ['Admin'],
        operationId: 'getSystemInfo',
        summary: 'Nightly data-load diagnostics (admin)',
        description:
          'Admin-only, and additionally gated by the `system_info` feature flag, which ships OFF. ' +
          'The reporting tables are reloaded every night, but the database keeps no history of it — ' +
          'no load timestamp column, no audit table, and no `auto_increment` to diff — so this app ' +
          'keeps its own baseline in a small JSON file it writes itself (see `snapshotFile`).\n\n' +
          'Each request measures the live tables (`COUNT(*)` plus `CHECKSUM TABLE`), compares them ' +
          'with the newest reading taken on a PREVIOUS day, and then records one reading for today. ' +
          'Opening the page repeatedly is therefore idempotent, and `baseline` is null on the first ' +
          'day, when there is nothing to compare against yet. The count says how many rows there ' +
          'are; `contentChanged` says whether they are the same rows, which is what catches a ' +
          'reload that replaced rows in place.\n\n' +
          'Returns 403 `FORBIDDEN` without the admin role, and 403 `FEATURE_DISABLED` while the ' +
          'feature flag is off. `liveCountsAvailable: false` means the live half could not be read ' +
          '(the `fixtures` and `turso` sources have no reporting tables) — the page still renders ' +
          'and no reading is recorded.',
        responses: {
          '200': {
            description: 'Recorded baseline merged with the live row counts',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SystemInfoPayload' } } }
          },
          '403': {
            description: 'Not an admin (`FORBIDDEN`) or the feature flag is off (`FEATURE_DISABLED`)',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
          }
        }
      }
    },
    '/people': {
      get: {
        tags: ['People'],
        operationId: 'listPeople',
        parameters: [
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'schoolId', in: 'query', schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 } }
        ],
        responses: {
          '200': {
            description: 'Paged people',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/PersonPage' } } }
          }
        }
      }
    },
    '/directory': {
      get: {
        tags: ['People'],
        operationId: 'searchDirectory',
        summary: 'Unified people + position search (number-only)',
        description:
          'Number-only classification: 6 digits = employee number (people), ' +
          '7 digits = position number (positions, including vacant seats), ' +
          'anything else = people text search. Position titles are not matched.',
        parameters: [
          { name: 'search', in: 'query', required: true, schema: { type: 'string', minLength: 1 } },
          { name: 'schoolId', in: 'query', schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } }
        ],
        responses: {
          '200': {
            description: 'Merged directory results',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/DirectoryPage' } } }
          },
          '400': { description: 'SEARCH_REQUIRED — search must be non-empty' }
        }
      }
    },
    '/people/{personId}': {
      get: {
        tags: ['People'],
        operationId: 'getPerson',
        parameters: [{ name: 'personId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Person',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Person' } } }
          },
          '404': { description: 'Person not found' }
        }
      }
    },
    '/people/{personId}/record': {
      get: {
        tags: ['People'],
        operationId: 'getPersonRecord',
        parameters: [{ name: 'personId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Complete employee record', content: { 'application/json': { schema: { $ref: '#/components/schemas/PersonRecord' } } } },
          '404': { description: 'Employee record not found' }
        }
      }
    },
    '/employees/lookup': {
      get: {
        tags: ['People'],
        operationId: 'lookupEmployee',
        summary: 'Look up a single employee by their 6-digit employee number',
        description:
          'Backs the future-incumbent form auto-fill. Returns a narrow projection ' +
          '(name, organization, position, account number, contract type, hire date). ' +
          'A miss is reported as 200 with `found: false` — not 404 — so the client can ' +
          'render "No matches found" as an ordinary state. An employee outside the ' +
          "caller's school scope also answers `found: false`.",
        parameters: [
          {
            name: 'employeeNumber',
            in: 'query',
            required: true,
            description: 'Exactly 6 digits. Leading zeros are significant.',
            schema: { type: 'string', pattern: '^\\d{6}$' }
          }
        ],
        responses: {
          '200': {
            description: 'Lookup result — `found` discriminates the union',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/EmployeeLookupResponse' } } }
          },
          '400': {
            description: '`EMPLOYEE_NUMBER_INVALID` — the number was not exactly 6 digits',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
          }
        }
      }
    },
    '/schools': {
      get: {
        tags: ['Schools'],
        operationId: 'listSchools',
        responses: {
          '200': {
            description: 'Schools and departments',
            content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/School' } } } }
          }
        }
      }
    },
    '/reports/open-positions': {
      get: {
        tags: ['Reports'],
        operationId: 'getOpenPositions',
        parameters: [{ name: 'organization', in: 'query', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Open positions scoped to an organization',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/OpenPositionReport' } } }
          },
          '400': { description: 'Missing organization parameter' }
        }
      }
    },
    '/positions/{posNumber}': {
      get: {
        tags: ['Positions'],
        operationId: 'getPositionDetails',
        summary: 'Fetch a single position and its incumbent',
        parameters: [
          { name: 'posNumber', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'organization', in: 'query', required: true, schema: { type: 'string' } }
        ],
        responses: {
          '200': {
            description: 'Position details (incumbent null when vacant)',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/PositionDetails' } } }
          },
          '400': { description: 'Missing organization parameter' },
          '404': { description: 'Position not found' }
        }
      }
    },
    '/schools/kpi': {
      get: {
        tags: ['KPI'],
        operationId: 'getSchoolKpi',
        summary: 'Dashboard payload for one school',
        description:
          'Returns the four tiles, the authorized/vacancy-rate strip and the Position Title breakdown for a ' +
          'single school. `schoolId` is the school id the rest of the API uses (the `SchoolCombobox` value); ' +
          'the server resolves it to the `position_info.organization` string. A caller restricted to other ' +
          'schools receives 403 rather than a silently empty dashboard.',
        parameters: [
          { name: 'schoolId', in: 'query', required: true, schema: { type: 'string' } },
          {
            name: 'facet',
            in: 'query',
            required: false,
            description: 'Seat-status view used for the breakdown. Defaults to `all`.',
            schema: { $ref: '#/components/schemas/KpiFacet' }
          }
        ],
        responses: {
          '200': {
            description: 'Tiles, strip and breakdown for the school',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SchoolKpiPayload' } } }
          },
          '400': { description: 'Missing or invalid query parameter' },
          '403': { description: 'Caller is not permitted to see this school', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '404': { description: 'Unknown school id', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
        }
      }
    },
    '/schools/kpi/rows': {
      get: {
        tags: ['KPI'],
        operationId: 'getSchoolKpiRows',
        summary: 'Drill-down list behind a KPI tile, bar or facet chip',
        description:
          'The generic list page for every metric. `metricValue` is the tile\u2019s number and is computed before ' +
          'the facet, title filter, search and pagination are applied, so the list and the tile always agree. ' +
          '`total` is the count after every filter and is what the pager is built from. For a `share` metric such ' +
          'as `vacancy-rate`, `metricValue` is the numerator (the vacancies), not the percentage.',
        parameters: [
          { name: 'schoolId', in: 'query', required: true, schema: { type: 'string' } },
          {
            name: 'metric',
            in: 'query',
            required: true,
            description: 'Metric catalog key. An unknown key returns 400 `UNKNOWN_KPI_METRIC:<key>`.',
            schema: { $ref: '#/components/schemas/KpiMetricKey' }
          },
          {
            name: 'facet',
            in: 'query',
            required: false,
            description:
              'Seat-status view, orthogonal to the metric. Omitted means \u201Cthe facet this metric\u2019s tile ' +
              'stands for\u201D (`KpiMetricValue.defaultFacet`, echoed back on the response), so the shortest ' +
              'call `?metric=vacant` already agrees with the Vacant tile. Send `all` to widen to every open seat ' +
              'without leaving the metric.',
            schema: { $ref: '#/components/schemas/KpiFacet' }
          },
          {
            name: 'posName',
            in: 'query',
            required: false,
            description: 'Restrict to one Position Title (the value carried by a breakdown bar).',
            schema: { type: 'string' }
          },
          {
            name: 'q',
            in: 'query',
            required: false,
            description: 'Case-insensitive search across Position Title, position number, name and employee number.',
            schema: { type: 'string' }
          },
          { name: 'page', in: 'query', required: false, schema: { type: 'integer', minimum: 1, default: 1 } },
          {
            name: 'pageSize',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 1, maximum: 200, default: 25 }
          }
        ],
        responses: {
          '200': {
            description: 'One page of rows plus the counts the page renders',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SchoolKpiRows' } } }
          },
          '400': { description: 'Invalid query parameter or unknown metric', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '403': { description: 'Caller is not permitted to see this school', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '404': { description: 'Unknown school id', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
        }
      }
    },
    '/schools/kpi/definition': {
      get: {
        tags: ['KPI'],
        operationId: 'getKpiDefinition',
        summary: 'Definition, filters and read-only SQL for one metric',
        description:
          'Backs the \u201csee the definition and read-only SQL\u201d page. Reads the metric catalog only and touches ' +
          'no school data, so it answers for any signed-in user regardless of which schools they can see.',
        parameters: [
          {
            name: 'metric',
            in: 'query',
            required: true,
            description: 'Metric catalog key. An unknown key returns 400 `UNKNOWN_KPI_METRIC:<key>`.',
            schema: { $ref: '#/components/schemas/KpiMetricKey' }
          }
        ],
        responses: {
          '200': {
            description: 'The metric definition, including generated count and row SQL',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/KpiMetricDefinition' } } }
          },
          '400': { description: 'Unknown metric', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
        }
      }
    },
    '/schools/kpi/metrics': {
      get: {
        tags: ['KPI'],
        operationId: 'listKpiMetrics',
        summary: 'Metric catalog metadata',
        description:
          'The catalogue\u2019s shape \u2014 tile order, strip order, every key, the expiry window and the bar limit \u2014 so a ' +
          'client can render the dashboard and the definition switcher without hard-coding the key list.',
        responses: {
          '200': {
            description: 'Catalog metadata',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/KpiCatalog' } } }
          }
        }
      }
    },
    '/report-sections': {
      get: {
        tags: ['Reports'],
        operationId: 'listReportSections',
        parameters: [{ name: 'includeInactive', in: 'query', schema: { type: 'string', enum: ['1'] } }],
        responses: {
          '200': {
            description: 'Report sections with report counts',
            content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/ReportSection' } } } }
          }
        }
      },
      post: {
        tags: ['Reports'],
        operationId: 'createReportSection',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ReportSectionInput' } } }
        },
        responses: {
          '201': { description: 'Created section', content: { 'application/json': { schema: { $ref: '#/components/schemas/ReportSection' } } } },
          '403': { description: 'Admin role required' },
          '409': { description: 'Section title already exists' }
        }
      }
    },
    '/report-sections/{id}': {
      patch: {
        tags: ['Reports'],
        operationId: 'updateReportSection',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ReportSectionInput' } } }
        },
        responses: {
          '200': { description: 'Updated section', content: { 'application/json': { schema: { $ref: '#/components/schemas/ReportSection' } } } },
          '403': { description: 'Admin role required' },
          '404': { description: 'Section not found' }
        }
      },
      delete: {
        tags: ['Reports'],
        operationId: 'deleteReportSection',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '204': { description: 'Section deleted' },
          '403': { description: 'Admin role required' },
          '404': { description: 'Section not found' },
          '409': { description: 'Section still has reports' }
        }
      }
    },
    '/reports': {
      get: {
        tags: ['Reports'],
        operationId: 'listReports',
        parameters: [
          { name: 'sectionId', in: 'query', schema: { type: 'string' } },
          { name: 'includeInactive', in: 'query', schema: { type: 'string', enum: ['1'] } }
        ],
        responses: {
          '200': {
            description: 'Report definitions (sql_query only for admins)',
            content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/ReportDefinition' } } } }
          }
        }
      },
      post: {
        tags: ['Reports'],
        operationId: 'createReport',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ReportDefinitionInput' } } }
        },
        responses: {
          '201': { description: 'Created report', content: { 'application/json': { schema: { $ref: '#/components/schemas/ReportDefinition' } } } },
          '400': { description: 'Validation error (SQL safety, section, title)' },
          '403': { description: 'Admin role required' },
          '409': { description: 'Report title already exists in section' }
        }
      }
    },
    '/reports/validate': {
      post: {
        tags: ['Reports'],
        operationId: 'validateReportSql',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidateSqlRequest' } } }
        },
        responses: {
          '200': { description: 'SQL is valid' },
          '400': { description: 'SQL failed safety or EXPLAIN checks' },
          '403': { description: 'Admin role required' }
        }
      }
    },
    '/reports/{id}': {
      get: {
        tags: ['Reports'],
        operationId: 'getReport',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Report definition', content: { 'application/json': { schema: { $ref: '#/components/schemas/ReportDefinition' } } } },
          '404': { description: 'Report not found' }
        }
      },
      patch: {
        tags: ['Reports'],
        operationId: 'updateReport',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ReportDefinitionInput' } } }
        },
        responses: {
          '200': { description: 'Updated report', content: { 'application/json': { schema: { $ref: '#/components/schemas/ReportDefinition' } } } },
          '403': { description: 'Admin role required' },
          '404': { description: 'Report not found' }
        }
      },
      delete: {
        tags: ['Reports'],
        operationId: 'deleteReport',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '204': { description: 'Report deleted' },
          '403': { description: 'Admin role required' },
          '404': { description: 'Report not found' }
        }
      }
    },
    '/reports/{id}/run': {
      get: {
        tags: ['Reports'],
        operationId: 'runReport',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'organization', in: 'query', required: true, schema: { type: 'string' } }
        ],
        responses: {
          '200': { description: 'Generic report result', content: { 'application/json': { schema: { $ref: '#/components/schemas/ReportRunResult' } } } },
          '400': { description: 'Missing organization parameter' },
          '403': { description: 'Inactive report (non-admin)' },
          '404': { description: 'Report not found' }
        }
      }
    },
    '/report-views': {
      get: {
        tags: ['Reports'],
        operationId: 'listReportViews',
        parameters: [
          { name: 'reportId', in: 'query', schema: { type: 'string' } },
          { name: 'organization', in: 'query', schema: { type: 'string' } }
        ],
        responses: {
          '200': { description: 'Report views visible to caller', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/ReportView' } } } } }
        }
      },
      post: {
        tags: ['Reports'],
        operationId: 'createReportView',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ReportViewInput' } } } },
        responses: {
          '201': { description: 'Created view', content: { 'application/json': { schema: { $ref: '#/components/schemas/ReportView' } } } },
          '400': { description: 'Validation error' },
          '404': { description: 'Report not found' },
          '409': { description: 'View name already exists' }
        }
      }
    },
    '/report-views/invites': {
      get: {
        tags: ['Reports'],
        operationId: 'listViewInvitesInbox',
        parameters: [{ name: 'status', in: 'query', schema: { type: 'string', enum: ['pending', 'accepted', 'declined', 'revoked'] } }],
        responses: {
          '200': { description: 'Invites for caller', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/ReportViewInvite' } } } } }
        }
      }
    },
    '/report-views/{id}': {
      get: {
        tags: ['Reports'],
        operationId: 'getReportView',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Report view', content: { 'application/json': { schema: { $ref: '#/components/schemas/ReportView' } } } },
          '404': { description: 'View not found' }
        }
      },
      patch: {
        tags: ['Reports'],
        operationId: 'updateReportView',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ReportViewPatch' } } } },
        responses: {
          '200': { description: 'Updated view', content: { 'application/json': { schema: { $ref: '#/components/schemas/ReportView' } } } },
          '403': { description: 'Forbidden' },
          '404': { description: 'View not found' },
          '409': { description: 'Version conflict or name conflict' }
        }
      },
      delete: {
        tags: ['Reports'],
        operationId: 'deleteReportView',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '204': { description: 'View deleted' }, '403': { description: 'Forbidden' }, '404': { description: 'View not found' } }
      }
    },
    '/report-views/{id}/invites': {
      get: {
        tags: ['Reports'],
        operationId: 'listViewInvites',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Invites for view', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/ReportViewInvite' } } } } } }
      },
      post: {
        tags: ['Reports'],
        operationId: 'createViewInvite',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ReportViewInviteInput' } } } },
        responses: {
          '201': { description: 'Invite created', content: { 'application/json': { schema: { $ref: '#/components/schemas/ReportViewInvite' } } } },
          '403': { description: 'Only owner can invite' },
          '409': { description: 'Already invited' }
        }
      }
    },
    '/report-views/{id}/invites/{inviteId}': {
      patch: {
        tags: ['Reports'],
        operationId: 'updateViewInvite',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'inviteId', in: 'path', required: true, schema: { type: 'string' } }
        ],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['accepted', 'declined', 'revoked'] } } } } } },
        responses: { '200': { description: 'Invite updated', content: { 'application/json': { schema: { $ref: '#/components/schemas/ReportViewInvite' } } } }, '404': { description: 'Invite not found' } }
      },
      delete: {
        tags: ['Reports'],
        operationId: 'deleteViewInvite',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'inviteId', in: 'path', required: true, schema: { type: 'string' } }
        ],
        responses: { '204': { description: 'Invite revoked' }, '404': { description: 'Invite not found' } }
      }
    },
    '/report-views/{id}/comments': {
      get: {
        tags: ['Reports'],
        operationId: 'listViewComments',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200 } }
        ],
        responses: { '200': { description: 'Comments', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/ReportViewComment' } } } } } }
      },
      post: {
        tags: ['Reports'],
        operationId: 'createViewComment',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ReportViewCommentInput' } } } },
        responses: {
          '201': { description: 'Comment created', content: { 'application/json': { schema: { $ref: '#/components/schemas/ReportViewComment' } } } },
          '403': { description: 'Forbidden' }
        }
      }
    },
    '/pins': {
      get: {
        tags: ['Reports'],
        operationId: 'listPositionPins',
        parameters: [
          { name: 'organization', in: 'query', schema: { type: 'string' } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } }
        ],
        responses: { '200': { description: 'Position pins for caller', content: { 'application/json': { schema: { $ref: '#/components/schemas/PositionPinPage' } } } } }
      },
      post: {
        tags: ['Reports'],
        operationId: 'createPositionPin',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/PositionPinInput' } } } },
        responses: {
          '201': { description: 'Position pin created', content: { 'application/json': { schema: { $ref: '#/components/schemas/PositionPin' } } } },
          '400': { description: 'Validation error' },
          '409': { description: 'Already pinned (one per position per user)' }
        }
      }
    },
    '/pins/check': {
      get: {
        tags: ['Reports'],
        operationId: 'checkPositionPins',
        parameters: [{ name: 'keys', in: 'query', required: true, schema: { type: 'string', description: 'Semicolon-separated posNumber:organization keys (max 100)' } }],
        responses: { '200': { description: 'Position pin checks', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/PositionPinCheck' } } } } } }
      }
    },
    '/pins/by-key/{posNumber}': {
      delete: {
        tags: ['Reports'],
        operationId: 'deletePositionPinByKey',
        parameters: [
          { name: 'posNumber', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'organization', in: 'query', required: true, schema: { type: 'string' } }
        ],
        responses: { '204': { description: 'Position pin removed' }, '404': { description: 'Position pin not found' } }
      }
    },
    '/pins/{id}': {
      delete: {
        tags: ['Reports'],
        operationId: 'deletePositionPin',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '204': { description: 'Position pin removed' }, '404': { description: 'Position pin not found' } }
      }
    },
    '/positions/{posNumber}/comments': {
      get: {
        tags: ['Positions'],
        operationId: 'listPositionComments',
        parameters: [
          { name: 'posNumber', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'organization', in: 'query', required: true, schema: { type: 'string' } }
        ],
        responses: { '200': { description: 'Position notes', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/PositionComment' } } } } } }
      },
      post: {
        tags: ['Positions'],
        operationId: 'createPositionComment',
        parameters: [{ name: 'posNumber', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/PositionCommentInput' } } } },
        responses: {
          '201': { description: 'Position note created', content: { 'application/json': { schema: { $ref: '#/components/schemas/PositionComment' } } } },
          '400': { description: 'Validation error' }
        }
      }
    },
    '/positions/{posNumber}/comments/{commentId}': {
      delete: {
        tags: ['Positions'],
        operationId: 'deletePositionComment',
        parameters: [
          { name: 'posNumber', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'commentId', in: 'path', required: true, schema: { type: 'string' } }
        ],
        responses: { '204': { description: 'Position note deleted' }, '404': { description: 'Position note not found' } }
      }
    },
    '/report-views/{id}/comments/{commentId}': {
      patch: {
        tags: ['Reports'],
        operationId: 'updateViewComment',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'commentId', in: 'path', required: true, schema: { type: 'string' } }
        ],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['body'], properties: { body: { type: 'string' } } } } } },
        responses: { '200': { description: 'Comment updated', content: { 'application/json': { schema: { $ref: '#/components/schemas/ReportViewComment' } } } }, '404': { description: 'Comment not found' } }
      },
      delete: {
        tags: ['Reports'],
        operationId: 'deleteViewComment',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'commentId', in: 'path', required: true, schema: { type: 'string' } }
        ],
        responses: { '204': { description: 'Comment deleted' }, '404': { description: 'Comment not found' } }
      }
    },
    '/advanced-search': {
      post: {
        tags: ['Advanced Search'],
        operationId: 'runAdvancedSearch',
        summary: 'Search positions by name, vacancy, contract type/code and contract dates',
        description:
          'Every predicate is built and bound server-side — there is no user-authored SQL. ' +
          '`organization` is required and must be visible to the caller. ' +
          '`positionType` is `all` (default), `filled` or `vacant`. Setting `positionType = vacant` ' +
          'clears `contractStart`/`contractEnd`, because a vacant position has no contract at all. ' +
          'Only **open, funded seats** are searched: a seat whose `pos_ending` has already passed ' +
          'is historical, and a seat whose position number starts `888` is a placeholder, so both ' +
          'are excluded from `all`, `filled` **and** `vacant`. This is the same definition the KPI ' +
          'dashboard and the Open Positions report use, so the three surfaces agree. Scoping `all` ' +
          'along with the two halves is what preserves `all` = `filled` + `vacant`. ' +
          'Results are capped at 2000 rows; `truncated` flags a capped response. ' +
          'Vacant rows carry a blank `Emp No.` and blank contract dates, and `Vacant` is true so ' +
          'the client can render the vacancy badge instead of a name.',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/AdvancedSearchRequest' } }
          }
        },
        responses: {
          '200': {
            description: 'Search results',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/AdvancedSearchResult' } }
            }
          },
          '400': { description: 'Invalid or missing `organization`' },
          '403': { description: 'Organization outside the caller scope (ORGANIZATION_FORBIDDEN)' }
        }
      }
    },
    '/advanced-search/options': {
      get: {
        tags: ['Advanced Search'],
        operationId: 'getAdvancedSearchOptions',
        summary: 'List the filter options for one school',
        description:
          'DISTINCT position names, the contract types that actually occur in the school ' +
          '(with a row count so each option shows what it would return) and the DISTINCT ' +
          'contract codes. Options come from the data, so a school never offers a filter ' +
          'that would return nothing. The population is restricted to the same open, funded ' +
          'seats the search itself returns, so an option can never promise rows the table ' +
          'cannot produce.',
        parameters: [
          {
            name: 'organization',
            in: 'query',
            required: true,
            description: 'School name, as returned by the reporting tables.',
            schema: { type: 'string' }
          }
        ],
        responses: {
          '200': {
            description: 'Filter options for the school',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/AdvancedSearchOptions' } }
            }
          },
          '400': { description: 'Missing `organization`' },
          '403': { description: 'Organization outside the caller scope (ORGANIZATION_FORBIDDEN)' }
        }
      }
    }
  },
  components: {
    schemas: {
      LoginRequest: {
        type: 'object',
        required: ['wakeId', 'employeeId'],
        properties: {
          wakeId: { type: 'string', example: 'hr.admin' },
          employeeId: { type: 'string', example: '900003' }
        }
      },
      HealthResponse: {
        type: 'object',
        required: ['ok', 'dataSource'],
        properties: { ok: { type: 'boolean' }, dataSource: { type: 'string', example: 'fixtures' } }
      },
      SnapshotReading: {
        type: 'object',
        required: ['takenAt', 'source', 'counts'],
        description:
          'One daily measurement of the reporting tables, recorded by the server itself. One per ' +
          'day on which an administrator opened the page.',
        properties: {
          takenAt: { type: 'string', format: 'date-time', description: 'When the measurement was taken.' },
          source: { type: 'string', example: 'mysql', description: 'Backing store that produced it.' },
          counts: {
            type: 'object',
            additionalProperties: { type: 'integer' },
            description: 'Table name to the exact `COUNT(*)` at `takenAt`.'
          },
          checksums: {
            type: 'object',
            additionalProperties: { type: 'integer' },
            description: 'Table name to the `CHECKSUM TABLE` value. Empty when the source cannot checksum.'
          },
          dataAsOf: { type: 'string', nullable: true, example: '2026-09-11 00:00:00' }
        }
      },
      SystemInfoRow: {
        type: 'object',
        required: ['table'],
        description:
          'One reporting table. `baselineCount` is the count in the recorded reading being compared ' +
          'against; `liveCount` is the row count right now. Either side may be null when it could ' +
          'not be read, which is the normal state on the first day.',
        properties: {
          table: { type: 'string', example: 'employee_info' },
          baselineCount: { type: 'integer', nullable: true },
          liveCount: { type: 'integer', nullable: true },
          delta: { type: 'integer', nullable: true },
          deltaPct: {
            type: 'number',
            nullable: true,
            description: 'delta / baselineCount as a percentage, rounded to 2dp.'
          },
          contentChanged: {
            type: 'boolean',
            nullable: true,
            description:
              'True when the table contents differ from the baseline even though the row count may ' +
              'match. Null when either side has no checksum.'
          }
        }
      },
      SystemInfoPayload: {
        type: 'object',
        required: ['generatedAt', 'dataSource', 'snapshotFile', 'recordedNow', 'readings', 'rows', 'liveCountsAvailable'],
        properties: {
          generatedAt: { type: 'string', format: 'date-time' },
          dataSource: { type: 'string', enum: ['mysql', 'turso', 'hybrid', 'fixtures'] },
          snapshotFile: {
            type: 'string',
            example: 'docs/data/daily-refresh/system-info-snapshot.json',
            description: 'Repo-relative path of the snapshot the baseline was read from.'
          },
          snapshotError: {
            type: 'string',
            nullable: true,
            description: 'Set when the snapshot file exists but could not be parsed.'
          },
          recordedNow: {
            type: 'boolean',
            description: 'True when this request appended a reading, i.e. the first one of the day.'
          },
          readings: {
            type: 'array',
            items: { $ref: '#/components/schemas/SnapshotReading' },
            description: 'Newest first, capped at 10.'
          },
          baseline: {
            nullable: true,
            allOf: [{ $ref: '#/components/schemas/SnapshotReading' }],
            description: 'The newest reading taken on a previous day. Null on the first day.'
          },
          rows: { type: 'array', items: { $ref: '#/components/schemas/SystemInfoRow' } },
          dataAsOf: {
            type: 'string',
            nullable: true,
            example: '2026-09-11 00:00:00',
            description: 'Newest data date the reporting tables can attest to. Cast to a string so sentinel dates survive.'
          },
          liveCountsAvailable: { type: 'boolean', description: 'False when no live counts could be read at all.' }
        }
      },
      ErrorResponse: {
        type: 'object',
        required: ['error'],
        properties: { error: { type: 'string', example: 'EMPLOYEE_NUMBER_INVALID' } }
      },
      EmployeeLookup: {
        type: 'object',
        required: ['employeeNumber', 'fullName', 'organization', 'positionName', 'accountNumber', 'contractType', 'hireDate'],
        description: 'Narrow projection of a single employee, sized to what the future-incumbent form pre-fills.',
        properties: {
          employeeNumber: { type: 'string', example: '194121' },
          fullName: { type: 'string', example: 'Streete, Noah Ryan' },
          organization: { type: 'string', example: 'Athens High School - 318' },
          positionName: { type: 'string', example: 'Clerical Assistant' },
          accountNumber: { type: 'string', example: '02.5400.003.151.0109.0318' },
          contractType: { type: 'string', example: 'NC' },
          hireDate: { type: 'string', example: '2026-08-12' }
        }
      },
      EmployeeLookupResponse: {
        oneOf: [
          {
            type: 'object',
            required: ['found', 'employee'],
            properties: {
              found: { type: 'boolean', enum: [true] },
              employee: { $ref: '#/components/schemas/EmployeeLookup' }
            }
          },
          {
            type: 'object',
            required: ['found'],
            description: 'No employee carries that number, or the employee is outside the caller\'s school scope.',
            properties: { found: { type: 'boolean', enum: [false] } }
          }
        ]
      },
      Person: {
        type: 'object',
        required: ['personId', 'employeeNumber', 'fullName', 'organizationId'],
        properties: {
          personId: { type: 'string' },
          employeeNumber: { type: 'string' },
          firstName: { type: 'string' },
          lastName: { type: 'string' },
          fullName: { type: 'string' },
          email: { type: 'string', format: 'email' },
          organizationId: { type: 'string' },
          organization: { type: 'string' },
          positionName: { type: 'string' },
          costCenter: { type: 'string' },
          objectCode: { type: 'string' },
          primaryFlag: { type: 'string' },
          activeAssignment: { type: 'boolean' }
        }
      },
      PersonPage: {
        type: 'object',
        required: ['data', 'page', 'pageSize', 'total'],
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/Person' } },
          page: { type: 'integer' },
          pageSize: { type: 'integer' },
          total: { type: 'integer' }
        }
      },
      DirectoryResult: {
        type: 'object',
        description:
          'A person row (kind=person) or a position row (kind=position). ' +
          'A position row with vacant=true has no incumbent.',
        required: ['kind', 'organization', 'organizationId', 'positionName'],
        properties: {
          kind: { type: 'string', enum: ['person', 'position'] },
          personId: { type: 'string', nullable: true },
          employeeNumber: { type: 'string' },
          fullName: { type: 'string' },
          email: { type: 'string' },
          organization: { type: 'string' },
          organizationId: { type: 'string' },
          positionName: { type: 'string' },
          positionNumber: { type: 'string' },
          vacant: { type: 'boolean' }
        }
      },
      DirectoryPage: {
        type: 'object',
        required: ['data', 'page', 'pageSize', 'total', 'counts'],
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/DirectoryResult' } },
          page: { type: 'integer' },
          pageSize: { type: 'integer' },
          total: { type: 'integer' },
          counts: {
            type: 'object',
            required: ['people', 'positions'],
            properties: {
              people: { type: 'integer' },
              positions: { type: 'integer' }
            }
          }
        }
      },
      PersonRecord: {
        type: 'object',
        required: ['personId', 'identity', 'contact', 'assignment', 'compensation', 'contract', 'licensure', 'service', 'leaveBalances'],        properties: {
          personId: { type: 'string' },
          identity: { type: 'object', additionalProperties: true },
          contact: { type: 'object', additionalProperties: true },
          assignment: { type: 'object', additionalProperties: true },
          compensation: { type: 'object', additionalProperties: true },
          contract: { type: 'object', additionalProperties: true },
          licensure: { type: 'object', additionalProperties: true },
          service: { type: 'object', additionalProperties: true },
          leaveBalances: { type: 'array', items: { type: 'object', additionalProperties: true } }
        }
      },
      School: {
        type: 'object',
        required: ['id', 'schoolNumber', 'name', 'type', 'active'],
        properties: {
          id: { type: 'string' },
          schoolNumber: { type: 'string' },
          name: { type: 'string' },
          type: { type: 'string', enum: ['school', 'department'] },
          active: { type: 'boolean' }
        }
      },
      // ---- Clickable KPI dashboard ----
      KpiMetricKey: {
        type: 'string',
        description: 'Every metric in the catalog. Adding one here changes both the dashboard and its definition page.',
        enum: ['authorized', 'filled', 'vacant', 'vacancy-rate', 'active-staff', 'expiring-certs', 'expiring-contracts']
      },
      KpiUnit: {
        type: 'string',
        description: 'The grain of the metric. `positions` counts seats; `people` collapses to one row per person.',
        enum: ['positions', 'people']
      },
      KpiFacet: {
        type: 'string',
        description:
          'Seat-status view. Orthogonal to the metric: applied to any metric, `all` means every open seat, so ' +
          'switching `Vacant` → `All` widens the list. `all` is always `filled` + `vacant`.',
        enum: ['all', 'filled', 'vacant']
      },
      KpiFilterDoc: {
        type: 'object',
        required: ['column', 'test'],
        description: 'One row of the definition page’s filter table.',
        properties: {
          column: { type: 'string', example: 'e.full_name / e.emp_number' },
          test: { type: 'string', example: "both blank → this seat counts as vacant" }
        }
      },
      KpiPredicate: {
        type: 'object',
        required: ['base', 'incumbent'],
        description:
          'The machine-readable definition of a metric. Every tile, bar and list row is produced by evaluating ' +
          'this one predicate, which is why the numbers cannot drift apart.',
        properties: {
          base: { type: 'string', enum: ['open_positions', 'active_assignments'] },
          incumbent: { type: 'string', enum: ['any', 'present', 'absent'] },
          posName: { type: 'string', description: 'Restrict to one Position Title.' },
          certExpiresWithinDays: { type: 'integer', description: 'Certificate expires within this many days.' },
          contractEndsWithinDays: { type: 'integer', description: 'Contract ends within this many days.' }
        }
      },
      KpiMetricValue: {
        type: 'object',
        required: ['key', 'label', 'unit', 'value', 'displayValue', 'definition', 'note', 'drilldown', 'drillable', 'defaultFacet'],
        description: 'A metric with its value for one school — one tile or one strip entry.',
        properties: {
          key: { $ref: '#/components/schemas/KpiMetricKey' },
          label: { type: 'string', example: 'Vacant' },
          unit: { $ref: '#/components/schemas/KpiUnit' },
          value: { type: 'number', example: 25 },
          displayValue: { type: 'string', description: 'Pre-formatted, e.g. `25` or `26.2%`.', example: '25' },
          definition: { type: 'string', description: 'One sentence: what this number means.' },
          note: { type: 'string', description: 'What inflates or deflates the number.' },
          drilldown: {
            allOf: [{ $ref: '#/components/schemas/KpiMetricKey' }],
            nullable: true,
            description: 'The metric whose list this tile opens, or null when not clickable.'
          },
          drillable: { type: 'boolean' },
          defaultFacet: {
            allOf: [{ $ref: '#/components/schemas/KpiFacet' }],
            description: 'The facet the drill-down opens with, derived from the metric.'
          }
        }
      },
      KpiBar: {
        type: 'object',
        required: ['label', 'posName', 'value'],
        description: 'One bar: a Position Title and how many records carry it. Clicking filters the list to `posName`.',
        properties: {
          label: { type: 'string', example: 'Teacher - Regular Classroom' },
          posName: { type: 'string', description: 'The exact title value sent back as `posName`.' },
          value: { type: 'integer', example: 62 }
        }
      },
      KpiBreakdown: {
        type: 'object',
        required: ['axis', 'title', 'bars', 'titleCount', 'truncated', 'limit'],
        properties: {
          axis: { type: 'string', enum: ['pos_name'], description: 'Grouped by Position Title, never by account code.' },
          title: { type: 'string', example: 'Vacancies by Position Title' },
          bars: { type: 'array', items: { $ref: '#/components/schemas/KpiBar' } },
          titleCount: { type: 'integer', description: 'Distinct titles before the top-N cut.' },
          truncated: { type: 'boolean' },
          limit: { type: 'integer', example: 10 }
        }
      },
      KpiPositionRow: {
        type: 'object',
        required: ['posNumber', 'posName', 'organization', 'accountNumber', 'occupied'],
        properties: {
          posNumber: { type: 'string', example: '3180459' },
          posName: { type: 'string', example: 'Teacher - Regular Classroom' },
          organization: { type: 'string', example: 'Athens High School - 318' },
          accountNumber: { type: 'string' },
          monthsAvailable: { type: 'number', nullable: true },
          monthsUsed: { type: 'number', nullable: true },
          occupied: { type: 'boolean', description: 'The single Filled/Vacant boolean the whole dashboard shares.' },
          fullName: { type: 'string' },
          employeeNumber: { type: 'string' },
          personId: { type: 'string' },
          classroom: { type: 'string' },
          mailstop: { type: 'string' },
          tenureCode: { type: 'string' },
          contractId: { type: 'string' },
          contractEnd: { type: 'string' },
          certNextExpiration: { type: 'string', description: 'Earliest future certificate expiry, or blank.' },
          posStart: { type: 'string' },
          posEnding: { type: 'string' },
          tap: { type: 'string' },
          degree: { type: 'string' }
        }
      },
      SchoolKpiPayload: {
        type: 'object',
        required: ['school', 'asOf', 'expiryWindows', 'facet', 'tiles', 'strip', 'breakdown'],
        properties: {
          school: { type: 'string', example: 'Athens High School - 318' },
          asOf: { type: 'string', example: '2026-09-11' },
          expiryWindows: {
            type: 'object',
            required: ['certs', 'contracts'],
            description: 'Look-ahead in days for each expiry tile. They differ on purpose.',
            properties: {
              certs: { type: 'integer', example: 365, description: 'Certificate window — a full year, because the district renews on one annual cycle.' },
              contracts: { type: 'integer', example: 180 }
            }
          },
          facet: { allOf: [{ $ref: '#/components/schemas/KpiFacet' }], description: 'Echoed so the control stays in sync.' },
          tiles: {
            type: 'array',
            items: { $ref: '#/components/schemas/KpiMetricValue' },
            description: 'Four tiles in display order: Filled, Vacant, Expiring Certs, Expiring Contracts.'
          },
          strip: {
            type: 'array',
            items: { $ref: '#/components/schemas/KpiMetricValue' },
            description: 'Authorized and vacancy rate.'
          },
          breakdown: { $ref: '#/components/schemas/KpiBreakdown' }
        }
      },
      SchoolKpiRows: {
        type: 'object',
        required: ['metric', 'label', 'unit', 'facet', 'posName', 'query', 'metricValue', 'total', 'page', 'pageSize', 'pageCount', 'facetCounts', 'predicateSummary', 'posNames', 'rows'],
        properties: {
          metric: { $ref: '#/components/schemas/KpiMetricKey' },
          label: { type: 'string' },
          unit: { $ref: '#/components/schemas/KpiUnit' },
          facet: { $ref: '#/components/schemas/KpiFacet' },
          posName: { type: 'string', description: 'Blank when no title filter is active.' },
          query: { type: 'string', description: 'The resolved organization the rows came from.' },
          metricValue: {
            type: 'integer',
            description:
              'The tile’s number: rows matching the metric, computed before facet, title filter, search and ' +
              'pagination, so the list and the tile always agree. For a share metric this is the numerator. ' +
              'With no `facet` (or with `facet` equal to the metric’s `defaultFacet`) `total` equals this value, ' +
              'which is the tile→list parity the dashboard is built on.'
          },
          total: { type: 'integer', description: 'Rows after every filter — what the pager is built from.' },
          page: { type: 'integer' },
          pageSize: { type: 'integer' },
          pageCount: { type: 'integer', minimum: 1 },
          facetCounts: {
            type: 'object',
            required: ['all', 'filled', 'vacant'],
            description: 'Counts for the seat-status chips, independent of the metric. `all` is always `filled` + `vacant`.',
            properties: {
              all: { type: 'integer' },
              filled: { type: 'integer' },
              vacant: { type: 'integer' }
            }
          },
          predicateSummary: {
            type: 'string',
            description: 'The agreement footer, e.g. `open positions · incumbent = absent`.',
            example: 'open positions · incumbent = absent'
          },
          posNames: {
            type: 'array',
            items: { type: 'string' },
            description: 'Distinct Position Titles in the metric set, so the title filter cannot empty itself.'
          },
          rows: { type: 'array', items: { $ref: '#/components/schemas/KpiPositionRow' } }
        }
      },
      KpiMetricDefinition: {
        type: 'object',
        required: ['key', 'label', 'unit', 'aggregate', 'predicate', 'definition', 'note', 'filters', 'sourceTables', 'sql', 'drilldown'],
        description: 'The full public definition of a metric — what the “definition and read-only SQL” page renders.',
        properties: {
          key: { $ref: '#/components/schemas/KpiMetricKey' },
          label: { type: 'string' },
          unit: { $ref: '#/components/schemas/KpiUnit' },
          aggregate: { type: 'string', enum: ['count', 'share'] },
          shareOf: { allOf: [{ $ref: '#/components/schemas/KpiMetricKey' }], description: 'The denominator, for a share metric.' },
          predicate: { $ref: '#/components/schemas/KpiPredicate' },
          definition: { type: 'string' },
          note: { type: 'string' },
          filters: { type: 'array', items: { $ref: '#/components/schemas/KpiFilterDoc' }, minItems: 1 },
          sourceTables: { type: 'array', items: { type: 'string' } },
          sql: {
            type: 'object',
            required: ['count', 'rows'],
            description: 'Read-only, generated from the predicate so the prose and the SQL cannot disagree.',
            properties: {
              count: { type: 'string' },
              rows: { type: 'string' }
            }
          },
          drilldown: {
            allOf: [{ $ref: '#/components/schemas/KpiMetricKey' }],
            nullable: true,
            description: 'Where the tile sends you. Null when not clickable.'
          }
        }
      },
      KpiCatalog: {
        type: 'object',
        required: ['expiryWindows', 'barLimit', 'tileOrder', 'stripOrder', 'keys', 'metrics'],
        properties: {
          expiryWindows: {
            type: 'object',
            required: ['certs', 'contracts'],
            properties: {
              certs: { type: 'integer', example: 365 },
              contracts: { type: 'integer', example: 180 }
            }
          },
          barLimit: { type: 'integer', example: 10 },
          tileOrder: { type: 'array', items: { $ref: '#/components/schemas/KpiMetricKey' } },
          stripOrder: { type: 'array', items: { $ref: '#/components/schemas/KpiMetricKey' } },
          keys: { type: 'array', items: { $ref: '#/components/schemas/KpiMetricKey' } },
          metrics: {
            type: 'array',
            description: 'Presentation slice of the catalog: a display label and default facet for every metric.',
            items: {
              type: 'object',
              required: ['key', 'label', 'defaultFacet', 'unit', 'drillable'],
              properties: {
                key: { $ref: '#/components/schemas/KpiMetricKey' },
                label: { type: 'string', example: 'Vacancy rate' },
                defaultFacet: { $ref: '#/components/schemas/KpiFacet' },
                unit: { type: 'string', example: 'positions' },
                drillable: { type: 'boolean', description: 'False for metrics documented here but not shown on the dashboard.' }
              }
            }
          }
        }
      },
      OpenPositionRow: {
        type: 'object',
        required: ['posNumber', 'posName', 'organization', 'accountNumber'],
        properties: {
          posStart: { type: 'string' },
          posEnding: { type: 'string' },
          posNumber: { type: 'string' },
          posName: { type: 'string' },
          organization: { type: 'string' },
          accountNumber: { type: 'string' },
          monthsAvailable: { type: 'number' },
          monthsUsed: { type: 'number' },
          fullName: { type: 'string' },
          employeeNumber: { type: 'string' },
          classroom: { type: 'string' },
          mailstop: { type: 'string' },
          tenureCode: { type: 'string' },
          contractId: { type: 'string' },
          contractEnd: { type: 'string' },
          tap: { type: 'string' },
          degree: { type: 'string' },
          nbptsExpire: { type: 'string' }
        }
      },
      OpenPositionReport: {
        type: 'object',
        required: ['organization', 'columns', 'rows'],
        properties: {
          organization: { type: 'string' },
          columns: { type: 'array', items: { type: 'string' } },
          rows: { type: 'array', items: { $ref: '#/components/schemas/OpenPositionRow' } }
        }
      },
      PositionInfo: {
        type: 'object',
        required: ['positionId', 'posStart', 'posEnding', 'posName', 'posNumber'],
        properties: {
          positionId: { type: 'integer' },
          posStart: { type: 'string' },
          posEnding: { type: 'string' },
          posName: { type: 'string' },
          posNumber: { type: 'string' },
          fund: { type: 'string' },
          purpose: { type: 'string' },
          program: { type: 'string' },
          object: { type: 'string' },
          level: { type: 'string' },
          costCenter: { type: 'string' },
          months: { type: 'number', nullable: true },
          administrator: { type: 'string' },
          organization: { type: 'string' },
          calendar: { type: 'string' },
          locType: { type: 'string' },
          region: { type: 'string' },
          ss200Code: { type: 'string' }
        }
      },
      IncumbentSummary: {
        type: 'object',
        properties: {
          fullName: { type: 'string' },
          employeeNumber: { type: 'string' },
          personId: { type: 'string' },
          tenureCode: { type: 'string' },
          tenureDesc: { type: 'string' },
          contractType: { type: 'string' },
          contractId: { type: 'string' },
          contractStart: { type: 'string' },
          contractEnd: { type: 'string' },
          tap: { type: 'string' },
          months: { type: 'number', nullable: true },
          classroom: { type: 'string' },
          mailstop: { type: 'string' },
          object: { type: 'string' }
        }
      },
      PositionDetails: {
        type: 'object',
        required: ['position', 'accountNumber', 'org', 'vacant'],
        properties: {
          position: { $ref: '#/components/schemas/PositionInfo' },
          accountNumber: { type: 'string' },
          incumbent: { $ref: '#/components/schemas/IncumbentSummary', nullable: true },
          org: { type: 'string' },
          vacant: { type: 'boolean' }
        }
      },
      ReportSection: {
        type: 'object',
        required: ['id', 'title', 'sortOrder', 'isActive'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          sortOrder: { type: 'integer' },
          isActive: { type: 'boolean' },
          reportCount: { type: 'integer' },
          createdAt: { type: 'string' },
          updatedAt: { type: 'string' }
        }
      },
      ReportSectionInput: {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string', maxLength: 120 },
          sortOrder: { type: 'integer' },
          isActive: { type: 'boolean' }
        }
      },
      ReportHighlightCondition: {
        type: 'object',
        required: ['column', 'operator', 'value'],
        properties: {
          column: { type: 'string', maxLength: 64 },
          operator: { type: 'string', enum: ['eq', 'neq', 'contains', 'not_contains', 'is_empty', 'is_not_empty'] },
          value: { type: 'string', maxLength: 200 }
        }
      },
      ReportHighlightRule: {
        type: 'object',
        required: ['id', 'logic', 'conditions', 'color'],
        properties: {
          id: { type: 'string' },
          logic: { type: 'string', enum: ['and', 'or'], description: 'How conditions combine: all (and) or any (or). Default or.' },
          conditions: { type: 'array', items: { $ref: '#/components/schemas/ReportHighlightCondition' }, minItems: 1, maxItems: 5 },
          color: { type: 'string', enum: ['pastel_red', 'pastel_yellow', 'pastel_green', 'pastel_blue', 'pastel_pink', 'pastel_orange'] }
        }
      },
      ReportDefinition: {
        type: 'object',
        required: ['id', 'sectionId', 'title', 'status'],
        properties: {
          id: { type: 'string' },
          sectionId: { type: 'string' },
          sectionTitle: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          sqlQuery: { type: 'string', description: 'Only returned to admins' },
          status: { type: 'string', enum: ['active', 'inactive'] },
          rowKeyColumn: { type: 'string', nullable: true, description: 'Declared stable row key column for view highlights/comments' },
          highlightRules: { type: 'array', items: { $ref: '#/components/schemas/ReportHighlightRule' }, description: 'Admin-configured conditional row highlighting (first match wins)' },
          subreportQuery: { type: 'string', description: 'Optional child (subreport) query. Only returned to admins' },
          subreportKeyColumn: { type: 'string', nullable: true, description: 'Main-row column bound to the subreport :person_id' },
          columns: { type: 'array', items: { type: 'string' }, description: 'Optional curated MAIN display columns (defaults to driver columns)' },
          additionalColumns: { type: 'array', items: { type: 'string' }, description: 'Optional blank columns appended to the end of the Excel export' },
          createdBy: { type: 'string' },
          createdAt: { type: 'string' },
          updatedAt: { type: 'string' }
        }
      },
      ReportDefinitionInput: {
        type: 'object',
        required: ['sectionId', 'title', 'sqlQuery'],
        properties: {
          sectionId: { type: 'string' },
          title: { type: 'string', maxLength: 150 },
          description: { type: 'string' },
          sqlQuery: { type: 'string', description: 'Single SELECT with a :organization bind parameter' },
          status: { type: 'string', enum: ['active', 'inactive'] },
          rowKeyColumn: { type: 'string', nullable: true, description: 'Declared stable row key column' },
          highlightRules: { type: 'array', items: { $ref: '#/components/schemas/ReportHighlightRule' }, maxItems: 10 },
          subreportQuery: { type: 'string', description: 'Optional child (subreport) query with a :person_id bind' },
          subreportKeyColumn: { type: 'string', nullable: true, description: 'Main-row column bound to the subreport :person_id' },
          columns: { type: 'array', items: { type: 'string' }, maxItems: 200, description: 'Curated MAIN display columns (omit person_id to hide it)' },
          additionalColumns: { type: 'array', items: { type: 'string' }, maxItems: 200, description: 'Optional blank columns appended to the end of the Excel export' }
        }
      },
      ValidateSqlRequest: {
        type: 'object',
        required: ['sqlQuery'],
        properties: { sqlQuery: { type: 'string' } }
      },
      ReportSubreportRun: {
        type: 'object',
        required: ['keyColumn', 'columns', 'rows', 'truncated'],
        properties: {
          keyColumn: { type: 'string' },
          columns: { type: 'array', items: { type: 'string' } },
          rows: { type: 'array', items: { type: 'object', additionalProperties: true } },
          truncated: { type: 'boolean' }
        }
      },
      ReportRunResult: {
        type: 'object',
        required: ['report', 'organization', 'columns', 'rows', 'truncated'],
        properties: {
          report: { type: 'object', additionalProperties: true },
          organization: { type: 'string' },
          columns: { type: 'array', items: { type: 'string' } },
          rows: { type: 'array', items: { type: 'object', additionalProperties: true } },
          subreport: { type: 'object', nullable: true, properties: { keyColumn: { type: 'string' } }, description: 'Present when the report has a nested subreport' },
          truncated: { type: 'boolean' }
        }
      },
      ReportViewDefinition: {
        type: 'object',
        required: ['columnOrder', 'hiddenColumns', 'filterText', 'sort', 'highlights'],
        properties: {
          columnOrder: { type: 'array', items: { type: 'string' } },
          hiddenColumns: { type: 'array', items: { type: 'string' } },
          filterText: { type: 'string', maxLength: 200 },
          sort: { type: 'object', nullable: true, additionalProperties: true },
          highlights: { type: 'array', items: { type: 'object', additionalProperties: true } }
        }
      },
      ReportView: {
        type: 'object',
        required: ['id', 'reportId', 'organization', 'ownerId', 'name', 'definition', 'version'],
        properties: {
          id: { type: 'string' },
          reportId: { type: 'string' },
          organization: { type: 'string' },
          ownerId: { type: 'string' },
          ownerName: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          visibility: { type: 'string', enum: ['private', 'invite_only'] },
          definition: { $ref: '#/components/schemas/ReportViewDefinition' },
          version: { type: 'integer' },
          createdAt: { type: 'string' },
          updatedAt: { type: 'string' }
        }
      },
      ReportViewInput: {
        type: 'object',
        required: ['reportId', 'organization', 'name', 'definition'],
        properties: {
          reportId: { type: 'string' },
          organization: { type: 'string' },
          name: { type: 'string', maxLength: 60 },
          description: { type: 'string' },
          visibility: { type: 'string', enum: ['private', 'invite_only'] },
          definition: { $ref: '#/components/schemas/ReportViewDefinition' }
        }
      },
      ReportViewPatch: {
        type: 'object',
        properties: {
          name: { type: 'string', maxLength: 60 },
          description: { type: 'string' },
          visibility: { type: 'string', enum: ['private', 'invite_only'] },
          definition: { $ref: '#/components/schemas/ReportViewDefinition' },
          expectedVersion: { type: 'integer' }
        }
      },
      ReportViewInvite: {
        type: 'object',
        required: ['id', 'viewId', 'inviterId', 'inviteeName', 'role', 'status'],
        properties: {
          id: { type: 'string' },
          viewId: { type: 'string' },
          inviterId: { type: 'string' },
          inviteeId: { type: 'string', nullable: true },
          inviteeEmail: { type: 'string', nullable: true },
          inviteeName: { type: 'string' },
          role: { type: 'string', enum: ['viewer', 'commenter', 'editor'] },
          status: { type: 'string', enum: ['pending', 'accepted', 'declined', 'revoked'] },
          createdAt: { type: 'string' },
          updatedAt: { type: 'string' }
        }
      },
      ReportViewInviteInput: {
        type: 'object',
        required: ['inviteeName', 'role'],
        properties: {
          inviteeId: { type: 'string' },
          inviteeEmail: { type: 'string', format: 'email' },
          inviteeName: { type: 'string' },
          role: { type: 'string', enum: ['viewer', 'commenter', 'editor'] }
        }
      },
      ReportViewComment: {
        type: 'object',
        required: ['id', 'viewId', 'authorId', 'authorName', 'body'],
        properties: {
          id: { type: 'string' },
          viewId: { type: 'string' },
          authorId: { type: 'string' },
          authorName: { type: 'string' },
          body: { type: 'string' },
          rowKey: { type: 'string', nullable: true },
          parentId: { type: 'string', nullable: true },
          createdAt: { type: 'string' },
          updatedAt: { type: 'string' }
        }
      },
      PositionPin: {
        type: 'object',
        required: ['id', 'userId', 'posNumber', 'posName', 'organization', 'createdAt'],
        properties: {
          id: { type: 'string' },
          userId: { type: 'string' },
          posNumber: { type: 'string' },
          posName: { type: 'string' },
          organization: { type: 'string' },
          incumbentName: { type: 'string', nullable: true },
          employeeNumber: { type: 'string', nullable: true },
          createdAt: { type: 'string' }
        }
      },
      PositionPinInput: {
        type: 'object',
        required: ['posNumber', 'posName', 'organization'],
        properties: {
          posNumber: { type: 'string', maxLength: 64 },
          posName: { type: 'string', maxLength: 200 },
          organization: { type: 'string', maxLength: 200 },
          incumbentName: { type: 'string', nullable: true, maxLength: 200 },
          employeeNumber: { type: 'string', nullable: true, maxLength: 32 }
        }
      },
      PositionPinPage: {
        type: 'object',
        required: ['data', 'total'],
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/PositionPin' } },
          total: { type: 'integer' }
        }
      },
      PositionPinCheck: {
        type: 'object',
        required: ['posNumber', 'organization', 'pinned', 'pinId'],
        properties: {
          posNumber: { type: 'string' },
          organization: { type: 'string' },
          pinned: { type: 'boolean' },
          pinId: { type: 'string', nullable: true }
        }
      },
      PositionComment: {
        type: 'object',
        required: ['id', 'posNumber', 'organization', 'authorId', 'authorName', 'body'],
        properties: {
          id: { type: 'string' },
          posNumber: { type: 'string' },
          organization: { type: 'string' },
          authorId: { type: 'string' },
          authorName: { type: 'string' },
          body: { type: 'string' },
          createdAt: { type: 'string' },
          updatedAt: { type: 'string' }
        }
      },
      PositionCommentInput: {
        type: 'object',
        required: ['organization', 'body'],
        properties: {
          organization: { type: 'string', maxLength: 200 },
          body: { type: 'string', maxLength: 2000 }
        }
      },
      ReportViewCommentInput: {
        type: 'object',
        required: ['body'],
        properties: {
          body: { type: 'string', maxLength: 2000 },
          rowKey: { type: 'string', nullable: true },
          parentId: { type: 'string', nullable: true }
        }
      },
      AdvancedSearchRequest: {
        type: 'object',
        required: ['organization'],
        properties: {
          organization: {
            type: 'string',
            description: 'School name. Required; must be visible to the caller.'
          },
          positionName: {
            type: 'string',
            description: 'Exact position name, as offered by GET /advanced-search/options.'
          },
          positionType: {
            type: 'string',
            enum: ['all', 'filled', 'vacant'],
            default: 'all',
            description:
              '`vacant` means no incumbent (no full name AND no employee number). Selecting ' +
              '`vacant` clears the contract date filters and `personStart`, because a vacant ' +
              'seat has no contract and no incumbent. `positionStart` is kept — it belongs to ' +
              'the seat. All three values describe the same **open, funded** seat population: ' +
              'seats that have already ended and `888…` placeholder seats are excluded, so ' +
              '`all` is always `filled` + `vacant`.'
          },
          contractTypes: {
            type: 'array',
            items: { type: 'string' },
            description: 'Contract type codes (T, NC, 1Y, 2Y, C, 4E). Empty array means no filter.'
          },
          contractCode: {
            type: 'string',
            description: 'Tenure / contract code from the contract table.'
          },
          contractStart: {
            type: 'string',
            format: 'date',
            description: 'Exact contract start date (`YYYY-MM-DD`). Ignored when positionType is vacant.'
          },
          contractEnd: {
            type: 'string',
            format: 'date',
            description: 'Exact contract end date (`YYYY-MM-DD`). Ignored when positionType is vacant.'
          },
          positionStart: {
            type: 'string',
            format: 'date',
            description:
              'Exact seat start date (`YYYY-MM-DD`) — `position_info.pos_start`. Seat-owned, so ' +
              'unlike the other dates it **also applies when `positionType` is `vacant`**; that is ' +
              'how you ask "which empty seats open in 2027?". Note `1951-01-01` is the "not ' +
              'recorded" placeholder in this data (1,921 rows) and the grid renders it blank — ' +
              'filtering it does match those rows.'
          },
          personStart: {
            type: 'string',
            format: 'date',
            description:
              'Exact start date of the incumbent\u2019s current assignment (`YYYY-MM-DD`) — ' +
              '`employee_info.assign_start`. Incumbent-owned, so ignored when positionType is ' +
              'vacant (a vacant seat has nobody to start). This is *not* tenure: it is restamped ' +
              'when someone moves, and only ~18% of rows equal `hire_date`.'
          }
        }
      },
      AdvancedSearchRow: {
        type: 'object',
        description:
          'Keyed by the display header so the shared sort / hide / export machinery can consume ' +
          'it unchanged. `Vacant` is metadata and is not one of the `columns`.',
        properties: {
          Name: { type: 'string' },
          'Emp No.': { type: 'string' },
          Organization: { type: 'string' },
          'Position Name': { type: 'string' },
          'Pos No': { type: 'string' },
          'Contract Type': {
            type: 'string',
            description: 'The contract type label for the incumbent; blank on a vacant row.'
          },
          TAP: {
            type: 'string',
            description:
              'The incumbent assignment percentage -- `employee_info.tap` rendered as ' +
              '`ROUND(tap * 100)`, the same expression the Contract Report uses. `100` means ' +
              'full time; anything lower is part time and is excluded from the Contract ' +
              'Report, which filters on `tap = 1`. Blank on a vacant row.'
          },
          'Position Start': {
            type: 'string',
            description:
              'When the **seat** starts -- `position_info.pos_start`. Seat-owned, so unlike the ' +
              'other dates it survives on a vacant row. `1951-01-01` is the "not recorded" ' +
              'placeholder in this data (1,921 rows) and is deliberately rendered blank rather ' +
              'than shown as a 1951 date. Format `YYYY-MM-DD`.'
          },
          'Person Start': {
            type: 'string',
            description:
              'When the **incumbent** began this assignment -- `employee_info.assign_start`. ' +
              'Employee-owned, so it blanks with the rest of the incumbent columns on a vacant ' +
              'row. This is the start of the *current* assignment, not tenure -- it is ' +
              'restamped when someone moves, and only 18% of rows match `hire_date`. ' +
              'Format `YYYY-MM-DD`.'
          },
          'Cont Start': { type: 'string' },
          'Cont End': { type: 'string' },
          Vacant: { type: 'boolean', description: 'True when the position has no incumbent.' }
        }
      },
      AdvancedSearchResult: {
        type: 'object',
        properties: {
          organization: { type: 'string' },
          columns: { type: 'array', items: { type: 'string' } },
          rows: { type: 'array', items: { $ref: '#/components/schemas/AdvancedSearchRow' } },
          total: { type: 'integer' },
          truncated: { type: 'boolean', description: 'True when the 2000-row cap was hit.' },
          filters: {
            type: 'object',
            description: 'The normalised filters that actually applied (blank values are omitted).',
            properties: {
              organization: { type: 'string' },
              positionName: { type: 'string' },
              positionType: { type: 'string', enum: ['all', 'filled', 'vacant'] },
              contractTypes: { type: 'array', items: { type: 'string' } },
              contractCode: { type: 'string' },
              contractStart: { type: 'string' },
              contractEnd: { type: 'string' }
            }
          }
        }
      },
      AdvancedSearchOptions: {
        type: 'object',
        properties: {
          positionNames: { type: 'array', items: { type: 'string' } },
          contractTypes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                code: { type: 'string', example: 'NC' },
                description: { type: 'string', example: 'No Contract' },
                count: { type: 'integer', example: 4 }
              }
            }
          },
          contractCodes: { type: 'array', items: { type: 'string' } }
        }
      }
    }
  }
} as const;
