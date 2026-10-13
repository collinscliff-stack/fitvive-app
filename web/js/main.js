// Starts the app: login state, routing, the menu, and click and form handling.
import { configured, sb, S, uid, app, $, esc, toast, q, fn, icon, menu, friendly } from './core.js';
import { views as publicViews } from './public.js';
import { views as memberViews } from './member.js';
import { views as roomViews } from './room.js';
import { views as staffViews } from './staff.js';
import { views as socialViews } from './social.js';

const VIEWS = { ...publicViews, ...memberViews, ...roomViews, ...staffViews, ...socialViews };
const main = $('#main');
const cur = { key: '', params: [], data: null, cleanup: null, token: 0 };

// ---------------------------------------------------------------- profile
async function loadProfile() {
  S.profile = null; S.access = false; S.company = null;
  if (!uid()) return;
  S.profile = await q(sb.from('profiles').select('*').eq('id', uid()).maybeSingle());
  if (S.profile?.status === 'approved') {
    S.access = !!(await q(sb.rpc('has_access', { p_user: uid() })));
    if (S.profile.company_id) S.company = await q(sb.from('companies').select('*').eq('id', S.profile.company_id).maybeSingle());
  }
}

// ---------------------------------------------------------------- routing
function resolve() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  let key = parts[0] || '';
  let params = parts.slice(1);
  if (key === 'admin') { key = 'admin-' + (parts[1] || 'applications'); params = parts.slice(2); }
  if (!configured) return ['setup', []];
  if (key === 'legal') return ['legal', params];
  if (S.recovery && S.session) return ['newpassword', []];
  if (!S.session) return [['landing', 'apply', 'login'].includes(key) ? key : 'landing', params];
  if (!S.profile) return ['noprofile', []];
  if (S.profile.status !== 'approved') return ['onboarding', []];
  const v = VIEWS[key];
  const role = S.profile.role;
  if (!v || v.access !== 'member' && v.access !== 'trainer' && v.access !== 'admin') return ['home', []];
  if (v.access === 'admin' && role !== 'admin') return ['home', []];
  if (v.access === 'trainer' && role !== 'trainer' && role !== 'admin') return ['home', []];
  return [key, params];
}

