// Member screens: home, timetable, games, partners, ranking, membership and settings.
import { hm } from './core.js';
import { sb, S, uid, app, $, esc, toast, q, fn, go, head, emptyRow, sessionRow, sessionState, loadSessions, fmtDay, fmtTime, fmtDate, naira, dayKey, TYPE_LABEL, icon, menu, canHost } from './core.js';
import { setPendingCall } from './room.js';

const ui = { filter: 'all', sel: null, found: null, plan: 'monthly' };
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

// ---------------------------------------------------------------- table tennis practice
let raf = 0;
const cssVar = (k) => getComputedStyle(document.documentElement).getPropertyValue(k).trim();
function paintTable(x, W, H, ball, me, cpu) {
  x.clearRect(0, 0, W, H);
  x.strokeStyle = cssVar('--line'); x.lineWidth = 2; x.strokeRect(14, 14, W - 28, H - 28);
  x.beginPath(); x.moveTo(14, H / 2); x.lineTo(W - 14, H / 2); x.stroke();
  x.fillStyle = cssVar('--ember'); x.fillRect(cpu - 30, 14, 60, 8);
  x.fillStyle = cssVar('--gold'); x.fillRect(me - 30, H - 22, 60, 8);
  x.fillStyle = cssVar('--ivory'); x.beginPath(); x.arc(ball.x, ball.y, 6, 0, 7); x.fill();
}
function startRally() {
  const c = $('#pong'); if (!c) return;
  const x = c.getContext('2d'), W = c.width, H = c.height;
  let ball, me = W / 2, cpu = W / 2; const score = [0, 0];
  const serve = (dir) => { ball = { x: W / 2, y: H / 2, vx: (Math.random() - 0.5) * 3, vy: 3 * dir }; };
  serve(1);
  const move = (e) => { const r = c.getBoundingClientRect(); me = Math.max(44, Math.min(W - 44, ((e.clientX - r.left) / r.width) * W)); };
  c.onpointermove = move; c.onpointerdown = move;
  cancelAnimationFrame(raf);
  (function loop() {
    if (!document.body.contains(c)) return;
    ball.x += ball.vx; ball.y += ball.vy;
    if (ball.x < 20) { ball.x = 20; ball.vx = Math.abs(ball.vx); } else if (ball.x > W - 20) { ball.x = W - 20; ball.vx = -Math.abs(ball.vx); }
    cpu += Math.max(-2.4, Math.min(2.4, ball.x - cpu));
    if (ball.vy < 0 && ball.y < 28 && Math.abs(ball.x - cpu) < 36) { ball.vy *= -1; ball.y = 28; }
    if (ball.vy > 0 && ball.y > H - 28 && Math.abs(ball.x - me) < 36) {
      ball.vy = -Math.min(6, ball.vy * 1.05); ball.vx = Math.max(-4.5, Math.min(4.5, ball.vx + (ball.x - me) * 0.08)); ball.y = H - 28;
    }
    if (ball.y < 0) { score[0]++; serve(1); } else if (ball.y > H) { score[1]++; serve(-1); }
    const s = $('#score'); if (s) s.textContent = `You ${score[0]} · ${score[1]} Computer`;
    paintTable(x, W, H, ball, me, cpu);
    raf = requestAnimationFrame(loop);
  })();
}

// ---------------------------------------------------------------- partners data
async function loadPartners() {
  const me = uid();
  const pts = await q(sb.from('partnerships').select('*').or(`a.eq.${me},b.eq.${me}`).order('created_at'));
  const others = pts.map((p) => (p.a === me ? p.b : p.a));
  const names = {};
  if (others.length) (await q(sb.from('member_cards').select('id,display_name').in('id', others))).forEach((c) => { names[c.id] = c.display_name; });
  const withName = pts.map((p) => { const other = p.a === me ? p.b : p.a; return { ...p, other, name: names[other] || 'Member' }; });
  const partners = withName.filter((p) => p.status === 'accepted');
  if (!partners.some((p) => p.id === ui.sel)) ui.sel = partners[0]?.id || null;
  let goals = [], checkins = [], messages = [];
  if (ui.sel) {
    goals = await q(sb.from('goals').select('*').eq('partnership_id', ui.sel).order('created_at'));
    if (goals.length) checkins = await q(sb.from('goal_checkins').select('*').in('goal_id', goals.map((g) => g.id)));
    messages = (await q(sb.from('messages').select('*').eq('partnership_id', ui.sel).order('created_at', { ascending: false }).limit(60))).reverse();
  }
  return {
    partners, goals, checkins, messages,
    incoming: withName.filter((p) => p.status === 'pending' && p.requested_by !== me),
    outgoing: withName.filter((p) => p.status === 'pending' && p.requested_by === me),
    knownIds: new Set(others),
  };
}

