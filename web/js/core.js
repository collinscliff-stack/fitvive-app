// Shared pieces: the database client, app state and small helpers.
const cfg = window.FITVIVE_CONFIG || {};
export const configured = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);
export const sb = configured
  ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
    })
  : null;

// session: the login. profile: the member's row. access: may they join rooms right now.
export const S = { session: null, profile: null, access: false, company: null, recovery: false, invite: null };
export const uid = () => S.session?.user?.id || null;
// Set by main.js: re-draw the current screen, or re-read the member's profile first.
export const app = { refresh: async () => {}, reloadProfile: async () => {} };

export const $ = (sel, root = document) => root.querySelector(sel);
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const ini = (name) => String(name || '?').split(/\s+/).map((w) => w[0] || '').join('').slice(0, 2).toUpperCase();
export const shortName = (full) => {
  const p = String(full || '').trim().split(/\s+/);
  return (p[0] || 'Member') + (p[1] ? ` ${p[1][0].toUpperCase()}.` : '');
};

let toastTimer = 0;
export function toast(message) {
  const t = $('#toast');
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

// Runs a database call and throws a plain Error if it failed.
export async function q(promise) {
  const { data, error } = await promise;
  if (error) throw new Error(error.message);
  return data;
}

// Calls a server function. Expected problems come back as { error }.
export async function fn(name, body) {
  const { data, error } = await sb.functions.invoke(name, { body });
  if (error) {
    let message = error.message;
    try { const j = await error.context.json(); message = j.error || message; } catch { /* keep the message */ }
    throw new Error(message);
  }
  if (data && data.error) throw new Error(data.error);
  return data;
}

export const go = (route) => { location.hash = '#/' + route; };

export const fmtTime = (d) => new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
export const fmtDay = (d) => new Date(d).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });
export const fmtDate = (d) => new Date(d).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
export const naira = (kobo) => '₦' + (kobo / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 });
export const dayKey = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
// A closing full stop, unless the text already ends with one (names like "Tunde B.").
export const stop = (s) => (/[.!?]$/.test(String(s || '').trim()) ? '' : '.');
export const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);

// The 11-character video id from any usual YouTube link (watch, youtu.be, shorts, live, embed). null if it is not one.
export function youtubeId(url) {
  const m = String(url || '').trim().match(/^https?:\/\/(?:[a-z0-9-]+\.)?(?:youtube\.com|youtu\.be|youtube-nocookie\.com)\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/|v\/)?([A-Za-z0-9_-]{11})(?:[?&#/]|$)/i);
  return m ? m[1] : null;
}

export const JOIN_WINDOW_MIN = 5;
// Where a session stands right now: 'live', 'open' (join window), 'upcoming' or 'ended'.
export function sessionState(s, now = Date.now()) {
  const start = new Date(s.starts_at).getTime();
  const end = start + s.duration_min * 60000;
  if (s.status !== 'scheduled' || now >= end) return 'ended';
  if (now >= start) return 'live';
  if (now >= start - JOIN_WINDOW_MIN * 60000) return 'open';
  return 'upcoming';
}

// Sessions between two dates, each with its trainer's display name.
export async function loadSessions(from, to) {
  const rows = await q(sb.from('sessions').select('*').gte('starts_at', from.toISOString()).lt('starts_at', to.toISOString())
    .neq('status', 'cancelled').order('starts_at'));
  const ids = [...new Set(rows.map((r) => r.trainer_id).filter(Boolean))];
  const names = {};
  if (ids.length) (await q(sb.from('member_cards').select('id,display_name').in('id', ids))).forEach((c) => { names[c.id] = c.display_name; });
  return rows.map((r) => ({ ...r, trainer_name: names[r.trainer_id] || 'a trainer to be confirmed' }));
}

// ---------------------------------------------------------------- icons (drawn as single paths)
const ICONS = {
  chat: 'M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  pin: 'M12 21s-6.5-5.8-6.5-11A6.5 6.5 0 0 1 18.5 10c0 5.2-6.5 11-6.5 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  camera: 'M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1',
  home: 'M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  calendar: 'M7 3v3M17 3v3M4 9.5h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  users: 'M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20M9.5 10.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 20v-1.5a4 4 0 0 0-3-3.85M15.5 3.7a3.5 3.5 0 0 1 0 6.6',
  trophy: 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20.5h7M10 17h4v3.5h-4z',
  grid: 'M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5z',
  bolt: 'M13 3 5 13.5h6L10 21l8-10.5h-6z',
  card: 'M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 10h18M7 15h3',
  building: 'M5 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16M15 10h3a1 1 0 0 1 1 1v10M3 21h18M8.5 8h3M8.5 12h3M8.5 16h3',
  sliders: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 4.5v5M9 14.5v5',
  video: 'M4 7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM16 10.5l5-3v9l-5-3',
  videooff: 'M4 7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM16 10.5l5-3v9l-5-3M3 3l18 18',
  inbox: 'M4 13l2.5-8h11L20 13v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM4 13h4.5l1 2h5l1-2H20',
  flag: 'M5 21V4h11l-2 4 2 4H5',
  coins: 'M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6',
  logout: 'M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4M15 8l4 4-4 4M19 12H9',
  mic: 'M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM6 11a6 6 0 0 0 12 0M12 17v4',
  micoff: 'M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM6 11a6 6 0 0 0 12 0M12 17v4M3 3l18 18',
  leave: 'M3.5 15c2.5-5 14.5-5 17 0l-1.6 3-3.4-1.2v-2.3a9 9 0 0 0-7 0v2.3L5.1 18z',
  signal: 'M5 19v-3M10 19v-7M15 19V8M20 19V4',
  play: 'M8 5l11 7-11 7z',
  flame: 'M12 3c1 3.5 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 1.5-4.5.6 1 1.3 1.6 2 2C10.2 8 11 6 12 3z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
};
export const icon = (name) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name] || ''}"/></svg>`;

