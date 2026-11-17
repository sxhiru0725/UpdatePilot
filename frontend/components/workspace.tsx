'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Database,
  Download,
  Grid2X2,
  History,
  Laptop,
  LoaderCircle,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Orbit,
  Package,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  ShieldQuestion,
  Sun,
  Unplug,
  Wifi,
  X,
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  api,
  post,
  ApiError,
  date,
  label,
  type Application,
  type AuditEvent,
  type Dashboard,
  type Detail,
  type Device,
  type Job,
  type Preview,
} from '@/lib/api';

const nav = [
  { id: '', title: 'Overview', icon: Grid2X2 },
  { id: 'applications', title: 'Applications', icon: Package },
  { id: 'updates', title: 'Updates', icon: Download },
  { id: 'security', title: 'Security insights', icon: ShieldCheck },
  { id: 'history', title: 'History', icon: History },
  { id: 'settings', title: 'Settings & agent', icon: Settings2 },
];
const activeStatuses = ['QUEUED', 'RUNNING', 'VERIFYING'];
function Status({ value }: { value: string }) {
  const tone = ['COMPLETED', 'UP_TO_DATE', 'ONLINE', 'READY'].includes(value)
    ? 'green'
    : ['FAILED', 'VERIFICATION_FAILED', 'REVOKED'].includes(value)
      ? 'red'
      : ['UPDATE_AVAILABLE', 'RESTART_REQUIRED', 'INTERRUPTED'].includes(value)
        ? 'amber'
        : ['RUNNING', 'VERIFYING', 'QUEUED'].includes(value)
          ? 'blue'
          : 'muted';
  return (
    <span className={`status ${tone}`}>
      <span className="status-dot" />
      {label(value)}
    </span>
  );
}
function AppIcon({ name }: { name: string }) {
  return (
    <span className="app-icon" aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
function Empty({
  title,
  children,
  icon: Icon = Package,
}: {
  title: string;
  children: React.ReactNode;
  icon?: typeof Package;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon size={25} />
      </span>
      <h3>{title}</h3>
      <div>{children}</div>
    </div>
  );
}
function Modal({
  title,
  description,
  children,
  onClose,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog">
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description>{description}</Dialog.Description>
          <Dialog.Close className="icon-button dialog-close" aria-label="Close dialog">
            <X size={20} />
          </Dialog.Close>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
const loginSchema = z.object({
  email: z.string().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});
function Login({ onLogin }: { onLogin: () => void }) {
  const [error, setError] = useState('');
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema) });
  return (
    <main className="login-page">
      <div className="login-story">
        <div className="brand">
          <Orbit size={32} />
          UpdatePilot<span className="beta">LOCAL</span>
        </div>
        <div>
          <div className="eyebrow">SOFTWARE, UNDER CONTROL</div>
          <h1>
            Stay current.
            <br />
            Move with confidence.
          </h1>
          <p>
            Know what’s installed. Understand what’s changed.
            <br />
            Approve every update, with a clear record of the result.
          </p>
          <div className="login-features">
            <span>
              <CheckCircle2 size={17} /> Trusted package source
            </span>
            <span>
              <ShieldCheck size={17} /> Your approval, every time
            </span>
          </div>
        </div>
        <p className="login-footer">Built for Windows. Designed around you.</p>
      </div>
      <div className="login-form-wrap">
        <form
          className="login-form"
          onSubmit={handleSubmit(async (values) => {
            setError('');
            try {
              await post('/auth/login', values);
              onLogin();
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Sign-in failed');
            }
          })}
        >
          <span className="eyebrow">YOUR LOCAL WORKSPACE</span>
          <h2>Welcome to UpdatePilot</h2>
          <p>Sign in to manage your devices and software.</p>
          <label>
            Email address
            <input
              type="email"
              autoComplete="username"
              {...register('email')}
              aria-invalid={Boolean(errors.email)}
            />
          </label>
          {errors.email && <small className="error-text">{errors.email.message}</small>}
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              {...register('password')}
              aria-invalid={Boolean(errors.password)}
            />
          </label>
          {errors.password && <small className="error-text">{errors.password.message}</small>}
          {error && (
            <div role="alert" className="alert error">
              {error}
            </div>
          )}
          <button className="button primary wide" disabled={isSubmitting}>
            {isSubmitting ? <LoaderCircle size={16} className="spin" /> : null}Sign in
            <ArrowRight size={16} />
          </button>
          <div className="setup-hint">
            <Database size={18} />
            <span>
              First time here? Create your account from the project terminal with{' '}
              <code>npm run user:create</code>.
            </span>
          </div>
          <span className="privacy-note">
            <ShieldCheck size={14} /> Local workspace · No cloud account required
          </span>
        </form>
      </div>
    </main>
  );
}

export function Workspace({ section }: { section: string[] }) {
  const router = useRouter();
  const view = section[0] ?? '';
  const detailId = section[1];
  const [auth, setAuth] = useState<'loading' | 'in' | 'out'>('loading');
  const [email, setEmail] = useState('');
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [applications, setApplications] = useState<Application[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [eventType, setEventType] = useState('');
  const [sort, setSort] = useState('name:asc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [dark, setDark] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [jobDetail, setJobDetail] = useState<Job | null>(null);
  const [revoking, setRevoking] = useState<Device | null>(null);
  const [pairing, setPairing] = useState<{ code: string; until: string } | null>(null);
  const [retention, setRetention] = useState(90);
  const [savedRetention, setSavedRetention] = useState(90);
  const refreshEpoch = useRef(0);
  const currentDevice = devices.find((d) => d.id === deviceId);
  const title = nav.find((n) => n.id === view)?.title ?? 'Page not found';
  useEffect(() => {
    const enabled = localStorage.getItem('updatepilot-theme') === 'dark';
    setDark(enabled);
    document.documentElement.dataset.theme = enabled ? 'dark' : 'light';
  }, []);
  const toggleTheme = () => {
    const enabled = !dark;
    setDark(enabled);
    document.documentElement.dataset.theme = enabled ? 'dark' : 'light';
    localStorage.setItem('updatepilot-theme', enabled ? 'dark' : 'light');
  };
  const authenticate = useCallback(async () => {
    try {
      const r = await api<{ email: string; retentionDays: number }>('/auth/me');
      setEmail(r.data.email);
      setDeviceId(localStorage.getItem(`updatepilot-device:${r.data.email}`) ?? '');
      setRetention(r.data.retentionDays);
      setSavedRetention(r.data.retentionDays);
      setAuth('in');
      setError('');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setAuth('out');
      else {
        setError(e instanceof Error ? e.message : 'Connection failed');
        setAuth('loading');
      }
    }
  }, []);
  useEffect(() => {
    void authenticate();
  }, [authenticate]);
  useEffect(() => {
    setPage(1);
    setSearch('');
    setFilter('');
    setEventType('');
    setMobile(false);
    setDetail(null);
  }, [view, detailId, deviceId]);
  const refresh = useCallback(async () => {
    if (auth !== 'in') return;
    const epoch = ++refreshEpoch.current;
    try {
      const deviceQuery = deviceId ? `?deviceId=${deviceId}` : '';
      const [deviceResult, dashboardResult] = await Promise.allSettled([
        api<Device[]>('/devices'),
        api<Dashboard>(`/dashboard${deviceQuery}`),
      ]);
      if (epoch !== refreshEpoch.current) return;
      if (deviceResult.status === 'rejected') throw deviceResult.reason;
      const d = deviceResult.value;
      setDevices(d.data);
      if (deviceId && !d.data.some((device) => device.id === deviceId)) {
        localStorage.removeItem(`updatepilot-device:${email}`);
        setDeviceId('');
        setNotice('The saved device is no longer available. Showing all your devices.');
        return;
      }
      if (dashboardResult.status === 'rejected') throw dashboardResult.reason;
      setDashboard(dashboardResult.value.data);
      const [sortField, order] = sort.split(':');
      const query = new URLSearchParams({
        page: String(page),
        limit: '12',
        search,
        order: view === 'history' ? 'desc' : order,
        sort: sortField,
        ...(filter ? { status: filter } : {}),
        ...(deviceId ? { deviceId } : {}),
        ...(eventType ? { type: eventType } : {}),
      });
      if (detailId && view === 'applications') {
        const r = await api<Detail>(`/applications/${detailId}`);
        if (epoch !== refreshEpoch.current) return;
        setDetail(r.data);
      } else if (['applications', 'updates'].includes(view)) {
        const r = await api<Application[]>(`/${view}?${query}`);
        if (epoch !== refreshEpoch.current) return;
        setApplications(r.data);
        setTotal(r.pagination?.total ?? 0);
      } else if (view === 'history') {
        const r = await api<(Job | AuditEvent)[]>(`/history?${query}`);
        if (epoch !== refreshEpoch.current) return;
        if (eventType === 'AUDIT') setEvents(r.data as AuditEvent[]);
        else setJobs(r.data as Job[]);
        setTotal(r.pagination?.total ?? 0);
      }
      setError('');
    } catch (e) {
      if (epoch !== refreshEpoch.current) return;
      if (e instanceof ApiError && e.status === 401) setAuth('out');
      else setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      if (epoch === refreshEpoch.current) setLoading(false);
    }
  }, [auth, deviceId, detailId, email, eventType, filter, page, search, sort, view]);
  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(() => {
      void refresh();
    }, 200);
    const interval = setInterval(() => {
      void refresh();
    }, 10000);
    return () => {
      refreshEpoch.current++;
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [refresh]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 7000);
    return () => clearTimeout(t);
  }, [notice]);
  const action = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };
  const scan = () =>
    action(async () => {
      if (!currentDevice) throw new Error('Select a device in the top bar before scanning.');
      await post(`/devices/${currentDevice.id}/scans`);
      setNotice('Scan queued. Inventory will refresh when the agent reports its results.');
    });
  const review = (id: string) =>
    action(async () => {
      const r = await post<Preview>(`/updates/${id}/preview`);
      setPreview(r.data);
    });
  const chart = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - 6 + i);
        const key = d.toLocaleDateString();
        const activity =
          dashboard?.activity.filter((a) => new Date(a.createdAt).toLocaleDateString() === key) ??
          [];
        return {
          day: d.toLocaleDateString(undefined, { weekday: 'short' }),
          scans: activity.filter((a) => a.kind === 'SCAN').length,
          updates: activity.filter((a) => a.kind === 'UPDATE').length,
        };
      }),
    [dashboard],
  );
  const exportHref = (kind: string) =>
    `/api/v1/exports/${kind}${deviceId ? `?deviceId=${deviceId}` : ''}`;
  const historyTable = (rows: Job[]) => (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Activity</th>
            <th>Device</th>
            <th>Started</th>
            <th>Outcome</th>
            <th>
              <span className="sr-only">Details</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((job) => (
            <tr key={job.id}>
              <td>
                <div className="table-name">
                  <span className={`activity-icon ${job.kind === 'SCAN' ? 'blue' : 'green'}`}>
                    {job.kind === 'SCAN' ? <Search size={17} /> : <Download size={17} />}
                  </span>
                  <div>
                    <strong>
                      {job.kind === 'SCAN'
                        ? 'Software inventory scan'
                        : (job.application?.name ?? job.packageId)}
                    </strong>
                    <small>
                      {job.kind === 'SCAN'
                        ? job.detectedCount !== null
                          ? `${job.detectedCount} applications detected`
                          : 'Discover installed software'
                        : `${job.previousVersion} → ${job.targetVersion}`}
                    </small>
                  </div>
                </div>
              </td>
              <td>{job.device.name}</td>
              <td className="nowrap">{date(job.createdAt)}</td>
              <td>
                <Status value={job.status} />
              </td>
              <td>
                <button className="text-button" onClick={() => setJobDetail(job)}>
                  Details
                  <ChevronRight size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  if (auth === 'out')
    return (
      <Login
        onLogin={() => {
          setAuth('loading');
          setDashboard(null);
          setDevices([]);
          setApplications([]);
          setJobs([]);
          setEvents([]);
          setDetail(null);
          setPairing(null);
          setDeviceId('');
          setPreview(null);
          setJobDetail(null);
          setRevoking(null);
          setNotice('');
          void authenticate();
        }}
      />
    );
  if (auth === 'loading')
    return (
      <main className="boot">
        <Orbit size={36} className="spin-slow" />
        <h1>UpdatePilot</h1>
        {error ? (
          <>
            <div role="alert" className="alert error">
              {error}
            </div>
            <button
              className="button"
              onClick={() => {
                void authenticate();
              }}
            >
              Retry connection
            </button>
          </>
        ) : (
          <p>Connecting to your workspace…</p>
        )}
      </main>
    );
  return (
    <div className="workspace">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <aside className={`sidebar ${mobile ? 'open' : ''}`}>
        <Link href="/" className="brand">
          <Orbit size={29} />
          UpdatePilot
        </Link>
        <span className="workspace-label">PERSONAL WORKSPACE</span>
        <nav aria-label="Main navigation">
          {nav.map((n) => (
            <Link
              key={n.id}
              href={`/${n.id}`}
              className={view === n.id ? 'nav-link selected' : 'nav-link'}
              aria-current={view === n.id ? 'page' : undefined}
            >
              <n.icon size={19} />
              {n.title}
              {n.id === 'updates' && Boolean(dashboard?.updates) && (
                <span className="nav-count">{dashboard?.updates}</span>
              )}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-card">
            <span className="local-symbol">
              <ShieldCheck size={21} />
            </span>
            <strong>Your device. Your control.</strong>
            <p>Every update starts with your approval.</p>
            <Link href="/settings">
              Agent & connection
              <ArrowUpRight size={15} />
            </Link>
          </div>
          <div className="sidebar-foot">
            <span className="status-dot" />
            Local-first platform<span>v0.1</span>
          </div>
        </div>
      </aside>
      {mobile && (
        <button
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button mobile-menu"
              aria-label="Toggle navigation"
              onClick={() => setMobile(!mobile)}
            >
              <Menu size={21} />
            </button>
            <span className="breadcrumb">
              Workspace<span>/</span>
              <strong>{title}</strong>
            </span>
          </div>
          <div className="topbar-right">
            <label className="device-select">
              <Monitor size={16} />
              <span className="sr-only">Current device</span>
              <select
                value={deviceId}
                onChange={(e) => {
                  setDeviceId(e.target.value);
                  localStorage.setItem(`updatepilot-device:${email}`, e.target.value);
                }}
              >
                <option value="">All devices</option>
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                    {d.connection !== 'ONLINE' ? ` · ${label(d.connection)}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="icon-button"
              aria-label={dark ? 'Use light theme' : 'Use dark theme'}
              onClick={toggleTheme}
            >
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <Link className="icon-button" aria-label="View operation notifications" href="/history">
              <Bell size={18} />
              {dashboard?.recentJobs.some((j) =>
                ['FAILED', 'VERIFICATION_FAILED', 'INTERRUPTED'].includes(j.status),
              ) && <span className="notification-dot" />}
            </Link>
            <details className="account">
              <summary aria-label="Account menu">{email[0]?.toUpperCase()}</summary>
              <div>
                <strong>{email}</strong>
                <button
                  onClick={() => {
                    void action(async () => {
                      await post('/auth/logout');
                      setDashboard(null);
                      setDevices([]);
                      setApplications([]);
                      setJobs([]);
                      setEvents([]);
                      setDetail(null);
                      setPairing(null);
                      setPreview(null);
                      setJobDetail(null);
                      setRevoking(null);
                      setAuth('out');
                    });
                  }}
                >
                  <LogOut size={16} />
                  Sign out
                </button>
              </div>
            </details>
          </div>
        </header>
        <main id="main" className="main-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {view === '' ? 'A CLEARER VIEW OF YOUR SOFTWARE' : 'YOUR SOFTWARE WORKSPACE'}
              </div>
              <h1>{detailId && detail ? detail.name : title}</h1>
              <p>
                {(
                  {
                    '': 'Everything you need to keep your software moving forward.',
                    applications: 'Your installed software, with the details that matter.',
                    updates: 'Review what’s new. You decide what happens next.',
                    security:
                      'Security information with transparent coverage and trusted evidence.',
                    history: 'A clear record of scans, approvals, and update outcomes.',
                    settings: 'Connect your Windows agent and make this workspace yours.',
                  } as Record<string, string>
                )[view] ?? 'This page could not be found.'}
              </p>
            </div>
            <div className="heading-actions">
              {['', 'applications', 'updates'].includes(view) && (
                <>
                  <button
                    className="button"
                    disabled={busy || loading}
                    onClick={() => {
                      void refresh();
                    }}
                  >
                    <RefreshCw size={16} />
                    Refresh
                  </button>
                  <button
                    className="button primary"
                    disabled={
                      busy ||
                      !currentDevice ||
                      currentDevice.connection !== 'ONLINE' ||
                      currentDevice.health !== 'READY'
                    }
                    onClick={() => {
                      void scan();
                    }}
                  >
                    <Search size={17} />
                    Scan device
                  </button>
                </>
              )}
            </div>
          </div>
          {error && (
            <div role="alert" className="alert error">
              <CircleHelp size={18} />
              <span>{error}</span>
              <button
                className="text-button"
                onClick={() => {
                  void refresh();
                }}
              >
                Retry
              </button>
            </div>
          )}
          {notice && (
            <div role="status" className="toast">
              <CheckCircle2 size={19} />
              {notice}
              <button
                className="icon-button"
                aria-label="Dismiss notification"
                onClick={() => setNotice('')}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {currentDevice && (
            <div className="device-banner">
              <Laptop size={17} />
              <strong>{currentDevice.name}</strong>
              <Status value={currentDevice.connection} />
              <span>Last seen {date(currentDevice.lastSeen)}</span>
              {currentDevice.health !== 'READY' && (
                <Link href="/settings">
                  Check agent health
                  <ArrowRight size={14} />
                </Link>
              )}
            </div>
          )}
          {!deviceId && devices.length > 0 && ['', 'applications', 'updates'].includes(view) && (
            <p className="device-hint">
              <Monitor size={15} />
              Showing all devices. Select a device above to run a scan.
            </p>
          )}
          {loading && !dashboard ? (
            <div
              className="skeleton-grid"
              role="status"
              aria-label="Loading workspace"
              aria-busy="true"
            >
              {[0, 1, 2, 3].map((i) => (
                <div className="skeleton" key={i} />
              ))}
            </div>
          ) : null}
          {view === '' && dashboard && (
            <>
              <div className="stats-grid">
                {[
                  {
                    title: 'Installed applications',
                    value: dashboard.total,
                    icon: Package,
                    caption: 'Observed in your inventory',
                    color: 'blue',
                  },
                  {
                    title: 'Up to date',
                    value: dashboard.upToDate,
                    icon: CheckCircle2,
                    caption: 'Confirmed by package source',
                    color: 'green',
                  },
                  {
                    title: 'Available updates',
                    value: dashboard.updates,
                    icon: Download,
                    caption: 'Ready for your review',
                    color: 'amber',
                  },
                  {
                    title: 'Unverified or unsupported',
                    value: dashboard.unknown,
                    icon: ShieldQuestion,
                    caption: 'Update status is not confirmed',
                    color: 'purple',
                  },
                ].map((s) => (
                  <section className="stat-card" key={s.title}>
                    <div>
                      <span>{s.title}</span>
                      <span className={`stat-icon ${s.color}`}>
                        <s.icon size={19} />
                      </span>
                    </div>
                    <strong>{s.value}</strong>
                    <small>{s.caption}</small>
                  </section>
                ))}
              </div>
              {!devices.some((d) => !d.revokedAt) && (
                <section className="onboarding">
                  <div className="onboarding-orbit">
                    <Orbit size={45} />
                  </div>
                  <div>
                    <span className="eyebrow">LET’S GET CONNECTED</span>
                    <h2>Your software story starts here.</h2>
                    <p>
                      Pair the Windows agent, run your first scan, and see your real software
                      inventory.
                    </p>
                    <Link className="button primary" href="/settings">
                      Connect a Windows device
                      <ArrowRight size={16} />
                    </Link>
                  </div>
                  <ol>
                    <li>
                      <span>01</span>Prepare the agent
                    </li>
                    <li>
                      <span>02</span>Approve secure pairing
                    </li>
                    <li>
                      <span>03</span>Run your first scan
                    </li>
                  </ol>
                </section>
              )}
              <div className="overview-middle">
                <section className="panel chart-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Workspace activity</h2>
                      <p>Scan and update attempts over the last 7 days</p>
                    </div>
                    <span className="subtle-chip">
                      <Clock3 size={14} />
                      Past week
                    </span>
                  </div>
                  <div className="chart-legend">
                    <span>
                      <i className="legend-dot scans" />
                      Scans
                    </span>
                    <span>
                      <i className="legend-dot updates" />
                      Updates
                    </span>
                  </div>
                  <div className="chart">
                    <ResponsiveContainer width="100%" height={215}>
                      <BarChart
                        data={chart}
                        barSize={14}
                        margin={{ top: 12, right: 10, left: -27, bottom: 0 }}
                      >
                        <CartesianGrid
                          strokeDasharray="3 5"
                          vertical={false}
                          stroke="var(--border)"
                        />
                        <XAxis
                          dataKey="day"
                          axisLine={false}
                          tickLine={false}
                          tick={{ fill: 'var(--muted)', fontSize: 12 }}
                          dy={8}
                        />
                        <YAxis
                          allowDecimals={false}
                          axisLine={false}
                          tickLine={false}
                          tick={{ fill: 'var(--muted)', fontSize: 11 }}
                        />
                        <Tooltip
                          contentStyle={{
                            background: 'var(--panel)',
                            borderColor: 'var(--border)',
                            borderRadius: 10,
                            color: 'var(--text)',
                          }}
                          cursor={{ fill: 'var(--surface)' }}
                        />
                        <Bar
                          name="Scans"
                          dataKey="scans"
                          fill="#0d9488"
                          radius={[4, 4, 0, 0]}
                          isAnimationActive={false}
                        />
                        <Bar
                          name="Updates"
                          dataKey="updates"
                          fill="#a7dcd3"
                          radius={[4, 4, 0, 0]}
                          isAnimationActive={false}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="chart-footer">
                    <Activity size={15} />
                    Activity reflects recorded jobs, including unsuccessful attempts.
                  </div>
                </section>
                <section className="panel device-panel">
                  <div className="panel-heading">
                    <h2>Device connection</h2>
                    <Wifi size={19} />
                  </div>
                  <div className="device-illustration">
                    <Monitor size={51} strokeWidth={1.2} />
                    <span
                      className={`connection-light ${currentDevice?.connection === 'ONLINE' ? 'connected' : ''}`}
                    />
                  </div>
                  <h3>
                    {currentDevice?.name ??
                      (devices.length ? 'Your connected workspace' : 'No device paired')}
                  </h3>
                  <p>
                    {currentDevice
                      ? currentDevice.os
                      : `${devices.filter((d) => d.connection === 'ONLINE').length} of ${devices.filter((d) => !d.revokedAt).length} paired devices online`}
                  </p>
                  <div className="device-facts">
                    <div>
                      <span>Agent status</span>
                      {currentDevice ? (
                        <Status value={currentDevice.connection} />
                      ) : (
                        <span>Select a device</span>
                      )}
                    </div>
                    <div>
                      <span>Last inventory scan</span>
                      <strong>{date(dashboard.lastScan)}</strong>
                    </div>
                  </div>
                  <Link href="/settings" className="button wide">
                    Manage your agent
                    <ArrowUpRight size={15} />
                  </Link>
                </section>
              </div>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Recent activity</h2>
                    <p>What’s been happening in your workspace</p>
                  </div>
                  <Link href="/history" className="text-button">
                    View all activity
                    <ArrowRight size={15} />
                  </Link>
                </div>
                {dashboard.recentJobs.length ? (
                  historyTable(dashboard.recentJobs)
                ) : (
                  <Empty title="A fresh start" icon={Activity}>
                    Your scans and updates will appear here once your agent gets to work.
                  </Empty>
                )}
              </section>
              <div className="trust-footer">
                <ShieldCheck size={16} />
                Updates require your approval. Results require verification.
                <span>Local-first. Always in your control.</span>
              </div>
            </>
          )}
          {['applications', 'updates'].includes(view) && !detailId && (
            <>
              {view === 'updates' && (
                <div className="info-strip">
                  <ShieldCheck size={21} />
                  <div>
                    <strong>One update. One informed decision.</strong>
                    <p>
                      Review the exact package, version and source before approving. Installation
                      outcomes are verified by a fresh package check.
                    </p>
                  </div>
                </div>
              )}
              <section className="panel">
                <div className="table-toolbar">
                  <div className="search-field">
                    <Search size={17} />
                    <input
                      aria-label="Search applications"
                      placeholder="Search applications or publishers…"
                      value={search}
                      onChange={(e) => {
                        setSearch(e.target.value);
                        setPage(1);
                      }}
                    />
                  </div>
                  <div className="toolbar-actions">
                    {view === 'applications' && (
                      <select
                        aria-label="Filter update status"
                        value={filter}
                        onChange={(e) => {
                          setFilter(e.target.value);
                          setPage(1);
                        }}
                      >
                        <option value="">All statuses</option>
                        {[
                          'UPDATE_AVAILABLE',
                          'UP_TO_DATE',
                          'UNKNOWN_VERSION',
                          'UNMATCHED',
                          'UNSUPPORTED',
                          'METADATA_UNAVAILABLE',
                        ].map((s) => (
                          <option key={s} value={s}>
                            {label(s)}
                          </option>
                        ))}
                      </select>
                    )}
                    <select
                      aria-label="Sort applications"
                      value={sort}
                      onChange={(e) => setSort(e.target.value)}
                    >
                      <option value="name:asc">Name A–Z</option>
                      <option value="name:desc">Name Z–A</option>
                      <option value="publisher:asc">Publisher</option>
                      <option value="lastObserved:desc">Recently checked</option>
                    </select>
                    <a className="button compact" href={exportHref('inventory')}>
                      <ArrowDownToLine size={16} />
                      CSV
                    </a>
                  </div>
                </div>
                {loading ? (
                  <div className="table-loading">
                    <LoaderCircle className="spin" size={18} />
                    Refreshing inventory…
                  </div>
                ) : null}
                {applications.length ? (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Application</th>
                          <th>Installed version</th>
                          <th>Available version</th>
                          <th>Status</th>
                          <th>Source</th>
                          <th>
                            <span className="sr-only">Actions</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {applications.map((a) => (
                          <tr key={a.id}>
                            <td>
                              <Link className="table-name" href={`/applications/${a.id}`}>
                                <AppIcon name={a.name} />
                                <div>
                                  <strong>{a.name}</strong>
                                  <small>{a.publisher ?? 'Publisher metadata unavailable'}</small>
                                </div>
                              </Link>
                            </td>
                            <td>
                              <code>{a.installedVersion || 'Unknown'}</code>
                            </td>
                            <td>
                              <code>{a.availableVersion ?? 'Unverified'}</code>
                            </td>
                            <td>
                              <Status value={a.status} />
                            </td>
                            <td className="source-cell">
                              {a.source === 'winget' ? (
                                <>
                                  <Package size={13} />
                                  WinGet
                                </>
                              ) : (
                                (a.source ?? 'Unmatched')
                              )}
                            </td>
                            <td>
                              {a.status === 'UPDATE_AVAILABLE' ? (
                                <button
                                  className="button compact"
                                  disabled={busy}
                                  onClick={() => {
                                    void review(a.id);
                                  }}
                                >
                                  Review
                                  <ArrowUpRight size={14} />
                                </button>
                              ) : (
                                <Link className="text-button" href={`/applications/${a.id}`}>
                                  Details
                                  <ChevronRight size={15} />
                                </Link>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty
                    title={
                      search || filter
                        ? 'No matching applications'
                        : view === 'updates'
                          ? 'No verified updates to review'
                          : 'Your inventory is ready for its first scan'
                    }
                  >
                    {search || filter ? (
                      'Try a different search or status filter.'
                    ) : view === 'updates' ? (
                      'Run a fresh scan to check supported packages. Missing update information does not mean every application is up to date.'
                    ) : (
                      <>
                        <p>
                          Connect your Windows agent and scan a device to see real installed
                          applications here.
                        </p>
                        <Link className="button" href="/settings">
                          Set up your agent
                          <ArrowRight size={15} />
                        </Link>
                      </>
                    )}
                  </Empty>
                )}
                <div className="pagination">
                  <span>
                    {total} {view === 'updates' ? 'available updates' : 'applications'}
                    {total > 0 ? ` · Page ${page} of ${Math.ceil(total / 12)}` : ''}
                  </span>
                  <div>
                    <button
                      className="icon-button"
                      aria-label="Previous page"
                      disabled={page <= 1}
                      onClick={() => setPage(page - 1)}
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label="Next page"
                      disabled={page * 12 >= total}
                      onClick={() => setPage(page + 1)}
                    >
                      <ChevronRight size={18} />
                    </button>
                  </div>
                </div>
              </section>
              <p className="footnote">
                <CircleHelp size={14} />
                Unknown and unmatched applications are never counted as up to date. Information
                refreshes every 10 seconds.
              </p>
            </>
          )}
          {view === 'applications' &&
            detailId &&
            (detail ? (
              <>
                <Link href="/applications" className="text-button back-link">
                  <ChevronLeft size={16} />
                  Back to applications
                </Link>
                <div className="detail-grid">
                  <section className="panel padded">
                    <div className="detail-identity">
                      <AppIcon name={detail.name} />
                      <div>
                        <h2>{detail.name}</h2>
                        <p>
                          {detail.publisher ??
                            detail.metadata?.publisher ??
                            'Publisher metadata unavailable'}
                        </p>
                      </div>
                    </div>
                    <dl className="details-list">
                      {[
                        ['Package identity', detail.packageId ?? 'Unmatched'],
                        ['Installed version', detail.installedVersion || 'Unknown'],
                        ['Available version', detail.availableVersion ?? 'Unverified'],
                        ['Package source', detail.source ?? 'Unavailable'],
                        ['Last observed', date(detail.lastObserved)],
                      ].map(([k, v]) => (
                        <div key={k}>
                          <dt>{k}</dt>
                          <dd>{v}</dd>
                        </div>
                      ))}
                    </dl>
                    <Status value={detail.status} />
                    {detail.status === 'UPDATE_AVAILABLE' && (
                      <button
                        className="button primary detail-review"
                        disabled={busy}
                        onClick={() => {
                          void review(detail.id);
                        }}
                      >
                        Review update
                        <ArrowRight size={16} />
                      </button>
                    )}
                  </section>
                  <section className="panel padded">
                    <h2>Release information</h2>
                    {detail.metadata ? (
                      <>
                        <p className="release-notes">
                          {detail.metadata.releaseNotes ??
                            'Release notes are not provided in the source manifest.'}
                        </p>
                        <div className="release-links">
                          {detail.metadata.officialUrl && (
                            <a
                              className="text-button"
                              href={detail.metadata.officialUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              Publisher website
                              <ArrowUpRight size={15} />
                            </a>
                          )}
                          {detail.metadata.changelogUrl && (
                            <a
                              className="text-button"
                              href={detail.metadata.changelogUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              Release notes
                              <ArrowUpRight size={15} />
                            </a>
                          )}
                        </div>
                        <p className="footnote">
                          Source: Microsoft WinGet community manifest. Retrieved{' '}
                          {date(detail.metadata.fetchedAt)}. Links are provided by that manifest.
                        </p>
                      </>
                    ) : (
                      <Empty title="Release metadata unavailable" icon={CircleHelp}>
                        This package has no retrievable manifest for the reported version. Update
                        eligibility is determined independently by WinGet.
                      </Empty>
                    )}
                  </section>
                </div>
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Update history</h2>
                  </div>
                  {detail.jobs.length ? (
                    historyTable(detail.jobs)
                  ) : (
                    <Empty title="No update attempts yet" icon={History}>
                      An approved update attempt will appear here.
                    </Empty>
                  )}
                </section>
              </>
            ) : (
              <div className="panel padded">
                {loading ? 'Loading application…' : 'Application details could not be loaded.'}
              </div>
            ))}
          {view === 'history' && (
            <section className="panel">
              <div className="table-toolbar">
                <div className="search-field">
                  <Search size={17} />
                  <input
                    aria-label="Search history"
                    placeholder={
                      eventType === 'AUDIT'
                        ? 'Search audit event type…'
                        : 'Search applications or devices…'
                    }
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(1);
                    }}
                  />
                </div>
                <div className="toolbar-actions">
                  <select
                    aria-label="Filter event type"
                    value={eventType}
                    onChange={(e) => {
                      setEventType(e.target.value);
                      setFilter('');
                      setPage(1);
                    }}
                  >
                    <option value="">All operations</option>
                    <option value="SCAN">Scans</option>
                    <option value="UPDATE">Updates</option>
                    <option value="AUDIT">Audit events</option>
                  </select>
                  {eventType !== 'AUDIT' && (
                    <select
                      aria-label="Filter history status"
                      value={filter}
                      onChange={(e) => {
                        setFilter(e.target.value);
                        setPage(1);
                      }}
                    >
                      <option value="">All outcomes</option>
                      {[
                        'QUEUED',
                        'RUNNING',
                        'VERIFYING',
                        'COMPLETED',
                        'FAILED',
                        'CANCELLED',
                        'INTERRUPTED',
                        'RESTART_REQUIRED',
                        'VERIFICATION_FAILED',
                      ].map((s) => (
                        <option key={s} value={s}>
                          {label(s)}
                        </option>
                      ))}
                    </select>
                  )}
                  <a className="button compact" href={exportHref('history')}>
                    <ArrowDownToLine size={16} />
                    Export CSV
                  </a>
                </div>
              </div>
              {eventType === 'AUDIT' ? (
                events.length ? (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Event</th>
                          <th>Recorded</th>
                          <th>Target</th>
                        </tr>
                      </thead>
                      <tbody>
                        {events.map((e) => (
                          <tr key={e.id}>
                            <td>
                              <strong>{label(e.type)}</strong>
                            </td>
                            <td>{date(e.createdAt)}</td>
                            <td>
                              <code>{e.target ?? 'Workspace'}</code>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty title="No matching audit events" icon={History}>
                    Pairing, approvals, exports and account events are recorded here.
                  </Empty>
                )
              ) : jobs.length ? (
                historyTable(jobs)
              ) : (
                <Empty title="No matching operations" icon={History}>
                  Scans and update attempts are recorded with their actual outcomes.
                </Empty>
              )}
              <div className="pagination">
                <span>{total} records · Newest first</span>
                <div>
                  <button
                    className="icon-button"
                    aria-label="Previous page"
                    disabled={page <= 1}
                    onClick={() => setPage(page - 1)}
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Next page"
                    disabled={page * 12 >= total}
                    onClick={() => setPage(page + 1)}
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              </div>
            </section>
          )}
          {view === 'security' && (
            <>
              <section className="security-hero panel">
                <span className="empty-icon">
                  <ShieldQuestion size={32} />
                </span>
                <span className="subtle-chip">Coverage unavailable</span>
                <h2>Good security starts with honest information.</h2>
                <p>
                  UpdatePilot does not yet have a reliable mapping between WinGet identities and
                  vulnerability databases. Verified vulnerability findings are unavailable for this
                  MVP.
                </p>
                <div className="security-note">
                  <CircleHelp size={19} />
                  No findings does not establish that your applications are secure.
                </div>
                <Link href="/updates" className="button primary">
                  Review available updates
                  <ArrowRight size={16} />
                </Link>
              </section>
              <div className="security-cards">
                <section className="panel padded">
                  <ShieldCheck size={24} />
                  <h3>Trusted update source</h3>
                  <p>
                    Supported updates use the official WinGet community source. Installer hash and
                    signature checks remain enabled.
                  </p>
                </section>
                <section className="panel padded">
                  <CheckCircle2 size={24} />
                  <h3>Verified outcomes</h3>
                  <p>
                    An installer exit code alone is not success. The installed version must match
                    the exact approved target.
                  </p>
                </section>
                <section className="panel padded">
                  <Unplug size={24} />
                  <h3>Controlled access</h3>
                  <p>
                    Your agent uses a protected credential. Revoke it from Settings to prevent
                    future device operations.
                  </p>
                </section>
              </div>
            </>
          )}
          {view === 'settings' && (
            <>
              <div className="settings-grid">
                <section className="panel padded">
                  <div className="section-icon">
                    <Laptop size={21} />
                  </div>
                  <h2>Connect your Windows agent</h2>
                  <p>
                    Pair a device from its Windows user account. The one-use pairing code expires
                    after five minutes.
                  </p>
                  <ol className="setup-steps">
                    <li>
                      <strong>Prepare the package client</strong>
                      <code>npm run agent:setup</code>
                      <span>Downloads Microsoft’s signed module into this project.</span>
                    </li>
                    <li>
                      <strong>Approve pairing in this workspace</strong>
                      <button
                        className="button primary"
                        disabled={busy}
                        onClick={() => {
                          void action(async () => {
                            const r = await post<{ code: string; expiresInSeconds: number }>(
                              '/devices/pair',
                            );
                            setPairing({
                              code: r.data.code,
                              until: new Date(
                                Date.now() + r.data.expiresInSeconds * 1000,
                              ).toISOString(),
                            });
                          });
                        }}
                      >
                        <Plus size={16} />
                        Generate pairing code
                      </button>
                    </li>
                    <li>
                      <strong>Start the agent in your project terminal</strong>
                      <code>npm run agent</code>
                      <span>
                        Paste your pairing code when prompted. Keep this terminal running.
                      </span>
                    </li>
                  </ol>
                  {pairing && (
                    <div className="pairing-code" role="status">
                      <strong>One-use pairing code</strong>
                      <code>{pairing.code}</code>
                      <small>
                        Expires {date(pairing.until)}. Enter only in your local agent terminal.
                      </small>
                    </div>
                  )}
                  <div className="setup-hint">
                    <CircleHelp size={18} />
                    <span>
                      Then choose this device in the top bar and click <strong>Scan device</strong>.
                      Run the agent as your normal Windows user.
                    </span>
                  </div>
                </section>
                <div className="settings-stack">
                  <section className="panel padded">
                    <div className="section-icon">
                      <Settings2 size={20} />
                    </div>
                    <h2>Workspace preferences</h2>
                    <div className="preference">
                      <div>
                        <strong>Appearance</strong>
                        <p>{dark ? 'Dark' : 'Light'} theme, stored in this browser</p>
                      </div>
                      <button className="button compact" onClick={toggleTheme}>
                        {dark ? <Sun size={16} /> : <Moon size={16} />}Switch theme
                      </button>
                    </div>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void action(async () => {
                          await api('/settings', {
                            method: 'PATCH',
                            body: JSON.stringify({ retentionDays: retention }),
                          });
                          setSavedRetention(retention);
                          setNotice('History retention updated. Cleanup runs daily.');
                        });
                      }}
                    >
                      <div className="retention-label">
                        <label htmlFor="history-retention">History retention</label>
                        <select
                          id="history-retention"
                          value={retention}
                          onChange={(e) => setRetention(Number(e.target.value))}
                        >
                          {[30, 60, 90, 180, 365].map((v) => (
                            <option key={v} value={v}>
                              {v} days
                            </option>
                          ))}
                        </select>
                      </div>
                      <p className="footnote">
                        Completed jobs, snapshots and audit events older than this period are
                        removed by daily maintenance.
                      </p>
                      <button
                        className="button compact"
                        disabled={busy || retention === savedRetention}
                      >
                        <Check size={15} />
                        Save preference
                      </button>
                    </form>
                    <div className="locked-preference">
                      <ShieldCheck size={18} />
                      <div>
                        <strong>Explicit approval is always required</strong>
                        <p>
                          Automatic scans, bulk updates, optional approval and desktop notifications
                          are not implemented.
                        </p>
                      </div>
                    </div>
                  </section>
                  <section className="panel padded troubleshooting">
                    <h2>Need a connection check?</h2>
                    <p>
                      Check that PostgreSQL, the API and agent are running. Your agent connects only
                      to <code>127.0.0.1:4310</code>. A stale heartbeat appears offline after 60
                      seconds.
                    </p>
                    <a
                      className="text-button"
                      href="/api/health"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Check backend health
                      <ArrowUpRight size={15} />
                    </a>
                  </section>
                </div>
              </div>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Paired devices</h2>
                    <p>Credentials expire after 90 days. Pair again to renew access.</p>
                  </div>
                  <span className="subtle-chip">{devices.length} devices</span>
                </div>
                {devices.length ? (
                  <div className="device-list">
                    {devices.map((d) => (
                      <div className="device-row" key={d.id}>
                        <Monitor size={27} />
                        <div>
                          <strong>{d.name}</strong>
                          <p>
                            {d.os} · Agent {d.agentVersion} · WinGet {d.wingetVersion ?? 'unknown'}
                          </p>
                          <small>
                            Last seen {date(d.lastSeen)} · Health: {label(d.health)}
                          </small>
                        </div>
                        <Status value={d.connection} />
                        {!d.revokedAt && (
                          <button className="button danger compact" onClick={() => setRevoking(d)}>
                            <Unplug size={15} />
                            Disconnect
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty title="No devices paired" icon={Monitor}>
                    Prepare the agent and generate a pairing code to connect your first Windows
                    device.
                  </Empty>
                )}
              </section>
            </>
          )}
          {!nav.some((n) => n.id === view) && (
            <Empty title="Page not found" icon={CircleHelp}>
              <Link className="button" href="/">
                Return to overview
              </Link>
            </Empty>
          )}
        </main>
      </div>
      {preview && (
        <Modal
          title="Review software update"
          description="Confirm the exact package and version before the agent starts installation."
          onClose={() => {
            if (!busy) setPreview(null);
          }}
        >
          <div className="approval-app">
            <AppIcon name={preview.application.name} />
            <div>
              <strong>{preview.application.name}</strong>
              <span>{preview.application.packageId}</span>
            </div>
          </div>
          <div className="version-change">
            <div>
              <small>INSTALLED</small>
              <code>{preview.application.installedVersion}</code>
            </div>
            <ArrowRight size={20} />
            <div>
              <small>APPROVED TARGET</small>
              <code>{preview.application.availableVersion}</code>
            </div>
          </div>
          <dl className="details-list">
            <div>
              <dt>Trusted source</dt>
              <dd>Microsoft WinGet community source</dd>
            </div>
            <div>
              <dt>Publisher</dt>
              <dd>{preview.application.publisher ?? 'Metadata unavailable'}</dd>
            </div>
          </dl>
          <div className="alert warning">
            <CircleHelp size={20} />
            <span>{preview.permissions}</span>
          </div>
          <p className="footnote">
            This approval expires in 5 minutes and authorizes this exact update once. Installation
            runs only through your paired agent.
          </p>
          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}
          <div className="dialog-actions">
            <button className="button" disabled={busy} onClick={() => setPreview(null)}>
              Cancel
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={() => {
                void action(async () => {
                  await post(`/updates/${preview.application.id}/execute`, {
                    confirmationToken: preview.confirmationToken,
                    confirm: true,
                  });
                  setPreview(null);
                  setNotice('Update approved and queued. Follow its verified outcome in History.');
                  router.push('/history');
                });
              }}
            >
              {busy ? <LoaderCircle size={16} className="spin" /> : <ShieldCheck size={16} />}
              Approve & update
            </button>
          </div>
        </Modal>
      )}
      {jobDetail && (
        <Modal
          title={jobDetail.kind === 'SCAN' ? 'Scan details' : 'Update details'}
          description="Recorded operation status, versions and verification result."
          onClose={() => setJobDetail(null)}
        >
          <Status value={jobDetail.status} />
          <dl className="details-list">
            {[
              ['Operation ID', jobDetail.id],
              ['Package', jobDetail.packageId ?? 'Inventory scan'],
              ['Device', jobDetail.device.name],
              ['Initiated by', jobDetail.initiator.email],
              ['Created', date(jobDetail.createdAt)],
              ['Started', date(jobDetail.startedAt)],
              ['Ended', date(jobDetail.endedAt)],
              [
                'Duration',
                jobDetail.startedAt && jobDetail.endedAt
                  ? `${Math.round((new Date(jobDetail.endedAt).getTime() - new Date(jobDetail.startedAt).getTime()) / 1000)} seconds`
                  : 'Pending or in progress',
              ],
              ['Previous version', jobDetail.previousVersion ?? '—'],
              ['Target version', jobDetail.targetVersion ?? '—'],
              ['Observed version', jobDetail.resultingVersion ?? '—'],
              [
                'Exit code',
                jobDetail.exitCode === null ? 'Not recorded' : String(jobDetail.exitCode),
              ],
              [
                'Version verified',
                jobDetail.kind === 'SCAN' ? 'Not applicable' : jobDetail.verified ? 'Yes' : 'No',
              ],
            ].map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          {jobDetail.error && (
            <div className="alert error" role="alert">
              {jobDetail.error}
            </div>
          )}
          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}
          {activeStatuses.includes(jobDetail.status) && (
            <div className="dialog-actions">
              <button
                className="button"
                disabled={busy}
                onClick={() => {
                  void action(async () => {
                    const r = await api<Job>(`/jobs/${jobDetail.id}`);
                    setJobDetail(r.data);
                  });
                }}
              >
                Refresh status
              </button>
              {jobDetail.status === 'QUEUED' && (
                <button
                  className="button danger"
                  disabled={busy}
                  onClick={() => {
                    void action(async () => {
                      await post(`/jobs/${jobDetail.id}/cancel`);
                      setJobDetail(null);
                      setNotice('Queued operation cancelled.');
                    });
                  }}
                >
                  Cancel queued job
                </button>
              )}
            </div>
          )}
        </Modal>
      )}
      {revoking && (
        <Modal
          title="Disconnect this device?"
          description="This revokes the agent credential and cancels queued jobs. Reconnecting requires a new pairing code."
          onClose={() => setRevoking(null)}
        >
          <p>
            <strong>{revoking.name}</strong>
          </p>
          <p>
            Active installers must finish before disconnection. Historical records remain available.
          </p>
          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}
          <div className="dialog-actions">
            <button className="button" onClick={() => setRevoking(null)}>
              Keep connected
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={() => {
                void action(async () => {
                  await post(`/devices/${revoking.id}/revoke`, { confirm: true });
                  setRevoking(null);
                  setNotice('Device disconnected and credential revoked.');
                });
              }}
            >
              Disconnect device
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