function drawChrome() {
  const approved = !!(S.session && S.profile?.status === 'approved' && !S.recovery);
  const here = location.hash.replace(/^#\/?/, '') || (approved ? 'home' : '');
  // A conversation belongs under Messages, a member's profile under Members.
  const tabHere = here.replace(/^chat(\/|$)/, 'messages$1').replace(/^member\//, 'members/');
  const at = (route) => (tabHere === route || tabHere.startsWith(route + '/') ? 'aria-current="page"' : '');
  const items = approved ? menu() : [];

  // side menu on wide screens
  const badge = (m) => (m.badge && S.unread ? `<span class="badge">${S.unread > 99 ? '99+' : S.unread}</span>` : '');
  $('#nav').innerHTML = items.map((m) => (m.group
    ? `<div class="navlabel">${m.group}</div>`
    : `<a href="#/${m.route}" ${at(m.route)}>${icon(m.icon)}${m.label}${badge(m)}</a>`)).join('');

  // bottom tab bar on phones: four main screens, and More for the rest
  const tabs = items.filter((m) => m.tab);
  const inMore = approved && !tabs.some((m) => tabHere === m.route || tabHere.startsWith(m.route + '/')) && !/^(room|call)\b/.test(here);
  $('#tabbar').innerHTML = approved
    ? tabs.map((m) => `<a class="tab" href="#/${m.route}" ${at(m.route)}>${icon(m.icon)}${m.label}${badge(m)}</a>`).join('')
      + `<a class="tab" href="#/more" ${inMore ? 'aria-current="page"' : ''}>${icon('grid')}More</a>`
    : '';
  document.body.dataset.tabs = approved ? '1' : '0';
  document.body.dataset.route = cur.key;

  const name = S.profile?.full_name || S.session?.user?.email || '';
  const initials = name.trim().split(/\s+/).map((w) => w[0] || '').join('').slice(0, 2).toUpperCase() || '?';
  $('#topright').innerHTML = S.session
    ? (approved
      ? `<a class="chip" href="#/profile" aria-label="Profile of ${esc(name)}"><span class="who wide-only">${esc(name)}</span><span class="dot" aria-hidden="true">${esc(initials)}</span></a><button class="btn sm wide-only" data-act="signout">Log out</button>`
      : '<button class="btn sm" data-act="signout">Log out</button>')
    : (configured ? '<a class="btn sm" href="#/login">Log in</a>' : '');
  drawBanner();
}

function drawBanner() {
  const out = [];
  if (S.invite) {
    out.push(`<div class="banner"><span class="grow">${esc(S.invite.name)} is inviting you to work out together.</span><a class="btn sm" href="#/call/${S.invite.callId}" data-act="clearInvite" data-follow="1">Join</a><button class="btn sm" data-act="clearInvite">Not now</button></div>`);
  }
  const approved = S.session && S.profile?.status === 'approved';
  if (approved && !S.access && cur.key !== 'membership' && cur.key !== 'company') {
    out.push('<div class="banner"><span class="grow">Your membership is not active, so you cannot join rooms yet.</span><a class="btn sm" href="#/membership">Open Membership</a></div>');
  }
  $('#banner').innerHTML = out.join('');
}

function snapshotInputs() {
  const values = {};
  main.querySelectorAll('input[id],textarea[id],select[id]').forEach((el) => {
    if (el.type === 'file') return;
    values[el.id] = el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value;
  });
  return { values, focus: document.activeElement?.id || '' };
}
function restoreInputs(snap) {
  for (const [id, v] of Object.entries(snap.values)) {
    const el = document.getElementById(id);
    if (!el || el.dataset.fresh !== undefined) continue;
    if (el.type === 'checkbox' || el.type === 'radio') el.checked = v; else el.value = v;
  }
  if (snap.focus) document.getElementById(snap.focus)?.focus();
}

async function show({ keep = false } = {}) {
  const [key, params] = resolve();
  const my = ++cur.token;
  const same = keep && key === cur.key;
  const snap = same ? snapshotInputs() : null;
  if (cur.cleanup && !same) { try { cur.cleanup(); } catch { /* ignore */ } cur.cleanup = null; }
  cur.key = key; cur.params = params;
  drawChrome();
  const view = VIEWS[key];
  main.classList.remove('enter');
  if (!same) main.innerHTML = '<p class="note">Loading…</p>';
  let data;
  try { data = view.load ? await view.load(params) : {}; }
  catch (e) {
    if (my !== cur.token) return;
    main.innerHTML = `<section class="card"><h3>This screen could not load</h3><p class="meta">${esc(friendly(e.message))}</p><div class="row"><button class="btn sm" data-act="retry">Try again</button></div></section>`;
    return;
  }
  if (my !== cur.token) return;
  cur.data = data;
  main.innerHTML = view.render(data, params);
  if (!same) { void main.offsetWidth; main.classList.add('enter'); }
  if (snap) restoreInputs(snap);
  if (!same) {
    window.scrollTo(0, 0);
    if (view.mount) cur.cleanup = view.mount(data, params) || null;
  } else if (view.remount) view.remount(data, params);
  drawBanner();
}

app.refresh = () => show({ keep: true });
app.reloadProfile = async () => { await loadProfile(); await show({ keep: true }); };

// ---------------------------------------------------------------- clicks, forms, changes
const GLOBAL = {
  async signout() { await sb.auth.signOut(); },
  retry() { return show(); },
  clearInvite(el) { S.invite = null; drawBanner(); if (el.dataset.follow) location.hash = el.getAttribute('href'); },
};

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  e.preventDefault();
  const handler = GLOBAL[el.dataset.act] || VIEWS[cur.key]?.actions?.[el.dataset.act];
  if (!handler || el.disabled) return;
  if ('disabled' in el) el.disabled = true;
  try { await handler(el, cur.data); }
  catch (err) { toast(friendly(err.message)); }
  finally { if (el.isConnected && 'disabled' in el) el.disabled = false; }
});

document.addEventListener('submit', async (e) => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  const handler = VIEWS[cur.key]?.forms?.[form.dataset.form];
  if (!handler) return;
  const btn = form.querySelector('[type=submit]');
  if (btn?.disabled) return;
  if (btn) btn.disabled = true;
  try { await handler(form, cur.data); }
  catch (err) { toast(friendly(err.message)); }
  finally { if (btn?.isConnected) btn.disabled = false; }
});

document.addEventListener('change', async (e) => {
  const el = e.target.closest('[data-change]');
  if (!el) return;
  const handler = VIEWS[cur.key]?.changes?.[el.dataset.change];
  if (!handler) return;
  try { await handler(el, cur.data); } catch (err) { toast(friendly(err.message)); }
});