// ---------------------------------------------------------------- the menu, by role
// Items marked tab sit in the phone's bottom bar; the rest live under More.
export function menu() {
  if (!S.session || S.profile?.status !== 'approved') return [];
  const role = S.profile.role;
  const items = [
    { route: 'home', label: 'Home', icon: 'home', tab: true },
    { route: 'timetable', label: 'Timetable', icon: 'calendar', tab: true },
    { route: 'members', label: 'Members', icon: 'users', tab: true },
    { route: 'messages', label: 'Messages', icon: 'chat', tab: true, badge: true },
    { route: 'profile', label: 'My profile', icon: 'user' },
    { route: 'partners', label: 'Partners', icon: 'flame' },
    { route: 'ranking', label: 'Ranking', icon: 'trophy' },
    { route: 'games', label: 'Games', icon: 'bolt' },
    { route: 'membership', label: 'Membership', icon: 'card' },
    { route: 'company', label: 'Company', icon: 'building' },
    { route: 'settings', label: 'Settings', icon: 'sliders' },
  ];
  if (role === 'trainer' || role === 'admin') items.push({ group: 'Trainer' }, { route: 'trainer', label: 'My sessions', icon: 'video' });
  if (role === 'admin') {
    items.push({ group: 'Club admin' },
      { route: 'admin/applications', label: 'Applications', icon: 'inbox' },
      { route: 'admin/members', label: 'Members', icon: 'users' },
      { route: 'admin/sessions', label: 'Sessions', icon: 'calendar' },
      { route: 'admin/reports', label: 'Reports', icon: 'flag' },
      { route: 'admin/companies', label: 'Companies', icon: 'building' },
      { route: 'admin/fees', label: 'Fees and access', icon: 'coins' });
  }
  return items;
}

// ---------------------------------------------------------------- plain-language error messages
const FRIENDLY = [
  [/NO_ACCESS/, 'You need an active membership to join. Open Membership to pay.'],
  [/Failed to fetch|NetworkError|Load failed/i, 'No connection. Check your internet and try again.'],
  [/Invalid login credentials/i, 'Wrong email or password.'],
  [/Email not confirmed/i, 'Confirm your email first. Check your inbox for the link.'],
  [/already registered/i, 'That email already has an account. Log in instead.'],
  [/rate limit/i, 'Too many sign-ups in the last hour. Wait a few minutes and try again.'],
];
export const friendly = (m) => (FRIENDLY.find(([re]) => re.test(m || '')) || [0, m || 'Something went wrong'])[1];

