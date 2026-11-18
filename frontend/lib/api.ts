export interface Device {
  id: string;
  name: string;
  os: string;
  agentVersion: string;
  wingetVersion: string | null;
  health: string;
  connection: 'ONLINE' | 'OFFLINE' | 'REVOKED';
  lastSeen: string;
  revokedAt: string | null;
}
export interface Application {
  id: string;
  deviceId: string;
  name: string;
  publisher: string | null;
  installedVersion: string;
  availableVersion: string | null;
  packageId: string | null;
  source: string | null;
  status: string;
  lastObserved: string;
}
export interface Job {
  id: string;
  kind: 'SCAN' | 'UPDATE';
  status: string;
  deviceId: string;
  packageId: string | null;
  previousVersion: string | null;
  targetVersion: string | null;
  resultingVersion: string | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  exitCode: number | null;
  error: string | null;
  verified: boolean;
  detectedCount: number | null;
  application: { name: string } | null;
  device: { name: string };
  initiator: { email: string };
}
export interface AuditEvent {
  id: string;
  type: string;
  target: string | null;
  createdAt: string;
  metadata: unknown;
}
export interface Dashboard {
  total: number;
  updates: number;
  upToDate: number;
  unknown: number;
  devices: number;
  lastScan: string | null;
  recentJobs: Job[];
  activity: { createdAt: string; kind: string; status: string }[];
}
export interface Metadata {
  publisher: string | null;
  officialUrl: string | null;
  changelogUrl: string | null;
  releaseNotes: string | null;
  fetchedAt: string;
  source: string;
}
export interface Detail extends Application {
  metadata: Metadata | null;
  jobs: Job[];
}
export interface Preview {
  application: Application;
  confirmationToken: string;
  expiresInSeconds: number;
  permissions: string;
}
export interface ApiResponse<T> {
  data: T;
  pagination?: { total: number; page: number; limit: number };
  coverage?: string;
  explanation?: string;
}
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
  const csrf =
    typeof document === 'undefined'
      ? ''
      : (document.cookie
          .split('; ')
          .find((s) => s.startsWith('up_csrf='))
          ?.split('=')[1] ?? '');
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      ...options,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, ...options.headers },
      signal: options.signal ?? AbortSignal.timeout(15000),
    });
  } catch {
    throw new ApiError(
      0,
      'Cannot reach UpdatePilot. Check that the backend is running and try again.',
    );
  }
  const invalidResponse = () =>
    new ApiError(
      response.ok ? 502 : response.status,
      response.redirected
        ? 'The API redirected to another page. Check backend deployment protection and API_URL.'
        : `UpdatePilot API returned an invalid response (HTTP ${response.status}). Check API_URL and backend health.`,
    );
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json'))
    throw invalidResponse();
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw invalidResponse();
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalidResponse();
  if (!response.ok)
    throw new ApiError(
      response.status,
      'error' in body && typeof body.error === 'string' ? body.error : 'The request failed.',
    );
  if (!('data' in body)) throw invalidResponse();
  return body as ApiResponse<T>;
}
export const post = <T>(path: string, body: unknown = {}) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const date = (value: string | null) =>
  value
    ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : 'Not yet';
export const label = (s: string) =>
  s
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./, (c) => c.toUpperCase());