export const views = {
  // ---------------------------------------------------------------- home
  home: {
    access: 'member',
    load: async () => ({
      sessions: await loadSessions(startOfToday(), addDays(startOfToday(), 2)),
      stats: await q(sb.rpc('my_stats')),
    }),
    render: ({ sessions, stats }) => {
      const open = sessions.filter((s) => sessionState(s) !== 'ended');
      const next = open.find((s) => ['live', 'open'].includes(sessionState(s))) || open[0];
      const st = next ? sessionState(next) : '';
      const joinable = st === 'live' || st === 'open';
      const first = esc((S.profile.full_name || '').split(' ')[0]);
      const hero = next
        ? `<section class="card glow hero"><div class="row">${st === 'live' ? '<span class="tag live">Live now</span>' : `<span class="eyebrow">${st === 'open' ? 'Starting soon' : 'Next session'}</span>`}</div><h2>${esc(next.title)} with <i>${esc(next.trainer_name)}</i></h2><p class="lede">${fmtDay(next.starts_at)}, ${fmtTime(next.starts_at)}. ${next.duration_min} minutes.</p><div class="row">${joinable || canHost(next) ? `<a class="btn gold" href="#/room/${next.id}">${icon('play')}${joinable ? 'Join the room' : 'Open the room'}</a>` : ''}<a class="btn" href="#/timetable">${icon('calendar')}See the timetable</a></div></section>`
        : `<section class="card glow hero">${head('Welcome' + (first ? ', ' + first : ''), 'No sessions are <i>scheduled</i> yet.', 'The club is setting up the timetable. Check back soon.')}</section>`;
      const today = sessions.filter((s) => dayKey(s.starts_at) === dayKey(new Date()));
      const staff = ['admin', 'trainer'].includes(S.profile.role);
      const left = S.profile.seconds_left || 0;
      const timeCard = (S.timeBilling || left > 0) && !staff
        ? `<section class="card ${left < 3600 ? 'glow' : ''}"><div class="row"><span class="grow"><span class="eyebrow">Training time left</span><br><span class="bigtime">${hm(left)}</span></span>${left < 3600 ? '<a class="btn gold sm" href="#/membership">Top up</a>' : ''}</div><p class="meta">Live sessions use your time minute by minute. Messages, partners and rankings are free.</p></section>` : '';
      return `${hero}
${timeCard}
<section class="cols quad">
<div class="card stat">${icon('flame')}<div class="num">${stats.streak}</div><h3>${stats.streak === 1 ? 'day' : 'days'} in a row</h3><p class="meta">${stats.streak ? 'Train today to keep it going.' : 'Join a session to start your streak.'}</p></div>
<div class="card stat">${icon('trophy')}<div class="num">${stats.rank ? ordinal(stats.rank) : stats.minutes}</div><h3>${stats.rank ? 'place this week' : 'minutes this week'}</h3><p class="meta">${stats.rank ? stats.minutes + ' minutes trained. ' : ''}<a href="#/ranking">See the ranking</a></p></div>
<a class="card stat tilelink" href="#/games">${icon('bolt')}<h3>Play a quick game</h3><p class="meta">A few minutes is enough.</p></a>
<a class="card stat tilelink" href="#/partners">${icon('users')}<h3>Train with a partner</h3><p class="meta">Side by side on video.</p></a>
</section>
<section class="card"><h3>Today</h3><ul class="list">${today.map(sessionRow).join('') || emptyRow('No sessions today.')}</ul></section>`;
    },
    // Re-check every 30 seconds so the Join button appears the moment a session opens.
    mount: () => { const t = setInterval(() => app.refresh(), 30000); return () => clearInterval(t); },
  },

  // ---------------------------------------------------------------- timetable
  timetable: {
    access: 'member',
    load: async () => ({ sessions: await loadSessions(startOfToday(), addDays(startOfToday(), 7)) }),
    render: ({ sessions }) => {
      const rows = sessions.filter((s) => (ui.filter === 'all' || s.type === ui.filter) && (!S.profile.women_only_pref || s.women_only));
      const days = {};
      rows.forEach((s) => { (days[dayKey(s.starts_at)] ||= []).push(s); });
      const chips = ['all', ...Object.keys(TYPE_LABEL)].map((t) => `<button class="btn sm" aria-pressed="${ui.filter === t}" data-act="filter" data-t="${t}">${t === 'all' ? 'All' : TYPE_LABEL[t]}</button>`).join('');
      const body = Object.keys(days).map((k) => `<section class="card"><h3>${fmtDay(days[k][0].starts_at)}</h3><ul class="list">${days[k].map(sessionRow).join('')}</ul></section>`).join('');
      return `${head('Timetable', 'Pick a session', 'Join opens 5 minutes before the start. The next 7 days are shown.')}<div class="row">${chips}</div>${body || `<section class="card"><p class="meta">No sessions match.${S.profile.women_only_pref ? ' You are showing women-only sessions only. Change this in Settings.' : ''}</p></section>`}`;
    },
    actions: { filter(el) { ui.filter = el.dataset.t; return app.refresh(); } },
    mount: () => { const t = setInterval(() => app.refresh(), 30000); return () => clearInterval(t); },
  },

  // ---------------------------------------------------------------- games
  games: {
    access: 'member',
    render: () => `${head('Games', 'A match in <i>five minutes.</i>', 'For the days you cannot fit a full workout.')}
<section class="card"><div class="row"><div class="grow"><h3>Table tennis practice</h3><p class="meta">Drag across the table to move your bat. Matches against other members come later.</p></div><span class="it" id="score">You 0 · 0 Computer</span></div><canvas id="pong" width="300" height="420" aria-label="Table tennis practice"></canvas><div class="row"><button class="btn gold sm" data-act="rally">Start a rally</button></div></section>
<section class="cols">${['Virtual tennis', 'Pickleball', 'Padel'].map((g) => `<div class="card"><h3>${g}</h3><p class="meta">Comes after launch.</p><span><span class="tag">Coming later</span></span></div>`).join('')}</section>`,
    mount: () => {
      const c = $('#pong');
      if (c) paintTable(c.getContext('2d'), c.width, c.height, { x: c.width / 2, y: c.height / 2 }, c.width / 2, c.width / 2);
      return () => cancelAnimationFrame(raf);
    },
    actions: { rally: startRally },
  },

  // ---------------------------------------------------------------- partners
  partners: {
    access: 'member',
    load: loadPartners,
    render: (d) => {
      const me = uid();
      const sel = d.partners.find((p) => p.id === ui.sel);
      const today = dayKey(new Date());
      const found = ui.found
        ? `<ul class="list">${ui.found.filter((c) => c.id !== me).map((c) => `<li class="item"><span class="it grow">${esc(c.display_name)}</span>${d.knownIds.has(c.id) ? '<span class="meta">Already on your list</span>' : `<button class="btn gold sm" data-act="add" data-id="${c.id}">Ask to partner</button>`}</li>`).join('') || emptyRow('No member with that name.')}</ul>` : '';
      const requests = d.incoming.length || d.outgoing.length
        ? `<section class="card"><h3>Requests</h3><ul class="list">${d.incoming.map((p) => `<li class="item"><span class="grow"><span class="it">${esc(p.name)}</span> wants to be your workout partner</span><button class="btn gold sm" data-act="respond" data-id="${p.id}" data-yes="1">Accept</button><button class="btn sm" data-act="respond" data-id="${p.id}">Decline</button></li>`).join('')}${d.outgoing.map((p) => `<li class="item"><span class="grow"><span class="it">${esc(p.name)}</span> has not answered yet</span><button class="btn sm" data-act="unpartner" data-id="${p.id}">Cancel</button></li>`).join('')}</ul></section>` : '';
      const list = `<section class="card"><h3>Your partners</h3><ul class="list">${d.partners.map((p) => `<li class="item"><span class="it grow">${esc(p.name)}</span><button class="btn gold sm" data-act="call" data-id="${p.id}">Start workout</button><button class="btn sm" aria-pressed="${p.id === ui.sel}" data-act="select" data-id="${p.id}">Goals and chat</button></li>`).join('') || emptyRow('No partners yet. Find a member above and ask them.')}</ul></section>`;
      let panel = '';
      if (sel) {
        const goals = d.goals.map((g) => {
          const mine = d.checkins.filter((c) => c.goal_id === g.id && c.user_id === me);
          const theirs = d.checkins.filter((c) => c.goal_id === g.id && c.user_id !== me);
          const done = mine.some((c) => c.day === today);
          return `<div class="stack" style="gap:8px"><div class="row"><span class="grow"><span class="it">${esc(g.title)}</span><br><span class="meta">You ${mine.length} · ${esc(sel.name)} ${theirs.length} of ${g.target_days} days</span></span><button class="btn sm" aria-pressed="${done}" data-act="checkin" data-id="${g.id}" data-done="${done ? 1 : ''}">${done ? 'Done today' : 'Mark today done'}</button><button class="btn sm bad" data-act="delgoal" data-id="${g.id}">Remove</button></div><div class="prog"><div style="width:${Math.min(100, Math.round((mine.length / g.target_days) * 100))}%"></div></div></div>`;
        }).join('');
        panel = `<section class="card"><h3>Shared goals with ${esc(sel.name)}</h3>${goals || '<p class="meta">No goals yet. Set one below.</p>'}
<form class="row" data-form="goal"><div class="field"><label for="gl-title">New goal</label><input type="text" id="gl-title" placeholder="100 press-ups a day" maxlength="140"></div><div class="field" style="flex:0 1 120px"><label for="gl-days">Days</label><input type="number" id="gl-days" value="30" min="1" max="366"></div><button class="btn gold sm" type="submit" style="align-self:flex-end">Add goal</button></form></section>
<section class="card"><h3>Chat with ${esc(sel.name)}</h3><div class="stack" id="chatbox" style="gap:8px;max-height:340px;overflow-y:auto">${d.messages.map((m) => `<div class="bubble ${m.sender_id === me ? 'me' : ''}">${esc(m.body)}</div>`).join('') || '<p class="meta">No messages yet. Say hello.</p>'}</div>
<form class="row" data-form="chat"><div class="field"><label for="ch-msg" class="meta">Message</label><input type="text" id="ch-msg" autocomplete="off" maxlength="1000"></div><button class="btn gold sm" type="submit" style="align-self:flex-end">Send</button></form>
<div class="row"><button class="btn sm bad" data-act="unpartner" data-id="${sel.id}">Stop being partners</button></div></section>`;
      }
      return `${head('Partners', 'Train with <i>someone.</i>')}
<section class="card"><h3>Find a member</h3><form class="row" data-form="find"><div class="field"><label for="pf-name" class="meta">First name</label><input type="text" id="pf-name" autocomplete="off"></div><button class="btn sm" type="submit" style="align-self:flex-end">Search</button></form>${found}</section>
${requests}${list}${panel}`;
    },
    mount: () => {
      const scroll = () => { const b = $('#chatbox'); if (b) b.scrollTop = b.scrollHeight; };
      scroll();
      const ch = sb.channel('partners-' + uid())
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (p) => { if (p.new.partnership_id === ui.sel && p.new.sender_id !== uid()) app.refresh(); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'partnerships' }, () => app.refresh())
        .subscribe();
      return () => sb.removeChannel(ch);
    },
    remount: () => { const b = $('#chatbox'); if (b) b.scrollTop = b.scrollHeight; },
    forms: {
      async find() {
        const name = $('#pf-name').value.trim().replace(/[%,()]/g, '');
        if (name.length < 2) throw new Error('Type at least 2 letters of their first name.');
        ui.found = await q(sb.from('member_cards').select('id,display_name').ilike('display_name', name + '%').limit(12));
        await app.refresh();
      },
      async goal() {
        const title = $('#gl-title').value.trim();
        if (title.length < 2) throw new Error('Describe the goal first.');
        const days = Math.max(1, Math.min(366, parseInt($('#gl-days').value, 10) || 30));
        await q(sb.from('goals').insert({ partnership_id: ui.sel, title, target_days: days, created_by: uid() }));
        $('#gl-title').value = '';
        await app.refresh();
      },
      async chat() {
        const body = $('#ch-msg').value.trim();
        if (!body) return;
        await q(sb.from('messages').insert({ partnership_id: ui.sel, sender_id: uid(), body }));
        $('#ch-msg').value = '';
        await app.refresh();
        $('#ch-msg')?.focus();
      },
    },
    actions: {
      async add(el) { await q(sb.rpc('request_partner', { p_other: el.dataset.id })); toast('Request sent.'); ui.found = null; await app.refresh(); },
      async respond(el) { await q(sb.rpc('respond_partner', { p_id: el.dataset.id, p_accept: !!el.dataset.yes })); await app.refresh(); },
      async unpartner(el) { await q(sb.from('partnerships').delete().eq('id', el.dataset.id)); if (ui.sel === el.dataset.id) ui.sel = null; await app.refresh(); },
      select(el) { ui.sel = el.dataset.id; return app.refresh(); },
      async call(el) {
        const pass = await fn('video-token', { kind: 'partner', partnershipId: el.dataset.id });
        setPendingCall(pass);
        go('call/' + pass.callId);
      },
      async checkin(el) {
        const row = { goal_id: el.dataset.id, user_id: uid(), day: dayKey(new Date()) };
        if (el.dataset.done) await q(sb.from('goal_checkins').delete().match(row));
        else await q(sb.from('goal_checkins').insert(row));
        await app.refresh();
      },
      async delgoal(el) { await q(sb.from('goals').delete().eq('id', el.dataset.id)); await app.refresh(); },
    },
  },

  // ---------------------------------------------------------------- more (the rest of the menu, on phones)
  more: {
    access: 'member',
    render: () => {
      const groups = [{ label: '', rows: [] }];
      menu().filter((m) => !m.tab).forEach((m) => { if (m.group) groups.push({ label: m.group, rows: [] }); else groups[groups.length - 1].rows.push(m); });
      return `${head(esc(S.profile.full_name), 'More')}${groups.map((g) => `<section class="card">${g.label ? `<h3>${g.label}</h3>` : ''}<div class="list">${g.rows.map((m) => `<a class="rowlink" href="#/${m.route}">${icon(m.icon)}${m.label}</a>`).join('')}</div></section>`).join('')}
<section class="card"><button class="rowlink" data-act="signout">${icon('logout')}Log out</button></section>`;
    },
  },

  // ---------------------------------------------------------------- ranking
  ranking: {
    access: 'member',
    load: async () => ({ rows: await q(sb.rpc('weekly_ranking')) }),
    render: ({ rows }) => `${head('Ranking', 'This week at <i>the club.</i>', 'Minutes trained in live sessions since Monday.')}<section class="card">${rows.length
      ? `<div class="tw"><table><thead><tr><th>Place</th><th>Member</th><th>Minutes</th><th>Streak</th></tr></thead><tbody>${rows.map((r, i) => `<tr><td>${i + 1}</td><td class="${r.user_id === uid() ? 'it' : ''}">${r.user_id === uid() ? 'You' : esc(r.display_name)}</td><td>${r.minutes}</td><td>${r.streak} ${r.streak === 1 ? 'day' : 'days'}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="meta">Nobody has trained yet this week. Join a session and take first place.</p>'}</section>`,
  },

  // ---------------------------------------------------------------- membership
  membership: {
    access: 'member',
    load: async () => ({
      plans: await q(sb.from('plans').select('*')),
      sub: await q(sb.from('subscriptions').select('*').eq('user_id', uid()).maybeSingle()),
      access: (await q(sb.from('app_settings').select('value').eq('key', 'access').maybeSingle()))?.value || {},
    }),
    render: ({ plans, sub, access }) => {
      const plan = (k) => plans.find((p) => p.key === k) || { amount_kobo: 0 };
      const subActive = sub && new Date(sub.current_period_end) > new Date();
      const coActive = S.company?.active_until && new Date(S.company.active_until) > new Date();
      let status;
      if (['admin', 'trainer'].includes(S.profile.role)) status = ['Staff access', 'Trainers and admins do not pay.'];
      else if (S.timeBilling && !coActive) status = (S.profile.seconds_left || 0) > 0 ? ['Active', `You have ${hm(S.profile.seconds_left)} of training time left.`] : ['Not active', 'You have no training time left. Ask the club to add minutes.'];
      else if (subActive) status = ['Active', `Your ${esc(sub.plan_key || '')} membership runs until ${fmtDate(sub.current_period_end)}.`];
      else if (coActive) status = ['Covered by your company', `${esc(S.company.name)} pays for your seat until ${fmtDate(S.company.active_until)}.`];
      else if (access.free_access) status = ['Free access', 'The club has not switched on paid membership yet, so every approved member can join.'];
      else status = ['Not active', 'Pay below to join live rooms.'];
      const feesSet = plan('monthly').amount_kobo > 0 || plan('yearly').amount_kobo > 0;
      const card = (k, label, note) => `<div class="card"><div class="eyebrow">${label}</div><h2>${plan(k).amount_kobo > 0 ? naira(plan(k).amount_kobo) : 'Not set'}</h2><p class="meta">${note}</p><button class="btn sm ${ui.plan === k ? 'gold' : ''}" aria-pressed="${ui.plan === k}" data-act="plan" data-t="${k}" ${plan(k).amount_kobo > 0 ? '' : 'disabled'}>${ui.plan === k ? 'Selected' : 'Choose ' + label.toLowerCase()}</button></div>`;
      return `${head('Membership', 'Your <i>plan.</i>')}
<section class="card"><div class="row"><span class="tag ${status[0] === 'Not active' ? 'bad' : 'ok'}">${status[0]}</span><span class="grow">${status[1]}</span></div></section>
<section class="cols">${card('monthly', 'Monthly', 'Billed every month.')}${card('yearly', 'Yearly', 'One payment for the year.')}</section>
<section class="card"><h3>Payment</h3>${feesSet
        ? `<form class="stack" data-form="pay"><div class="field" style="flex:none;max-width:320px"><label for="pm-code">Founding member code (optional)</label><input type="text" id="pm-code" autocomplete="off"></div><div class="row"><button class="btn gold" type="submit">Pay ${plan(ui.plan).amount_kobo > 0 ? naira(plan(ui.plan).amount_kobo) : ''} with Paystack</button></div><p class="meta">You pay on Paystack's secure page and come straight back here.</p></form>`
        : '<p class="meta">The club has not set its fees yet.</p>'}</section>
<p class="note">Buying for your staff? <a href="#/company">Open Company</a>.</p>`;
    },
    actions: { plan(el) { ui.plan = el.dataset.t; return app.refresh(); } },
    forms: {
      async pay() {
        const r = await fn('paystack-init', { kind: 'member', plan: ui.plan, code: $('#pm-code').value.trim(), returnUrl: location.origin + location.pathname });
        if (r.free) { toast('Code accepted. Your access is active.'); await app.reloadProfile(); return; }
        location.href = r.url;
      },
    },
  },

  // ---------------------------------------------------------------- settings
  settings: {
    access: 'member',
    render: () => {
      const p = S.profile;
      const opt = (k, label) => `<label class="check" for="st-${k}"><input type="checkbox" id="st-${k}" data-change="pref" data-k="${k}" ${p[k] ? 'checked' : ''}><span>${label}</span></label>`;
      return `${head('Settings', 'How you <i>show up.</i>')}
<section class="card">${opt('cam_off_default', 'Join rooms with my camera off')}${opt('low_data', 'Low-data mode: the trainer and 2 members only')}${p.gender === 'female' ? opt('women_only_pref', 'Show women-only sessions only') : ''}</section>
<section class="card"><h3>Your details</h3><ul class="list"><li class="item"><span class="grow">Name</span><span class="meta">${esc(p.full_name)}</span></li><li class="item"><span class="grow">Email</span><span class="meta">${esc(p.email)}</span></li><li class="item"><span class="grow">Phone</span><span class="meta">${esc(p.phone)}</span></li></ul><p class="meta">Your name is locked to your ID. Ask the club to change it.</p></section>
<section class="card"><h3>Change password</h3><form class="row" data-form="password"><div class="field"><label for="st-pass" class="meta">New password (8 characters or more)</label><input type="password" id="st-pass" autocomplete="new-password"></div><button class="btn sm" type="submit" style="align-self:flex-end">Save</button></form></section>
<p class="note"><a href="#/legal/conduct">Code of conduct</a> · <a href="#/legal/privacy">Privacy</a> · <a href="#/legal/terms">Terms</a></p>`;
    },
    changes: {
      async pref(el) {
        const k = el.dataset.k;
        if (!['cam_off_default', 'low_data', 'women_only_pref'].includes(k)) return;
        await q(sb.from('profiles').update({ [k]: el.checked }).eq('id', uid()));
        S.profile[k] = el.checked;
        toast('Saved.');
      },
    },
    forms: {
      async password() {
        const p = $('#st-pass').value;
        if (p.length < 8) throw new Error('Use a password of 8 characters or more.');
        const { error } = await sb.auth.updateUser({ password: p });
        if (error) throw new Error(error.message);
        $('#st-pass').value = '';
        toast('Password changed.');
      },
    },
  },
};

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