// ---------------------------------------------------------------- shared pieces of screens
export const head = (eyebrow, title, sub) =>
  `<header class="pagehead">${eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : ''}<h2>${title}</h2>${sub ? `<p class="meta">${sub}</p>` : ''}</header>`;

export const emptyRow = (text) => `<li class="meta">${text}</li>`;

export const TYPE_LABEL = { workout: 'Workout', dance: 'Dance', stretch: 'Stretch', challenge: 'Challenge' };

// The trainer of a session, and any admin, can open its room at any time.
export const canHost = (s) => s.trainer_id === uid() || S.profile?.role === 'admin';

// One session line for lists. The time leads; the button depends on where the session stands.
export function sessionRow(s) {
  const st = sessionState(s);
  const host = canHost(s);
  const womenBlocked = s.women_only && S.profile?.gender !== 'female' && !host;
  const start = new Date(s.starts_at);
  const opensAt = new Date(start.getTime() - JOIN_WINDOW_MIN * 60000);
  const otherDay = dayKey(start) !== dayKey(new Date()) ? start.toLocaleDateString([], { weekday: 'short' }) + ' ' : '';
  let action;
  if (st === 'ended') action = '<span class="opens">Ended</span>';
  else if (womenBlocked) action = '<span class="opens">Women only</span>';
  else if (st === 'live' || st === 'open') action = `<a class="btn gold sm" href="#/room/${s.id}">${icon('play')}${host ? 'Open' : 'Join'}</a>`;
  else action = `<span class="opens">Opens ${otherDay}${fmtTime(opensAt)}</span>${host ? `<a class="btn sm" href="#/room/${s.id}">Open early</a>` : ''}`;
  return `<li class="item sess"><div class="when"><b>${fmtTime(start)}</b><span>${s.duration_min} min</span></div><div class="grow"><div class="it">${esc(s.title)} ${st === 'live' ? '<span class="tag live">Live now</span>' : ''} ${s.women_only ? '<span class="tag">Women only</span>' : ''} ${s.company_id ? '<span class="tag">Private</span>' : ''} ${s.video_url ? '<span class="tag warn">Video</span>' : ''}</div><div class="meta">${TYPE_LABEL[s.type] || esc(s.type)} with ${esc(s.trainer_name || 'a trainer to be confirmed')}</div></div>${action}</li>`;
}

// ---------------------------------------------------------------- members: photos, location, online
export const NG_STATES = ['Abia', 'Abuja (FCT)', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara', 'Outside Nigeria'];

// Profile photos are private to members, so each one is shown through a link that lasts an hour.
const photoCache = new Map();
export async function photoUrls(paths) {
  const now = Date.now();
  const need = [...new Set(paths.filter(Boolean))].filter((p) => !(photoCache.get(p)?.until > now));
  if (need.length) {
    try {
      const { data } = await sb.storage.from('avatars').createSignedUrls(need, 3600);
      (data || []).forEach((d) => { if (d.signedUrl) photoCache.set(d.path, { url: d.signedUrl, until: now + 3300 * 1000 }); });
    } catch { /* show initials instead */ }
  }
  return (p) => (p && photoCache.get(p)?.url) || '';
}

export function avatar(card, url, size = 'md') {
  const dot = card.live ? '<span class="pdot live" title="Training live now"></span>' : card.online ? '<span class="pdot" title="Online now"></span>' : '';
  return `<span class="pic ${size}">${url ? `<img src="${esc(url)}" alt="" loading="lazy">` : `<span>${esc(ini(card.display_name || card.name || ''))}</span>`}${dot}</span>`;
}

export function placeOf(c) { return [c.area, c.state].filter(Boolean).join(', '); }

export function seen(c) {
  if (c.live) return 'Training live now';
  if (c.online) return 'Online now';
  if (!c.last_active) return '';
  const min = Math.round((Date.now() - new Date(c.last_active).getTime()) / 60000);
  if (min < 60) return `Active ${min} min ago`;
  if (min < 1440) return `Active ${Math.round(min / 60)} h ago`;
  const d = Math.round(min / 1440);
  return d < 30 ? `Active ${d} ${d === 1 ? 'day' : 'days'} ago` : '';
}
