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
    { name: 'Reports', description: 'Report generation and scoping' }
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
        tags: ['Reports'],
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
      PersonRecord: {
        type: 'object',
        required: ['personId', 'identity', 'contact', 'assignment', 'compensation', 'contract', 'licensure', 'service', 'leaveBalances'],
        properties: {
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
      }
    }
  }
} as const;