window.addEventListener('hashchange', () => show());

// Every tap answers with a spread of light from the point touched, and a light buzz on phones that support it.
document.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.btn, .nav a, .tab, .rowlink, .tilelink, .flag');
  if (!el || el.disabled) return;
  const r = el.getBoundingClientRect();
  const d = Math.max(r.width, r.height) * 2.2;
  const s = document.createElement('span');
  s.className = 'ripple';
  s.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
  el.appendChild(s);
  s.addEventListener('animationend', () => s.remove());
  setTimeout(() => s.remove(), 900);
  try { navigator.vibrate?.(8); } catch { /* not supported */ }
}, { passive: true });

// ---------------------------------------------------------------- workout invites from partners
let inviteChannel = null;
function watchInvites() {
  if (inviteChannel) { sb.removeChannel(inviteChannel); inviteChannel = null; }
  if (!uid() || S.profile?.status !== 'approved') return;
  inviteChannel = sb.channel('invites-' + uid())
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'partner_calls', filter: `to_id=eq.${uid()}` }, async (payload) => {
      const call = payload.new;
      let name = 'A partner';
      try { name = (await q(sb.from('member_cards').select('display_name').eq('id', call.from_id).maybeSingle()))?.display_name || name; } catch { /* keep default */ }
      S.invite = { callId: call.id, name };
      drawBanner();
    })
    .subscribe();
}

// ---------------------------------------------------------------- online status and new messages
let presenceTimer = 0;
let dmChannel = null;
async function countUnread() {
  try { S.unread = await q(sb.rpc('unread_count')) || 0; } catch { S.unread = 0; }
  drawChrome();
}
app.unread = countUnread;
function watchSocial() {
  clearInterval(presenceTimer);
  if (dmChannel) { sb.removeChannel(dmChannel); dmChannel = null; }
  S.unread = 0;
  if (!uid() || S.profile?.status !== 'approved') return;
  const ping = () => { if (document.visibilityState === 'visible') sb.rpc('touch').then(() => {}, () => {}); };
  ping();
  presenceTimer = setInterval(ping, 60000);
  countUnread();
  dmChannel = sb.channel('dm-in-' + uid())
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages', filter: `recipient_id=eq.${uid()}` }, async (p) => {
      const inThisChat = cur.key === 'chat' && cur.params[0] === p.new.sender_id;
      if (!inThisChat) {
        let name = 'A member';
        try { name = (await q(sb.from('member_cards').select('display_name').eq('id', p.new.sender_id).maybeSingle()))?.display_name || name; } catch { /* keep default */ }
        if (cur.key !== 'messages') toast(`New message from ${name}`);
      }
      countUnread();
    })
    .subscribe();
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.profile?.status === 'approved') sb.rpc('touch').then(() => {}, () => {}); });

// ---------------------------------------------------------------- returning from Paystack
async function finishPayment() {
  const params = new URLSearchParams(location.search);
  const reference = params.get('reference') || params.get('trxref');
  if (!reference || !S.session) return;
  history.replaceState(null, '', location.pathname + '#/membership');
  try {
    await fn('paystack-verify', { reference });
    await loadProfile();
    toast('Payment received. Your access is active.');
  } catch (err) { toast(friendly(err.message)); }
}

// ---------------------------------------------------------------- start
async function start() {
  if (!configured) { await show(); return; }
  const { data } = await sb.auth.getSession();
  S.session = data.session;
  try { await loadProfile(); } catch (err) { toast(friendly(err.message)); }
  await finishPayment();
  watchInvites(); watchSocial();
  await show();

  sb.auth.onAuthStateChange((event, session) => {
    const changed = (session?.user?.id || null) !== uid();
    if (event === 'PASSWORD_RECOVERY') S.recovery = true;
    S.session = session;
    if (!changed && event !== 'PASSWORD_RECOVERY') return;
    // Supabase asks that no database calls run inside this callback, so defer them.
    setTimeout(async () => {
      try { await loadProfile(); } catch (err) { toast(friendly(err.message)); }
      watchInvites(); watchSocial();
      if (!session && location.hash !== '#/') { location.hash = '#/'; return; }
      if (session && ['', '#/', '#/login', '#/apply'].includes(location.hash)) { location.hash = '#/home'; return; }
      await show();
    }, 0);
  });
}

start();
