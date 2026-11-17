const json = (schema: object) => ({ content: { 'application/json': { schema } } });
const object = (properties: object, required: string[] = []) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});
const string = { type: 'string' };
const uuid = { type: 'string', format: 'uuid' };
const response = {
  description: 'Structured result',
  ...json({ type: 'object', properties: { data: {}, pagination: { type: 'object' } } }),
};
const errors = {
  '400': { description: 'Validation failed' },
  '401': { description: 'Unauthenticated' },
  '403': { description: 'CSRF, replay or authorization rejected' },
  '404': { description: 'Resource not owned or not found' },
  '409': { description: 'Conflict, stale approval, duplicate operation or expired lease' },
  '503': { description: 'Database unavailable' },
};
const mutation = (summary: string, schema: object = object({}), status = '200', agent = false) => ({
  summary,
  security: agent ? [{ agentCredential: [] }] : [{ session: [] }],
  parameters: agent
    ? [
        {
          in: 'header',
          name: 'X-Agent-Timestamp',
          required: true,
          schema: { type: 'integer', description: 'Unix milliseconds, within 60 seconds' },
        },
        { in: 'header', name: 'X-Request-ID', required: true, schema: uuid },
      ]
    : [
        { in: 'header', name: 'X-CSRF-Token', required: true, schema: string },
        {
          in: 'header',
          name: 'Origin',
          required: true,
          schema: { type: 'string', example: 'http://localhost:3000' },
        },
      ],
  requestBody: { required: true, ...json(schema) },
  responses: { [status]: response, ...errors },
});
const get = (summary: string, query: string[] = []) => ({
  summary,
  security: [{ session: [] }],
  parameters: query.map((name) => ({ in: 'query', name, schema: string })),
  responses: { '200': response, ...errors },
});
const paths: Record<string, Record<string, unknown>> = {
  '/auth/login': {
    post: {
      ...mutation(
        'Sign in; sets HttpOnly session and readable CSRF cookie',
        object({ email: { type: 'string', format: 'email' }, password: string }, [
          'email',
          'password',
        ]),
      ),
      security: [],
      parameters: [{ in: 'header', name: 'Origin', required: true, schema: string }],
    },
  },
  '/auth/me': { get: get('Current account') },
  '/auth/logout': { post: mutation('Invalidate session') },
  '/dashboard': { get: get('Real inventory and job aggregates', ['deviceId']) },
  '/devices': { get: get('Owned devices and computed connection status') },
  '/devices/pair': {
    post: mutation('Explicitly approve a single-use, five-minute pairing code', object({}), '201'),
  },
  '/devices/{id}/scans': {
    post: mutation('Queue an asynchronous inventory scan', object({}), '202'),
  },
  '/devices/{id}/revoke': {
    post: mutation(
      'Revoke credentials; active operations must finish first',
      object({ confirm: { const: true } }, ['confirm']),
    ),
  },
  '/applications': {
    get: get('Paginated current inventory', [
      'deviceId',
      'page',
      'limit',
      'search',
      'status',
      'sort',
      'order',
    ]),
  },
  '/applications/{id}': {
    get: get('Inventory details, cached source manifest metadata and job history'),
  },
  '/updates': {
    get: get('Eligible inventory with package-manager evidence', [
      'deviceId',
      'page',
      'limit',
      'search',
    ]),
  },
  '/updates/{id}/preview': {
    post: mutation('Application ID: review exact identity and issue bound one-use approval'),
  },
  '/updates/{id}/execute': {
    post: mutation(
      'Consume explicit confirmation and queue exact update',
      object({ confirmationToken: string, confirm: { const: true } }, [
        'confirmationToken',
        'confirm',
      ]),
      '202',
    ),
  },
  '/jobs/{id}': { get: get('Job status, diagnostics and verified outcome') },
  '/scans/{id}': { get: get('Scan job status') },
  '/jobs/{id}/cancel': { post: mutation('Cancel only a queued job') },
  '/history': {
    get: get('Persisted job or audit history', [
      'deviceId',
      'page',
      'limit',
      'search',
      'status',
      'type',
      'order',
    ]),
  },
  '/security/findings': { get: get('Explicitly unavailable vulnerability matching coverage') },
  '/settings': {
    get: get('Account history retention'),
    patch: mutation(
      'Set effective history retention in days',
      object({ retentionDays: { type: 'integer', minimum: 30, maximum: 365 } }, ['retentionDays']),
    ),
  },
  '/exports/{kind}': {
    get: {
      ...get('CSV inventory or history; maximum 50,000 records', ['deviceId']),
      responses: {
        '200': { description: 'CSV file', content: { 'text/csv': { schema: string } } },
      },
    },
  },
  '/agent/pair': {
    post: {
      ...mutation(
        'Exchange one-use pairing code; no Origin header',
        object({ code: string, name: string, os: string, agentVersion: string }, [
          'code',
          'name',
          'os',
          'agentVersion',
        ]),
        '201',
        true,
      ),
      security: [],
      parameters: [],
    },
  },
  '/agent/heartbeat': {
    post: mutation(
      'Report health and refresh last-seen',
      object(
        {
          agentVersion: string,
          wingetVersion: { type: ['string', 'null'] },
          health: {
            enum: ['READY', 'WINGET_UNAVAILABLE', 'MODULE_UNAVAILABLE', 'SOURCE_UNAVAILABLE'],
          },
        },
        ['agentVersion', 'wingetVersion', 'health'],
      ),
      '200',
      true,
    ),
  },
  '/agent/jobs/claim': {
    post: mutation(
      'Atomically claim one operation; returns one execution lease or null',
      object({}),
      '200',
      true,
    ),
  },
  '/agent/jobs/{id}/progress': {
    post: mutation(
      'Extend 90-second lease; verification cannot reverse',
      object({ lease: string, status: { enum: ['RUNNING', 'VERIFYING'] } }, ['lease', 'status']),
      '200',
      true,
    ),
  },
  '/agent/jobs/{id}/scan-result': {
    post: mutation(
      'Persist atomic scan snapshot; completed requires observations',
      object(
        {
          lease: string,
          status: { enum: ['COMPLETED', 'FAILED', 'INTERRUPTED'] },
          applications: { type: 'array', items: { $ref: '#/components/schemas/Observation' } },
          error: string,
        },
        ['lease', 'status'],
      ),
      '200',
      true,
    ),
  },
  '/agent/jobs/{id}/update-result': {
    post: mutation(
      'Compute final status from exit code and post-update observation',
      object(
        {
          lease: string,
          outcome: { enum: ['FINISHED', 'FAILED', 'CANCELLED', 'INTERRUPTED', 'RESTART_REQUIRED'] },
          packageId: string,
          source: { const: 'winget' },
          resultingVersion: { type: ['string', 'null'] },
          exitCode: { type: 'integer' },
          error: string,
        },
        ['lease', 'outcome', 'packageId', 'source', 'resultingVersion', 'exitCode'],
      ),
      '200',
      true,
    ),
  },
  '/openapi.json': { get: get('OpenAPI contract') },
};
for (const [path, item] of Object.entries(paths)) {
  if (path.includes('{id}'))
    item.parameters = [{ in: 'path', name: 'id', required: true, schema: uuid }];
  if (path.includes('{kind}'))
    item.parameters = [
      { in: 'path', name: 'kind', required: true, schema: { enum: ['inventory', 'history'] } },
    ];
}
export const openapi = {
  openapi: '3.1.0',
  info: {
    title: 'UpdatePilot local API',
    version: '0.1.0',
    description:
      'Loopback-only MVP. Browser mutations require exact Origin and session-bound CSRF header. Agent requests require bearer credential, unique request UUID and recent Unix milliseconds. No automatic installer retry.',
  },
  servers: [{ url: '/api/v1' }],
  components: {
    securitySchemes: {
      session: { type: 'apiKey', in: 'cookie', name: 'up_session' },
      agentCredential: { type: 'http', scheme: 'bearer' },
    },
    schemas: {
      Observation: object(
        {
          identity: string,
          name: string,
          publisher: { type: ['string', 'null'] },
          installedVersion: string,
          availableVersion: { type: ['string', 'null'] },
          packageId: { type: ['string', 'null'] },
          source: { type: ['string', 'null'] },
          status: {
            enum: [
              'UPDATE_AVAILABLE',
              'UP_TO_DATE',
              'UNKNOWN_VERSION',
              'UNMATCHED',
              'UNSUPPORTED',
              'METADATA_UNAVAILABLE',
            ],
          },
        },
        [
          'identity',
          'name',
          'publisher',
          'installedVersion',
          'availableVersion',
          'packageId',
          'source',
          'status',
        ],
      ),
    },
  },
  paths,
};
