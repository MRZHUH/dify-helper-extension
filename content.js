(async () => {
  const API_PREFIX = `${location.origin}/console/api`;
  const STORAGE_KEY = 'dify-helper-ui-state';
  const PANEL_ID = 'dify-helper-root';

  if (document.getElementById(PANEL_ID)) return;

  // ---------- Dify detection ----------
  // Probe a stable, cheap console endpoint. Dify console returns 200 when
  // authed or 401/403 when anonymous — both mean "this is a Dify console".
  // Non-Dify subdomains (marketplace, docs, etc.) or fully-off sites return
  // 404 / network error, which we treat as "not a Dify console" and bail out.
  const probeIsDify = async () => {
    try {
      const res = await fetch(`${API_PREFIX}/setup`, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
      });
      if (res.status === 200 || res.status === 401 || res.status === 403) return true;
      if (res.status === 404) return false;
      // Any other status (5xx, etc.) — assume Dify is there but flaky
      return res.status < 500;
    } catch {
      return false;
    }
  };

  if (!(await probeIsDify())) return;

  // ---------- utils ----------
  const readCookie = (name) => {
    const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=([^;]+)`));
    return m ? decodeURIComponent(m[1]) : '';
  };

  const getCsrfToken = () => readCookie('__Host-csrf_token') || readCookie('csrf_token') || '';

  const api = async (path, { method = 'GET', body } = {}) => {
    const res = await fetch(`${API_PREFIX}${path}`, {
      method,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': getCsrfToken(),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 || res.status === 403) {
      const err = new Error(`Unauthorized (${res.status})`);
      err.status = res.status;
      throw err;
    }
    if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  };

  const fmtQuota = (size, limit) => {
    const u = size ?? 0;
    if (!limit || limit === 0) return { text: `${u}`, sub: 'Unlimited', pct: null };
    return { text: `${u}`, sub: `of ${limit}`, pct: Math.min(100, (u / limit) * 100) };
  };

  const fmtVector = (size, limit) => {
    const u = size ?? 0;
    if (!limit || limit === 0) return { text: `${u} MB`, sub: 'Unlimited', pct: null };
    return { text: `${u} MB`, sub: `of ${limit} MB`, pct: Math.min(100, (u / limit) * 100) };
  };

  const fmtTs = (ts) => {
    if (!ts) return '—';
    const d = new Date(ts * 1000);
    if (isNaN(d.getTime())) return '—';
    return d.toISOString().slice(0, 10);
  };

  const prettyPlan = (p) => ({
    sandbox: 'Sandbox',
    professional: 'Professional',
    team: 'Team',
    enterprise: 'Enterprise',
  }[p] || p || '—');

  const initials = (email, name) => {
    const s = (name || email || '?').trim();
    if (!s) return '?';
    const parts = s.replace(/@.*$/, '').split(/[\s._-]+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return s.slice(0, 2).toUpperCase();
  };

  const shortId = (id) => {
    if (!id) return '—';
    if (id.length <= 14) return id;
    return `${id.slice(0, 8)}…${id.slice(-4)}`;
  };

  const escapeHtml = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const readState = () => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; }
  };
  const writeState = (patch) => {
    const next = { ...readState(), ...patch };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  };

  // ---------- URL / app context ----------
  const APP_PATH_RE = /^\/app\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/([^/?#]+))?/i;
  const parseAppContext = () => {
    const m = location.pathname.match(APP_PATH_RE);
    return m ? { appId: m[1], section: (m[2] || 'overview').toLowerCase() } : null;
  };

  const loadContext = async (appId) => {
    if (!appId) return null;
    const safe = (p) => p.catch((e) => {
      if (e?.status === 401 || e?.status === 403) throw e;
      return null;
    });
    const [app, draft, published] = await Promise.all([
      safe(api(`/apps/${appId}`)),
      safe(api(`/apps/${appId}/workflows/draft`)),
      safe(api(`/apps/${appId}/workflows/publish`)),
    ]);
    return app ? { app, draft, published } : null;
  };

  const APP_MODE_LABEL = {
    chat: 'Chat',
    'agent-chat': 'Agent',
    completion: 'Completion',
    workflow: 'Workflow',
    'advanced-chat': 'Chatflow',
  };
  const hasWorkflow = (mode) => mode === 'workflow' || mode === 'advanced-chat';

  // ---------- data ----------
  const loadAll = async () => {
    const [profile, workspace, features, apps, datasets, members] = await Promise.allSettled([
      api('/account/profile'),
      api('/workspaces/current', { method: 'POST' }),
      api('/features'),
      api('/apps?page=1&limit=1&name='),
      api('/datasets?page=1&limit=1'),
      api('/workspaces/current/members'),
    ]);
    const val = (r) => (r.status === 'fulfilled' ? r.value : null);
    const authError = [profile, workspace, features, apps, datasets, members].some(
      (r) => r.status === 'rejected' && (r.reason?.status === 401 || r.reason?.status === 403),
    );
    return {
      authError,
      profile: val(profile),
      workspace: val(workspace),
      features: val(features),
      apps: val(apps),
      datasets: val(datasets),
      members: val(members),
    };
  };

  // ---------- UI host ----------
  const host = document.createElement('div');
  host.id = PANEL_ID;
  host.style.cssText = 'all: initial; position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;';
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });

  // ---------- SVG icons ----------
  const icons = {
    refresh: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 8a6 6 0 1 1-1.76-4.24"/><path d="M14 2v4h-4"/></svg>',
    min: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 8h8"/></svg>',
    copy: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5"/></svg>',
    copyAll: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="9" height="10" rx="1.5"/><path d="M11 4V2.5A1.5 1.5 0 0 0 9.5 1H3.5A1.5 1.5 0 0 0 2 2.5v8A1.5 1.5 0 0 0 3.5 12"/><path d="M6.5 8h4M6.5 10.5h3"/></svg>',
    check: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5 6.5 12 13 4.5"/></svg>',
    logo: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.5a5.5 5.5 0 0 1 0 11"/><circle cx="8" cy="8" r="2"/></svg>',
    apps: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>',
    users: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2.5"/><path d="M1.5 14c.7-2.3 2.4-3.5 4.5-3.5s3.8 1.2 4.5 3.5"/><circle cx="11" cy="5" r="2"/><path d="M13 10.5c1.3.4 2 1.5 2.5 3"/></svg>',
    book: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2h7a2 2 0 0 1 2 2v10"/><path d="M3 2v10a2 2 0 0 0 2 2h8"/><path d="M5 5h5M5 8h5"/></svg>',
    db: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="8" cy="4" rx="5.5" ry="2"/><path d="M2.5 4v4c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2V4"/><path d="M2.5 8v4c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2V8"/></svg>',
    doc: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 1h6l3 3v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z"/><path d="M10 1v3h3"/><path d="M5 8h6M5 11h4"/></svg>',
    zap: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M9 1 3 9h4l-1 6 6-8H8l1-6z"/></svg>',
    graduation: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M1 6 8 3l7 3-7 3z"/><path d="M4 7.5v3c0 1 2 2 4 2s4-1 4-2v-3"/></svg>',
    warning: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2 1.5 13.5h13z"/><path d="M8 7v3"/><circle cx="8" cy="12" r="0.5" fill="currentColor"/></svg>',
  };

  // ---------- styles ----------
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", Roboto, sans-serif; }

    .wrap {
      font-size: 12.5px; color: #0f172a;
      --bg: rgba(255, 255, 255, 0.82);
      --bg-solid: #ffffff;
      --border: rgba(15, 23, 42, 0.08);
      --border-strong: rgba(15, 23, 42, 0.14);
      --text: #0f172a;
      --text-sub: #64748b;
      --text-faint: #94a3b8;
      --accent: #1c64f2;
      --accent-2: #6366f1;
      --surface: rgba(248, 250, 252, 0.7);
      --surface-hover: rgba(241, 245, 249, 0.95);
      --danger: #ef4444;
      --success: #10b981;
      --warning: #f59e0b;
    }

    @media (prefers-color-scheme: dark) {
      .wrap {
        color: #e2e8f0;
        --bg: rgba(17, 24, 39, 0.88);
        --bg-solid: #111827;
        --border: rgba(255, 255, 255, 0.08);
        --border-strong: rgba(255, 255, 255, 0.14);
        --text: #f1f5f9;
        --text-sub: #94a3b8;
        --text-faint: #64748b;
        --surface: rgba(30, 41, 59, 0.6);
        --surface-hover: rgba(51, 65, 85, 0.8);
      }
    }

    .card {
      width: 340px;
      background: var(--bg);
      backdrop-filter: saturate(180%) blur(24px);
      -webkit-backdrop-filter: saturate(180%) blur(24px);
      border: 1px solid var(--border);
      border-radius: 16px;
      box-shadow:
        0 1px 2px rgba(15, 23, 42, 0.04),
        0 8px 24px rgba(15, 23, 42, 0.10),
        0 24px 64px rgba(15, 23, 42, 0.12);
      overflow: hidden;
      animation: pop 0.22s cubic-bezier(0.22, 1, 0.36, 1);
    }
    @keyframes pop {
      from { opacity: 0; transform: translateY(6px) scale(0.98); }
      to { opacity: 1; transform: none; }
    }

    /* ---------- Header ---------- */
    .hdr {
      position: relative;
      padding: 14px 14px 12px 14px;
      display: flex; align-items: center; gap: 10px;
      border-bottom: 1px solid var(--border);
    }
    .hdr::before {
      content: ''; position: absolute; inset: 0;
      background: radial-gradient(120% 100% at 0% 0%, rgba(28,100,242,0.08), transparent 60%),
                  radial-gradient(120% 100% at 100% 0%, rgba(99,102,241,0.08), transparent 60%);
      pointer-events: none;
    }
    .avatar {
      width: 34px; height: 34px; border-radius: 10px;
      background: linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%);
      display: flex; align-items: center; justify-content: center;
      color: #fff; font-weight: 700; font-size: 12px; letter-spacing: 0.5px;
      flex-shrink: 0;
      box-shadow: 0 4px 10px rgba(28, 100, 242, 0.25), inset 0 0 0 1px rgba(255,255,255,0.15);
      position: relative; z-index: 1;
    }
    .hdr-info { flex: 1; min-width: 0; position: relative; z-index: 1; }
    .hdr-primary {
      font-weight: 600; font-size: 13px; color: var(--text);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .hdr-secondary {
      font-size: 11px; color: var(--text-sub); margin-top: 2px;
      display: flex; align-items: center; gap: 6px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .hdr-actions { display: flex; gap: 4px; position: relative; z-index: 1; }
    .iconbtn {
      width: 26px; height: 26px; border-radius: 7px;
      background: transparent; border: 0; cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center;
      color: var(--text-sub); transition: all 0.15s ease;
    }
    .iconbtn svg { width: 14px; height: 14px; }
    .iconbtn:hover { background: var(--surface-hover); color: var(--text); }
    .iconbtn.spin svg { animation: spin 0.6s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }

    .env-pill {
      font-size: 9.5px; font-weight: 700; letter-spacing: 0.8px;
      padding: 2px 6px; border-radius: 4px;
      background: var(--surface); color: var(--text-sub);
      border: 1px solid var(--border);
    }
    .env-pill.prod { background: rgba(239, 68, 68, 0.1); color: #dc2626; border-color: rgba(239, 68, 68, 0.2); }

    /* ---------- Body ---------- */
    .body {
      padding: 12px; max-height: 70vh; overflow-y: auto;
      display: flex; flex-direction: column; gap: 12px;
    }
    .body::-webkit-scrollbar { width: 6px; }
    .body::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 3px; }
    .body::-webkit-scrollbar-track { background: transparent; }

    /* Plan hero card */
    .plan-hero {
      position: relative;
      padding: 12px 14px;
      border-radius: 12px;
      border: 1px solid var(--border);
      background: var(--surface);
      overflow: hidden;
    }
    .plan-hero::after {
      content: ''; position: absolute; inset: 0;
      background: linear-gradient(135deg, transparent 30%, rgba(28,100,242,0.04) 100%);
      pointer-events: none;
    }
    .plan-hero-top {
      display: flex; align-items: center; justify-content: space-between; gap: 10px;
      position: relative; z-index: 1;
    }
    .plan-label { font-size: 10.5px; color: var(--text-faint); text-transform: uppercase; letter-spacing: 0.8px; font-weight: 600; }
    .plan-row { display: flex; align-items: center; gap: 8px; margin-top: 2px; position: relative; z-index: 1; }
    .plan-name { font-size: 17px; font-weight: 700; color: var(--text); letter-spacing: -0.2px; }
    .plan-badge {
      font-size: 10px; font-weight: 700; padding: 3px 7px; border-radius: 5px; letter-spacing: 0.4px;
      display: inline-flex; align-items: center; gap: 3px;
    }
    .plan-badge.sandbox { background: rgba(14, 165, 233, 0.12); color: #0284c7; }
    .plan-badge.professional { background: rgba(139, 92, 246, 0.12); color: #7c3aed; }
    .plan-badge.team { background: rgba(245, 158, 11, 0.15); color: #c2410c; }
    .plan-badge.enterprise { background: rgba(236, 72, 153, 0.12); color: #be185d; }
    .plan-badge.chat { background: rgba(16, 185, 129, 0.12); color: #059669; }
    .plan-badge.agent { background: rgba(168, 85, 247, 0.12); color: #7e22ce; }
    .plan-badge.completion { background: rgba(6, 182, 212, 0.12); color: #0891b2; }
    .plan-badge.workflow { background: rgba(28, 100, 242, 0.12); color: #1c64f2; }
    .plan-badge.chatflow { background: rgba(249, 115, 22, 0.12); color: #ea580c; }
    .plan-badge.published { background: rgba(16, 185, 129, 0.12); color: #059669; }
    .plan-badge.unpublished { background: rgba(148, 163, 184, 0.18); color: #64748b; }
    .plan-badge svg { width: 11px; height: 11px; }
    .plan-hero.context { border-color: rgba(28, 100, 242, 0.2); }
    .plan-hero.context::after {
      background: linear-gradient(135deg, transparent 30%, rgba(99, 102, 241, 0.05) 100%);
    }
    .plan-hero .desc {
      margin-top: 6px; font-size: 11.5px; color: var(--text-sub);
      line-height: 1.5; position: relative; z-index: 1;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
      overflow: hidden; text-overflow: ellipsis;
    }
    .chip-row { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 2px; }
    .chip {
      font-size: 10px; padding: 2px 6px; border-radius: 4px;
      background: var(--surface); border: 1px solid var(--border);
      color: var(--text-sub); font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }

    .plan-meta {
      display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px;
      margin-top: 10px; position: relative; z-index: 1;
    }
    .plan-meta-item { display: flex; flex-direction: column; gap: 2px; }
    .plan-meta-k { font-size: 10px; color: var(--text-faint); text-transform: uppercase; letter-spacing: 0.5px; }
    .plan-meta-v { font-size: 12px; color: var(--text); font-weight: 500; }

    /* Section title */
    .sec-title {
      font-size: 10.5px; font-weight: 600; color: var(--text-faint);
      text-transform: uppercase; letter-spacing: 0.8px;
      padding: 0 2px;
      display: flex; align-items: center; gap: 6px;
    }

    /* Usage grid */
    .grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
    }
    .metric {
      padding: 10px 11px;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: var(--surface);
      display: flex; flex-direction: column; gap: 4px;
      transition: all 0.15s ease;
    }
    .metric:hover { border-color: var(--border-strong); background: var(--surface-hover); }
    .metric-head { display: flex; align-items: center; gap: 6px; color: var(--text-sub); }
    .metric-head svg { width: 12px; height: 12px; }
    .metric-head span { font-size: 10.5px; font-weight: 500; }
    .metric-value { font-size: 17px; font-weight: 700; color: var(--text); letter-spacing: -0.3px; line-height: 1.2; }
    .metric-sub { font-size: 10px; color: var(--text-faint); }
    .bar { height: 3px; background: var(--border); border-radius: 2px; overflow: hidden; margin-top: 2px; }
    .bar > span { display: block; height: 100%; background: linear-gradient(90deg, var(--accent), var(--accent-2)); border-radius: 2px; transition: width 0.3s ease; }
    .bar > span.warn { background: linear-gradient(90deg, var(--warning), #ea580c); }
    .bar > span.danger { background: linear-gradient(90deg, var(--danger), #b91c1c); }

    /* ID rows */
    .ids { display: flex; flex-direction: column; gap: 6px; }
    .id-row {
      display: flex; align-items: center; justify-content: space-between; gap: 10px;
      padding: 8px 10px;
      border-radius: 8px;
      background: var(--surface);
      border: 1px solid var(--border);
      transition: all 0.15s ease;
      cursor: pointer;
    }
    .id-row:hover { border-color: var(--accent); background: var(--surface-hover); }
    .id-k { font-size: 10.5px; color: var(--text-sub); font-weight: 500; flex-shrink: 0; }
    .id-v {
      flex: 1; text-align: right;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px; color: var(--text); font-weight: 500;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .id-row .copy-ic {
      color: var(--text-faint); flex-shrink: 0;
      display: inline-flex; align-items: center; transition: color 0.15s;
    }
    .id-row:hover .copy-ic { color: var(--accent); }
    .id-row.copied .copy-ic { color: var(--success); }

    /* Empty / loading */
    .state {
      padding: 32px 16px; text-align: center; color: var(--text-sub);
      display: flex; flex-direction: column; align-items: center; gap: 8px;
    }
    .state-icon { color: var(--text-faint); }
    .state-icon svg { width: 28px; height: 28px; }
    .state a {
      color: var(--accent); text-decoration: none; font-weight: 600;
      padding: 6px 12px; border-radius: 6px;
      border: 1px solid var(--accent);
      transition: all 0.15s;
    }
    .state a:hover { background: var(--accent); color: #fff; }
    .skeleton {
      height: 12px; background: var(--surface); border-radius: 4px;
      animation: pulse 1.4s ease-in-out infinite;
    }
    @keyframes pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 0.8; } }

    /* Toast */
    .toast {
      position: fixed; right: 20px; bottom: 20px;
      background: var(--text); color: var(--bg-solid);
      padding: 8px 14px; border-radius: 8px;
      font-size: 11.5px; font-weight: 500;
      opacity: 0; transform: translateY(8px);
      transition: opacity 0.2s, transform 0.2s;
      pointer-events: none; white-space: nowrap;
      display: flex; align-items: center; gap: 6px;
      box-shadow: 0 4px 12px rgba(15,23,42,0.15);
    }
    .toast svg { width: 12px; height: 12px; }
    .toast.show { opacity: 1; transform: none; }

    /* Minimized orb */
    .orb {
      width: 48px; height: 48px; border-radius: 50%;
      background: linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%);
      color: #fff; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      box-shadow:
        0 4px 12px rgba(28, 100, 242, 0.35),
        inset 0 0 0 1px rgba(255,255,255,0.2);
      transition: all 0.2s ease;
      animation: float-in 0.25s ease;
    }
    .orb svg { width: 20px; height: 20px; }
    .orb:hover {
      transform: scale(1.08) translateY(-2px);
      box-shadow: 0 6px 16px rgba(28, 100, 242, 0.45), inset 0 0 0 1px rgba(255,255,255,0.25);
    }
    .orb-dot {
      position: absolute; top: 4px; right: 4px;
      width: 8px; height: 8px; border-radius: 50%;
      background: var(--success);
      box-shadow: 0 0 0 2px var(--bg-solid);
    }
    .orb-dot.err { background: var(--danger); }
    @keyframes float-in {
      from { opacity: 0; transform: scale(0.8); }
      to { opacity: 1; transform: scale(1); }
    }
  `;
  shadow.appendChild(style);

  const root = document.createElement('div');
  root.className = 'wrap';
  shadow.appendChild(root);

  const envInfo = (() => {
    const h = location.hostname;
    if (h === 'cloud.dify.ai') return { key: 'prod', label: 'PROD' };
    // Any other host — show a short uppercased form of the hostname.
    return { key: '', label: h.replace(/^(www\.|console\.)/, '').toUpperCase().slice(0, 20) };
  })();

  // ---------- toast ----------
  let toastEl;
  const toast = (text, ok = true) => {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      shadow.appendChild(toastEl);
    }
    toastEl.innerHTML = `${ok ? icons.check : icons.warning}<span>${escapeHtml(text)}</span>`;
    toastEl.classList.add('show');
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => toastEl.classList.remove('show'), 1600);
  };

  const copy = async (text, rowEl) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied to clipboard');
      if (rowEl) {
        rowEl.classList.add('copied');
        setTimeout(() => rowEl.classList.remove('copied'), 1200);
      }
    } catch {
      toast('Copy failed', false);
    }
  };

  let baseData = null;
  let contextData = null;
  let trackedAppId = null;

  const buildSnapshot = () => {
    const d = baseData || {};
    const profile = d.profile || {};
    const ws = d.workspace || {};
    const feats = d.features || {};
    const sub = feats.billing?.subscription?.plan || ws.plan || '—';
    const appsTotal = d.apps?.total ?? '—';
    const dsTotal = d.datasets?.total ?? '—';
    const memList = d.members?.accounts || d.members?.members || d.members?.data || [];
    const memTotal = d.members?.total ?? (Array.isArray(memList) ? memList.length : '—');
    const appsQ = feats.apps || {};
    const memQ = feats.members || feats.workspace_members || {};
    const vs = feats.vector_space || {};
    const docQ = feats.documents_upload_quota || {};
    const quotaLine = (size, limit) => (!limit ? `${size ?? 0} (unlimited)` : `${size ?? 0} / ${limit}`);
    const vecLine = (size, limit) => (!limit ? `${size ?? 0} MB (unlimited)` : `${size ?? 0} MB / ${limit} MB`);

    return [
      `# Dify Workspace Snapshot`,
      ``,
      `- Environment: ${envInfo.label} (${location.hostname})`,
      `- Captured at: ${new Date().toISOString()}`,
      ``,
      `## Account`,
      `- Email: ${profile.email || '—'}`,
      `- Account ID: ${profile.id || '—'}`,
      `- Name: ${profile.name || '—'}`,
      ``,
      `## Workspace`,
      `- Name: ${ws.name || '—'}`,
      `- Tenant ID: ${ws.id || '—'}`,
      `- Role: ${ws.role || '—'}`,
      `- Status: ${ws.status || '—'}`,
      `- Created: ${fmtTs(ws.created_at)}`,
      ``,
      `## Subscription`,
      `- Plan: ${prettyPlan(sub)}`,
      `- Billing enabled: ${feats.billing?.enabled ? 'yes' : 'no'}`,
      `- Trial credits: ${ws.trial_credits_used ?? 0} / ${ws.trial_credits ?? 0}`,
      `- Next credit reset: ${fmtTs(ws.next_credit_reset_date)}`,
      ws.trial_end_reason ? `- Trial end reason: ${ws.trial_end_reason}` : null,
      feats.education?.activated ? `- Education: activated` : null,
      ``,
      `## Usage`,
      `- Apps: ${appsTotal} (quota ${quotaLine(appsQ.size, appsQ.limit)})`,
      `- Members: ${memTotal} (quota ${quotaLine(memQ.size, memQ.limit)})`,
      `- Knowledge bases: ${dsTotal}`,
      `- Vector space: ${vecLine(vs.size, vs.limit)}`,
      `- Doc upload quota: ${quotaLine(docQ.size, docQ.limit)}`,
      `- Docs processing priority: ${feats.docs_processing || '—'}`,
      ...(contextData?.app ? appSnapshotLines(contextData) : []),
    ]
      .filter((l) => l !== null)
      .join('\n');
  };

  const appSnapshotLines = (ctx) => {
    const a = ctx.app;
    const draft = ctx.draft;
    const pub = ctx.published;
    const nodes = draft?.graph?.nodes || [];
    const edges = draft?.graph?.edges || [];
    const typeCounts = {};
    for (const n of nodes) {
      const t = n?.data?.type || n?.type || 'unknown';
      typeCounts[t] = (typeCounts[t] || 0) + 1;
    }
    const typeBreakdown = Object.entries(typeCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([t, c]) => `${t}×${c}`)
      .join(', ');
    return [
      ``,
      `## Current App`,
      `- Name: ${a.name || '—'}`,
      `- App ID: ${a.id || '—'}`,
      `- Mode: ${APP_MODE_LABEL[a.mode] || a.mode || '—'}`,
      a.description ? `- Description: ${a.description}` : null,
      `- Created: ${fmtTs(a.created_at)}${a.created_by_account?.name ? ` by ${a.created_by_account.name}` : ''}`,
      `- Updated: ${fmtTs(a.updated_at)}`,
      hasWorkflow(a.mode) ? `- Workflow nodes: ${nodes.length}${typeBreakdown ? ` (${typeBreakdown})` : ''}` : null,
      hasWorkflow(a.mode) ? `- Workflow edges: ${edges.length}` : null,
      hasWorkflow(a.mode) ? `- Published: ${pub ? `yes (${fmtTs(pub.created_at)})` : 'no'}` : null,
    ];
  };

  const copyAll = async () => {
    if (!baseData) return toast('No data yet', false);
    try {
      await navigator.clipboard.writeText(buildSnapshot());
      toast('Snapshot copied as Markdown');
    } catch {
      toast('Copy failed', false);
    }
  };

  // ---------- renderers ----------
  const renderMinimized = (hasError = false) => {
    root.innerHTML = `
      <div class="orb" title="Dify Helper — click to expand">
        ${icons.logo}
        <span class="orb-dot ${hasError ? 'err' : ''}"></span>
      </div>
    `;
    root.querySelector('.orb').addEventListener('click', () => {
      writeState({ minimized: false });
      renderLoading();
      refresh();
    });
  };

  const renderLoading = () => {
    if (readState().minimized) return renderMinimized();
    root.innerHTML = `
      <div class="card">
        <div class="hdr">
          <div class="avatar">··</div>
          <div class="hdr-info">
            <div class="hdr-primary"><div class="skeleton" style="width: 120px; height: 12px;"></div></div>
            <div class="hdr-secondary"><div class="skeleton" style="width: 80px; height: 10px; margin-top: 4px;"></div></div>
          </div>
          <div class="hdr-actions">
            <button class="iconbtn spin" data-act="refresh">${icons.refresh}</button>
            <button class="iconbtn" data-act="min">${icons.min}</button>
          </div>
        </div>
        <div class="body">
          <div class="skeleton" style="height: 64px; border-radius: 12px;"></div>
          <div class="skeleton" style="height: 70px; border-radius: 10px;"></div>
        </div>
      </div>
    `;
    bindActions();
  };

  const renderAuth = () => {
    if (readState().minimized) return renderMinimized(true);
    root.innerHTML = `
      <div class="card">
        <div class="hdr">
          <div class="avatar" style="background: linear-gradient(135deg, #ef4444, #f97316);">!</div>
          <div class="hdr-info">
            <div class="hdr-primary">Not signed in</div>
            <div class="hdr-secondary">
              <span class="env-pill ${envInfo.key}">${envInfo.label}</span>
              Session expired or no access
            </div>
          </div>
          <div class="hdr-actions">
            <button class="iconbtn" data-act="refresh" title="Retry">${icons.refresh}</button>
            <button class="iconbtn" data-act="min" title="Minimize">${icons.min}</button>
          </div>
        </div>
        <div class="state">
          <div class="state-icon">${icons.logo}</div>
          <div>Sign in to see your Dify workspace details</div>
          <a href="/signin" target="_self">Go to sign in →</a>
        </div>
      </div>
    `;
    bindActions();
  };

  const renderContextCard = () => {
    const ctx = contextData;
    if (!ctx?.app) return '';
    const a = ctx.app;
    const draft = ctx.draft;
    const pub = ctx.published;
    const modeRaw = a.mode || '';
    const modeKey = modeRaw === 'advanced-chat' ? 'chatflow' : modeRaw === 'agent-chat' ? 'agent' : modeRaw;
    const modeLabel = APP_MODE_LABEL[modeRaw] || modeRaw || '—';
    const nodes = draft?.graph?.nodes || [];
    const edges = draft?.graph?.edges || [];

    // top 3 node types
    const typeCounts = {};
    for (const n of nodes) {
      const t = n?.data?.type || n?.type || '?';
      typeCounts[t] = (typeCounts[t] || 0) + 1;
    }
    const topTypes = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).slice(0, 4);

    const showWorkflow = hasWorkflow(modeRaw);
    const publishedBadge = showWorkflow
      ? (pub ? `<span class="plan-badge published">PUBLISHED</span>` : `<span class="plan-badge unpublished">DRAFT</span>`)
      : '';

    return `
      <div class="plan-hero context">
        <div class="plan-hero-top">
          <div style="min-width: 0; flex: 1;">
            <div class="plan-label">Current app</div>
            <div class="plan-row" style="flex-wrap: wrap;">
              <span class="plan-name" style="overflow: hidden; text-overflow: ellipsis; max-width: 180px; white-space: nowrap;">${escapeHtml(a.name || '—')}</span>
              <span class="plan-badge ${modeKey}">${escapeHtml(modeLabel.toUpperCase())}</span>
              ${publishedBadge}
            </div>
          </div>
        </div>
        ${a.description ? `<div class="desc">${escapeHtml(a.description)}</div>` : ''}
        <div class="plan-meta">
          <div class="plan-meta-item">
            <span class="plan-meta-k">Created</span>
            <span class="plan-meta-v">${fmtTs(a.created_at)}</span>
          </div>
          <div class="plan-meta-item">
            <span class="plan-meta-k">Updated</span>
            <span class="plan-meta-v">${fmtTs(a.updated_at)}</span>
          </div>
          ${a.created_by_account?.name ? `
          <div class="plan-meta-item" style="grid-column: 1 / -1;">
            <span class="plan-meta-k">Created by</span>
            <span class="plan-meta-v">${escapeHtml(a.created_by_account.name)}${a.created_by_account.email ? ` · ${escapeHtml(a.created_by_account.email)}` : ''}</span>
          </div>` : ''}
          ${showWorkflow ? `
          <div class="plan-meta-item">
            <span class="plan-meta-k">Nodes</span>
            <span class="plan-meta-v">${nodes.length}</span>
          </div>
          <div class="plan-meta-item">
            <span class="plan-meta-k">Edges</span>
            <span class="plan-meta-v">${edges.length}</span>
          </div>
          ${pub ? `
          <div class="plan-meta-item" style="grid-column: 1 / -1;">
            <span class="plan-meta-k">Last publish</span>
            <span class="plan-meta-v">${fmtTs(pub.created_at)}${pub.created_by_account?.name ? ` by ${escapeHtml(pub.created_by_account.name)}` : ''}</span>
          </div>` : ''}
          ${topTypes.length ? `
          <div class="plan-meta-item" style="grid-column: 1 / -1;">
            <span class="plan-meta-k">Top nodes</span>
            <span class="chip-row">${topTypes.map(([t, c]) => `<span class="chip">${escapeHtml(t)} × ${c}</span>`).join('')}</span>
          </div>` : ''}
          ` : ''}
        </div>
      </div>
    `;
  };

  const renderData = () => {
    if (readState().minimized) return renderMinimized();
    const d = baseData;
    if (!d) return;

    const profile = d.profile || {};
    const ws = d.workspace || {};
    const feats = d.features || {};
    const sub = (feats.billing?.subscription?.plan || ws.plan || '').toLowerCase();
    const planName = prettyPlan(sub);
    const appsTotal = d.apps?.total ?? (Array.isArray(d.apps?.data) ? d.apps.data.length : 0);
    const dsTotal = d.datasets?.total ?? (Array.isArray(d.datasets?.data) ? d.datasets.data.length : 0);
    const membersList = d.members?.accounts || d.members?.members || d.members?.data || [];
    const membersTotal = d.members?.total ?? (Array.isArray(membersList) ? membersList.length : 0);

    const appsQ = feats.apps || {};
    const membersQ = feats.members || feats.workspace_members || {};
    const vs = feats.vector_space || {};
    const docQ = feats.documents_upload_quota || {};

    const appsFmt = fmtQuota(appsQ.size ?? appsTotal, appsQ.limit);
    const membersFmt = fmtQuota(membersQ.size ?? membersTotal, membersQ.limit);
    const vecFmt = fmtVector(vs.size, vs.limit);
    const docFmt = fmtQuota(docQ.size, docQ.limit);

    const barClass = (pct) => (pct == null ? '' : pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : '');
    const metricCard = (icon, title, value, sub, pct) => `
      <div class="metric">
        <div class="metric-head">${icon}<span>${escapeHtml(title)}</span></div>
        <div class="metric-value">${escapeHtml(value)}</div>
        <div class="metric-sub">${escapeHtml(sub)}</div>
        ${pct != null ? `<div class="bar"><span class="${barClass(pct)}" style="width: ${pct.toFixed(1)}%"></span></div>` : ''}
      </div>
    `;

    const planBadgeIcon = sub === 'enterprise' ? icons.zap : '';

    root.innerHTML = `
      <div class="card">
        <div class="hdr">
          <div class="avatar" title="${escapeHtml(profile.email || '')}">${escapeHtml(initials(profile.email, profile.name))}</div>
          <div class="hdr-info">
            <div class="hdr-primary">${escapeHtml(profile.name || profile.email?.split('@')[0] || '—')}</div>
            <div class="hdr-secondary">
              <span class="env-pill ${envInfo.key}">${envInfo.label}</span>
              ${escapeHtml(ws.name || profile.email || '—')}
            </div>
          </div>
          <div class="hdr-actions">
            <button class="iconbtn" data-act="copy-all" title="Copy all as Markdown">${icons.copyAll}</button>
            <button class="iconbtn" data-act="refresh" title="Refresh">${icons.refresh}</button>
            <button class="iconbtn" data-act="min" title="Minimize">${icons.min}</button>
          </div>
        </div>

        <div class="body">
          ${renderContextCard()}

          <!-- Plan hero -->
          <div class="plan-hero">
            <div class="plan-hero-top">
              <div>
                <div class="plan-label">Current plan</div>
                <div class="plan-row">
                  <span class="plan-name">${planName}</span>
                  <span class="plan-badge ${sub}">${planBadgeIcon}${planName.toUpperCase()}</span>
                </div>
              </div>
              ${feats.education?.activated ? `<span class="plan-badge team" title="Education activated">${icons.graduation} EDU</span>` : ''}
            </div>
            <div class="plan-meta">
              <div class="plan-meta-item">
                <span class="plan-meta-k">Role</span>
                <span class="plan-meta-v">${escapeHtml(ws.role || '—')}</span>
              </div>
              <div class="plan-meta-item">
                <span class="plan-meta-k">Status</span>
                <span class="plan-meta-v">${escapeHtml(ws.status || '—')}</span>
              </div>
              <div class="plan-meta-item">
                <span class="plan-meta-k">Created</span>
                <span class="plan-meta-v">${fmtTs(ws.created_at)}</span>
              </div>
              <div class="plan-meta-item">
                <span class="plan-meta-k">Next reset</span>
                <span class="plan-meta-v">${fmtTs(ws.next_credit_reset_date)}</span>
              </div>
              ${(ws.trial_credits || ws.trial_credits_used) ? `
              <div class="plan-meta-item" style="grid-column: 1 / -1;">
                <span class="plan-meta-k">Trial credits</span>
                <span class="plan-meta-v">${ws.trial_credits_used ?? 0} / ${ws.trial_credits ?? 0} used</span>
              </div>` : ''}
              ${ws.trial_end_reason ? `
              <div class="plan-meta-item" style="grid-column: 1 / -1;">
                <span class="plan-meta-k">Trial end reason</span>
                <span class="plan-meta-v">${escapeHtml(ws.trial_end_reason)}</span>
              </div>` : ''}
            </div>
          </div>

          <!-- Usage grid -->
          <div class="sec-title">Usage</div>
          <div class="grid">
            ${metricCard(icons.apps, 'Apps', String(appsTotal), appsFmt.sub === 'Unlimited' ? 'Unlimited' : `${appsFmt.sub}`, appsFmt.pct)}
            ${metricCard(icons.users, 'Members', String(membersTotal), membersFmt.sub === 'Unlimited' ? 'Unlimited' : `${membersFmt.sub}`, membersFmt.pct)}
            ${metricCard(icons.book, 'Knowledge', String(dsTotal), 'bases', null)}
            ${metricCard(icons.db, 'Vector', vecFmt.text, vecFmt.sub, vecFmt.pct)}
            ${metricCard(icons.doc, 'Doc uploads', docFmt.text, docFmt.sub, docFmt.pct)}
            ${metricCard(icons.zap, 'Docs priority', String(feats.docs_processing || '—'), 'processing tier', null)}
          </div>

          <!-- IDs -->
          <div class="sec-title">Identifiers</div>
          <div class="ids">
            <div class="id-row" data-copy="${escapeHtml(profile.email || '')}" title="Click to copy">
              <span class="id-k">Email</span>
              <span class="id-v" style="font-family: inherit;">${escapeHtml(profile.email || '—')}</span>
              <span class="copy-ic">${icons.copy}</span>
            </div>
            <div class="id-row" data-copy="${escapeHtml(profile.id || '')}" title="${escapeHtml(profile.id || '')}">
              <span class="id-k">Account ID</span>
              <span class="id-v">${shortId(profile.id)}</span>
              <span class="copy-ic">${icons.copy}</span>
            </div>
            <div class="id-row" data-copy="${escapeHtml(ws.id || '')}" title="${escapeHtml(ws.id || '')}">
              <span class="id-k">Tenant ID</span>
              <span class="id-v">${shortId(ws.id)}</span>
              <span class="copy-ic">${icons.copy}</span>
            </div>
            ${contextData?.app ? `
            <div class="id-row" data-copy="${escapeHtml(contextData.app.id || '')}" title="${escapeHtml(contextData.app.id || '')}">
              <span class="id-k">App ID</span>
              <span class="id-v">${shortId(contextData.app.id)}</span>
              <span class="copy-ic">${icons.copy}</span>
            </div>` : ''}
          </div>
        </div>
      </div>
    `;

    bindActions();
    root.querySelectorAll('.id-row').forEach((el) => {
      el.addEventListener('click', () => {
        const v = el.getAttribute('data-copy');
        if (v) copy(v, el);
      });
    });
  };

  const bindActions = () => {
    root.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const act = btn.getAttribute('data-act');
        if (act === 'min') {
          writeState({ minimized: true });
          renderMinimized();
        } else if (act === 'refresh') {
          btn.classList.add('spin');
          refresh();
        } else if (act === 'copy-all') {
          copyAll();
        }
      });
    });
  };

  const refresh = async () => {
    try {
      baseData = await loadAll();
      if (baseData.authError && !baseData.profile) return renderAuth();
      // Render base immediately; context loads in background.
      renderData();
      const ctx = parseAppContext();
      if (ctx) {
        trackedAppId = ctx.appId;
        loadContext(ctx.appId)
          .then((c) => {
            if (trackedAppId === ctx.appId) {
              contextData = c;
              renderData();
            }
          })
          .catch((e) => {
            if (e?.status === 401 || e?.status === 403) renderAuth();
          });
      } else {
        trackedAppId = null;
        contextData = null;
      }
    } catch (e) {
      if (e?.status === 401 || e?.status === 403) return renderAuth();
      console.error('[Dify Helper]', e);
      renderAuth();
    }
  };

  // ---------- URL change watcher (SPA-safe) ----------
  // Content scripts run in an ISOLATED world, so monkey-patching
  // history.pushState here does NOT intercept Next.js's internal
  // navigation (that code runs in the page's MAIN world). location.href
  // *is* shared across worlds, so polling it is the authoritative source
  // of truth. popstate + isolated-world pushState patches stay as
  // zero-cost fast paths for the cases they do cover.
  const installUrlWatcher = () => {
    let lastHref = location.href;
    let pending;
    const check = () => {
      if (location.href === lastHref) return;
      lastHref = location.href;
      clearTimeout(pending);
      pending = setTimeout(onUrlChanged, 120);
    };

    setInterval(check, 300);
    window.addEventListener('popstate', check);
    ['pushState', 'replaceState'].forEach((k) => {
      const orig = history[k];
      history[k] = function (...args) {
        const r = orig.apply(this, args);
        check();
        return r;
      };
    });
  };

  const onUrlChanged = async () => {
    const ctx = parseAppContext();
    const newAppId = ctx?.appId || null;
    if (newAppId === trackedAppId) return;
    trackedAppId = newAppId;
    if (!newAppId) {
      contextData = null;
      renderData();
      return;
    }
    // Optimistic: clear old context and re-render so the old card doesn't
    // linger while the new one loads.
    contextData = null;
    renderData();
    try {
      const c = await loadContext(newAppId);
      if (trackedAppId === newAppId) {
        contextData = c;
        renderData();
      }
    } catch (e) {
      if (e?.status === 401 || e?.status === 403) renderAuth();
    }
  };

  // ---------- init ----------
  if (readState().minimized) renderMinimized();
  else renderLoading();
  installUrlWatcher();
  refresh();
})();
