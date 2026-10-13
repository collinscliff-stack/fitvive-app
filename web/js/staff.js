// Screens for trainers, company admins and club admins.
import { sb, S, uid, app, $, esc, toast, q, fn, head, emptyRow, sessionRow, loadSessions, fmtTime, fmtDay, fmtDate, naira, cap, stop, TYPE_LABEL, youtubeId } from './core.js';

const ui = { viewing: null, search: '' };
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const typeOptions = Object.entries(TYPE_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
const statusTag = (st) => `<span class="tag ${st === 'approved' ? 'ok' : st === 'pending' ? 'warn' : 'bad'}">${cap(st)}</span>`;
const localInput = (d) => { const x = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return x.toISOString().slice(0, 16); };
const dateInput = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
// Today, a few minutes from now, on the next 5-minute mark. The default start for a new session.
const soon = () => { const d = new Date(Date.now() + 5 * 60000); d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0); return d; };

export const views = {
  // ---------------------------------------------------------------- trainer
  trainer: {
    access: 'trainer',
    load: async () => ({ sessions: (await loadSessions(startOfToday(), addDays(startOfToday(), 14))).filter((s) => s.trainer_id === uid()) }),
    render: ({ sessions }) => {
      const days = {};
      sessions.forEach((s) => { (days[fmtDay(s.starts_at)] ||= []).push(s); });
      const linkForm = (s) => `<li class="item"><form class="row grow" data-form="ytlink" data-id="${s.id}"><div class="field"><label for="yt-${s.id}" class="meta">YouTube video for this session (optional)</label><input type="text" id="yt-${s.id}" inputmode="url" autocomplete="off" placeholder="https://youtu.be/..." value="${esc(s.video_url || '')}"></div><button class="btn sm" type="submit" style="align-self:flex-end">Save video</button></form></li>`;
      return `${head('Trainer', 'Your <i>sessions.</i>', 'You can open a session before it starts. Members can join 5 minutes before. Add a YouTube video and members follow it, with or without your camera.')}${Object.keys(days).map((k) => `<section class="card"><h3>${k}</h3><ul class="list">${days[k].map((s) => sessionRow(s) + linkForm(s)).join('')}</ul></section>`).join('') || '<section class="card"><p class="meta">No sessions are assigned to you in the next 14 days.</p></section>'}`;
    },
    forms: {
      async ytlink(form) {
        const url = form.querySelector('input').value.trim();
        if (url && !youtubeId(url)) throw new Error('That is not a YouTube video link. Copy the link from the Share button on YouTube.');
        await q(sb.rpc('set_session_video', { p_session: form.dataset.id, p_url: url }));
        toast(url ? 'Video saved. Members will follow it in this session.' : 'Video removed.');
        await app.refresh();
      },
    },
  },

  // ---------------------------------------------------------------- company
  company: {
    access: 'member',
    load: async () => {
      const plans = await q(sb.from('plans').select('*'));
      if (!S.company || S.company.admin_id !== uid()) return { mine: false, plans };
      return {
        mine: true, plans,
        staff: await q(sb.rpc('company_staff')),
        sessions: (await loadSessions(startOfToday(), addDays(startOfToday(), 30))).filter((s) => s.company_id === S.company.id),
      };
    },
    render: (d) => {
      const price = (k) => { const p = d.plans.find((x) => x.key === k); return p && p.amount_kobo > 0 ? naira(p.amount_kobo) : 'not set'; };
      if (!d.mine) {
        if (S.company) return `<section class="card">${head('Company', `Covered by <i>${esc(S.company.name)}${stop(S.company.name)}</i>`, S.company.active_until ? `Your seat is paid until ${fmtDate(S.company.active_until)}.` : 'Your company has not paid for seats yet.')}</section>`;
        return `${head('Company', 'Fitness for <i>your staff.</i>', 'Buy seats for your team. Each person still applies with their ID and is approved by the club.')}
<section class="cols"><div class="card"><div class="eyebrow">Per seat, monthly</div><h2>${price('company_seat_monthly')}</h2></div><div class="card"><div class="eyebrow">Per seat, yearly</div><h2>${price('company_seat_yearly')}</h2></div></section>
<section class="card"><h3>Register your company</h3><form class="row" data-form="create"><div class="field"><label for="co-name">Company name</label><input type="text" id="co-name" maxlength="120"></div><button class="btn gold sm" type="submit" style="align-self:flex-end">Register</button></form><p class="meta">You become the company admin. Then you buy seats and invite staff by email.</p></section>`;
      }
      const c = S.company;
      const used = d.staff.length + 1;
      const active = c.active_until && new Date(c.active_until) > new Date();
      return `${head(esc(c.name), 'Staff <i>seats.</i>', `${used} of ${c.seats} seats used, counting yours. ${active ? `Paid until ${fmtDate(c.active_until)}.` : 'No active plan yet.'}`)}
<div class="prog"><div style="width:${c.seats ? Math.min(100, (used / c.seats) * 100) : 0}%"></div></div>
<section class="card"><h3>${active ? 'Renew or change seats' : 'Buy seats'}</h3><form class="row" data-form="buy"><div class="field" style="flex:0 1 140px"><label for="co-seats">Seats</label><input type="number" id="co-seats" min="1" max="5000" value="${Math.max(c.seats, used, 5)}"></div><div class="field"><label for="co-plan">Plan</label><select id="co-plan"><option value="monthly">Monthly, ${price('company_seat_monthly')} a seat</option><option value="yearly">Yearly, ${price('company_seat_yearly')} a seat</option></select></div><button class="btn gold sm" type="submit" style="align-self:flex-end">Pay with Paystack</button></form><p class="meta">Paying sets your seat count and adds one period to your plan.</p></section>
<section class="card"><h3>Invite staff</h3><form class="row" data-form="invite"><div class="field"><label for="co-email">Work email</label><input type="email" id="co-email"></div><button class="btn gold sm" type="submit" style="align-self:flex-end">Add to the list</button></form><p class="meta">Ask them to apply on Fitvive with this email. Their seat links up when they sign up.</p></section>
<section class="card"><h3>Staff</h3><ul class="list">${d.staff.map((p) => `<li class="item"><div class="grow"><div class="it">${esc(p.full_name || p.email)}</div><div class="meta">${esc(p.email)}</div></div><span class="tag ${p.status === 'joined' ? 'ok' : 'warn'}">${p.status === 'joined' ? (p.member_status === 'approved' ? 'Active' : 'Signed up, ' + esc(p.member_status || 'pending')) : 'Not signed up yet'}</span><button class="btn sm bad" data-act="removeStaff" data-id="${p.invite_id}">Remove</button></li>`).join('') || emptyRow('Nobody invited yet.')}</ul></section>
<section class="card"><h3>Private sessions</h3><ul class="list">${d.sessions.map(sessionRow).join('') || emptyRow('No private sessions booked.')}</ul>
<form class="row" data-form="book" style="align-items:flex-start"><div class="field"><label for="bk-title">Session name</label><input type="text" id="bk-title" maxlength="120"></div><div class="field" style="flex:0 1 150px"><label for="bk-type">Type</label><select id="bk-type">${typeOptions}</select></div><div class="field"><label for="bk-when">When</label><input type="datetime-local" id="bk-when" value="${localInput(addDays(new Date(), 1))}"></div><div class="field" style="flex:0 1 120px"><label for="bk-len">Minutes</label><select id="bk-len"><option>15</option><option>20</option><option>30</option></select></div><button class="btn gold sm" type="submit" style="align-self:flex-end">Book</button></form><p class="meta">Only your staff can join. The club assigns a trainer.</p></section>`;
    },
    forms: {
      async create() {
        const name = $('#co-name').value.trim();
        if (name.length < 2) throw new Error('Enter your company name.');
        await q(sb.rpc('create_company', { p_name: name }));
        toast('Company registered.');
        await app.reloadProfile();
      },
      async buy() {
        const r = await fn('paystack-init', { kind: 'company', plan: $('#co-plan').value, seats: parseInt($('#co-seats').value, 10), returnUrl: location.origin + location.pathname });
        location.href = r.url;
      },
      async invite() {
        await q(sb.rpc('company_invite', { p_email: $('#co-email').value.trim() }));
        $('#co-email').value = '';
        toast('Added. Ask them to apply with that email.');
        await app.refresh();
      },
      async book() {
        const title = $('#bk-title').value.trim();
        if (title.length < 2) throw new Error('Name the session first.');
        const when = new Date($('#bk-when').value);
        if (isNaN(when)) throw new Error('Pick a date and time.');
        await q(sb.rpc('book_company_session', { p_title: title, p_type: $('#bk-type').value, p_starts: when.toISOString(), p_duration: parseInt($('#bk-len').value, 10) }));
        $('#bk-title').value = '';
        toast('Private session booked.');
        await app.refresh();
      },
    },
    actions: {
      async removeStaff(el) { await q(sb.rpc('company_remove', { p_invite: el.dataset.id })); toast('Seat freed.'); await app.refresh(); },
    },
  },

  // ---------------------------------------------------------------- admin: applications
  'admin-applications': {
    access: 'admin',
    load: async () => {
      const rows = await q(sb.from('profiles').select('*').eq('status', 'pending').order('created_at'));
      const companies = {};
      const ids = [...new Set(rows.map((r) => r.company_id).filter(Boolean))];
      if (ids.length) (await q(sb.from('companies').select('id,name').in('id', ids))).forEach((c) => { companies[c.id] = c.name; });
      return { rows, companies };
    },
    render: ({ rows, companies }) => `${head('Club admin', 'Applications to <i>review.</i>', 'Nobody enters the club until you approve them. Check the name against the ID.')}<section class="card"><ul class="list">${rows.map((a) => `<li class="item"><div class="grow"><div class="it">${esc(a.full_name)} ${a.id_doc_path ? '' : '<span class="tag warn">No ID yet</span>'}</div><div class="meta">${esc(a.email)} · ${esc(a.phone)} · ${cap(a.gender)}${a.referral_code ? ' · Referral: ' + esc(a.referral_code) : ''}${a.company_id ? ' · Company seat: ' + esc(companies[a.company_id] || '') : ''} · Applied ${fmtDate(a.created_at)}</div>
${ui.viewing?.id === a.id ? (ui.viewing.pdf ? `<p><a href="${esc(ui.viewing.url)}" target="_blank" rel="noopener">Open the ID (PDF)</a></p>` : `<p><img class="idimg" src="${esc(ui.viewing.url)}" alt="Photo ID of ${esc(a.full_name)}"></p>`) : ''}</div>
${a.id_doc_path ? `<button class="btn sm" data-act="viewId" data-id="${a.id}" data-path="${esc(a.id_doc_path)}">${ui.viewing?.id === a.id ? 'Hide ID' : 'View ID'}</button>` : ''}<button class="btn gold sm" data-act="decide" data-id="${a.id}" data-to="approved" ${a.id_doc_path ? '' : 'disabled'}>Approve</button><button class="btn sm bad" data-act="decide" data-id="${a.id}" data-to="rejected">Reject</button></li>`).join('') || emptyRow('No applications waiting.')}</ul></section>`,
    actions: {
      async viewId(el) {
        if (ui.viewing?.id === el.dataset.id) { ui.viewing = null; return app.refresh(); }
        const { data, error } = await sb.storage.from('id-docs').createSignedUrl(el.dataset.path, 300);
        if (error) throw new Error(error.message);
        ui.viewing = { id: el.dataset.id, url: data.signedUrl, pdf: /\.pdf$/i.test(el.dataset.path) };
        await app.refresh();
      },
      async decide(el) {
        await q(sb.from('profiles').update({ status: el.dataset.to }).eq('id', el.dataset.id));
        toast(el.dataset.to === 'approved' ? 'Approved.' : 'Rejected.');
        ui.viewing = null;
        await app.refresh();
      },
    },
  },

  // ---------------------------------------------------------------- admin: members
  'admin-members': {
    access: 'admin',
    load: async () => {
      const rows = await q(sb.from('profiles').select('*').neq('status', 'pending').order('full_name').limit(1000));
      const subs = {};
      (await q(sb.from('subscriptions').select('*'))).forEach((s) => { subs[s.user_id] = s; });
      return { rows, subs };
    },
    render: ({ rows, subs }) => {
      const term = ui.search.toLowerCase();
      const list = rows.filter((m) => !term || (m.full_name + ' ' + m.email + ' ' + m.phone).toLowerCase().includes(term));
      const sel = (m, field, opts) => `<select data-change="${field}" data-id="${m.id}" aria-label="${field} of ${esc(m.full_name)}" style="width:auto;min-height:44px">${opts.map((o) => `<option value="${o}" ${m[field] === o ? 'selected' : ''}>${cap(o.replace('_', ' '))}</option>`).join('')}</select>`;
      return `${head('Club admin', '<i>Members.</i>', `${rows.length} people. Approved, suspended, rejected and removed are all listed.`)}
<form class="row" data-form="search"><div class="field"><label for="am-q" class="meta">Search by name, email or phone</label><input type="text" id="am-q" value="${esc(ui.search)}"></div><button class="btn sm" type="submit" style="align-self:flex-end">Search</button></form>
<section class="card"><ul class="list">${list.map((m) => {
        const sub = subs[m.id];
        const paid = sub && new Date(sub.current_period_end) > new Date();
        return `<li class="item"><div class="grow"><div class="it">${esc(m.full_name)} ${statusTag(m.status)}</div><div class="meta">${esc(m.email)} · ${esc(m.phone)} · ${paid ? 'Paid until ' + fmtDate(sub.current_period_end) : 'No paid plan'}</div></div>
${sel(m, 'role', ['member', 'trainer', 'company_admin', 'admin'])}${sel(m, 'gender', ['female', 'male', 'unspecified'])}
<button class="btn sm" data-act="grant" data-id="${m.id}">Add 30 days</button>
${m.status === 'approved' ? `<button class="btn sm" data-act="status" data-id="${m.id}" data-to="suspended">Suspend</button>` : `<button class="btn sm" data-act="status" data-id="${m.id}" data-to="approved">${m.status === 'suspended' ? 'Restore' : 'Approve'}</button>`}
${m.status !== 'removed' && m.id !== uid() ? `<button class="btn sm bad" data-act="status" data-id="${m.id}" data-to="removed">Remove</button>` : ''}</li>`;
      }).join('') || emptyRow('No members match.')}</ul></section>`;
    },
    forms: { search() { ui.search = $('#am-q').value.trim(); return app.refresh(); } },
    changes: {
      async role(el) { await q(sb.from('profiles').update({ role: el.value }).eq('id', el.dataset.id)); toast('Role saved.'); },
      async gender(el) { await q(sb.from('profiles').update({ gender: el.value }).eq('id', el.dataset.id)); toast('Saved.'); },
    },
    actions: {
      async status(el) {
        if (el.dataset.id === uid() && el.dataset.to !== 'approved') throw new Error('You cannot suspend yourself.');
        await q(sb.from('profiles').update({ status: el.dataset.to }).eq('id', el.dataset.id));
        await app.refresh();
      },
      // For members who pay by bank transfer or cash.
      async grant(el, { subs }) {
        const cur = subs[el.dataset.id];
        const from = cur && new Date(cur.current_period_end) > new Date() ? new Date(cur.current_period_end) : new Date();
        await q(sb.from('subscriptions').upsert({ user_id: el.dataset.id, plan_key: cur?.plan_key || 'monthly', current_period_end: addDays(from, 30).toISOString(), updated_at: new Date().toISOString() }));
        toast('30 days added.');
        await app.refresh();
      },
    },
  },

  // ---------------------------------------------------------------- admin: sessions
  'admin-sessions': {
    access: 'admin',
    load: async () => ({
      sessions: await q(sb.from('sessions').select('*').gte('starts_at', startOfToday().toISOString()).neq('status', 'cancelled').order('starts_at').limit(400)),
      trainers: await q(sb.from('profiles').select('id,full_name').in('role', ['trainer', 'admin']).eq('status', 'approved').order('full_name')),
    }),
    render: ({ sessions, trainers }) => {
      const trainerSelect = (id, attrs, current) => `<select ${attrs} style="${id ? '' : 'width:auto;min-height:44px'}" ${id ? `id="${id}"` : ''}><option value="">No trainer yet</option>${trainers.map((t) => `<option value="${t.id}" ${current === t.id ? 'selected' : ''}>${esc(t.full_name)}</option>`).join('')}</select>`;
      return `${head('Club admin', '<i>Sessions.</i>', 'Make someone a trainer in Members before adding their sessions.')}
<section class="card"><h3>Add a session</h3><form class="stack" data-form="session">
<div class="row" style="align-items:flex-start"><div class="field"><label for="ss-title">Title</label><input type="text" id="ss-title" maxlength="120"></div><div class="field" style="flex:0 1 160px"><label for="ss-type">Type</label><select id="ss-type">${typeOptions}</select></div><div class="field"><label for="ss-trainer">Trainer</label>${trainerSelect('ss-trainer', '', '')}</div></div>
<div class="row" style="align-items:flex-start"><div class="field"><label for="ss-when">First start</label><input type="datetime-local" id="ss-when" value="${localInput(soon())}"></div><div class="field" style="flex:0 1 130px"><label for="ss-len">Minutes</label><select id="ss-len"><option>15</option><option selected>20</option><option>30</option><option>45</option><option>60</option></select></div><div class="field" style="flex:0 1 170px"><label for="ss-repeat">Repeat daily for (days)</label><input type="number" id="ss-repeat" min="1" max="60" value="1"></div></div>
<div class="field" style="flex:none"><label for="ss-yt">YouTube video for members to follow (optional)</label><input type="text" id="ss-yt" inputmode="url" autocomplete="off" placeholder="https://youtu.be/..."></div>
<label class="check" for="ss-women"><input type="checkbox" id="ss-women"><span>Women only</span></label>
<div class="row"><button class="btn gold sm" type="submit">Add to the timetable</button></div><p class="meta">The start is set to today, a few minutes from now. Check the date before you add. Members can join from 5 minutes before the start.</p></form></section>
<section class="card"><h3>Timetable</h3><ul class="list">${sessions.map((s) => `<li class="item"><div class="grow"><div class="it">${esc(s.title)} ${s.status === 'ended' ? '<span class="tag">Ended</span>' : ''} ${s.women_only ? '<span class="tag">Women only</span>' : ''} ${s.company_id ? '<span class="tag">Private</span>' : ''}</div><div class="meta">${fmtDay(s.starts_at)} · ${fmtTime(s.starts_at)} · ${s.duration_min} min · ${TYPE_LABEL[s.type] || esc(s.type)}</div></div>${trainerSelect('', `data-change="trainer" data-id="${s.id}" aria-label="Trainer for ${esc(s.title)}"`, s.trainer_id)}<button class="btn sm bad" data-act="cancel" data-id="${s.id}">Cancel</button></li>`).join('') || emptyRow('No sessions yet. Add the first one above.')}</ul></section>`;
    },
    forms: {
      async session() {
        const title = $('#ss-title').value.trim();
        if (title.length < 2) throw new Error('Give the session a title.');
        const first = new Date($('#ss-when').value);
        if (isNaN(first)) throw new Error('Pick a date and time.');
        const repeat = Math.max(1, Math.min(60, parseInt($('#ss-repeat').value, 10) || 1));
        const yt = $('#ss-yt').value.trim();
        if (yt && !youtubeId(yt)) throw new Error('That is not a YouTube video link. Copy the link from the Share button on YouTube.');
        const rows = [];
        for (let i = 0; i < repeat; i++) {
          const d = new Date(first); d.setDate(d.getDate() + i);
          rows.push({ title, type: $('#ss-type').value, trainer_id: $('#ss-trainer').value || null, starts_at: d.toISOString(), duration_min: parseInt($('#ss-len').value, 10), women_only: $('#ss-women').checked, video_url: yt || null, created_by: uid() });
        }
        await q(sb.from('sessions').insert(rows));
        $('#ss-title').value = '';
        $('#ss-yt').value = '';
        toast(repeat > 1 ? `${repeat} sessions added.` : 'Session added.');
        await app.refresh();
      },
    },
    changes: {
      async trainer(el) { await q(sb.from('sessions').update({ trainer_id: el.value || null }).eq('id', el.dataset.id)); toast('Trainer saved.'); },
    },
    actions: {
      async cancel(el) { await q(sb.from('sessions').update({ status: 'cancelled' }).eq('id', el.dataset.id)); toast('Session cancelled.'); await app.refresh(); },
    },
  },

  // ---------------------------------------------------------------- admin: reports
  'admin-reports': {
    access: 'admin',
    load: async () => {
      const rows = await q(sb.from('reports').select('*').order('created_at', { ascending: false }).limit(200));
      const names = {}, titles = {};
      const pids = [...new Set(rows.flatMap((r) => [r.reporter_id, r.reported_id]))];
      const sids = [...new Set(rows.map((r) => r.session_id).filter(Boolean))];
      if (pids.length) (await q(sb.from('profiles').select('id,full_name,status').in('id', pids))).forEach((p) => { names[p.id] = p; });
      if (sids.length) (await q(sb.from('sessions').select('id,title').in('id', sids))).forEach((s) => { titles[s.id] = s.title; });
      return { rows, names, titles };
    },
    render: ({ rows, names, titles }) => `${head('Club admin', 'Reports from <i>members.</i>', 'One strike for harassment or recording.')}<section class="card"><ul class="list">${rows.map((r) => `<li class="item"><div class="grow"><div class="it">${esc(names[r.reported_id]?.full_name || 'Member')} <span class="tag ${r.status === 'open' ? 'bad' : 'ok'}">${r.status === 'open' ? 'Open' : r.status === 'actioned' ? 'Member removed' : 'Dismissed'}</span></div><div class="meta">${esc(r.reason)}${r.session_id ? ' · ' + esc(titles[r.session_id] || 'Session') : ''} · reported by ${esc(names[r.reporter_id]?.full_name || 'a member')} · ${fmtDate(r.created_at)}</div></div>${r.status === 'open' ? `<button class="btn sm" data-act="dismiss" data-id="${r.id}">Dismiss</button><button class="btn sm bad" data-act="remove" data-id="${r.id}" data-who="${r.reported_id}">Remove member</button>` : ''}</li>`).join('') || emptyRow('No reports.')}</ul></section>`,
    actions: {
      async dismiss(el) { await q(sb.from('reports').update({ status: 'dismissed', resolved_by: uid() }).eq('id', el.dataset.id)); await app.refresh(); },
      async remove(el) {
        if (el.dataset.who === uid()) throw new Error('You cannot remove yourself.');
        await q(sb.from('profiles').update({ status: 'removed' }).eq('id', el.dataset.who));
        await q(sb.from('reports').update({ status: 'actioned', resolved_by: uid() }).eq('reported_id', el.dataset.who).eq('status', 'open'));
        toast('Member removed from the club.');
        await app.refresh();
      },
    },
  },

  // ---------------------------------------------------------------- admin: companies
  'admin-companies': {
    access: 'admin',
    load: async () => {
      const rows = await q(sb.from('companies').select('*').order('name'));
      const admins = {};
      const ids = rows.map((c) => c.admin_id).filter(Boolean);
      if (ids.length) (await q(sb.from('profiles').select('id,full_name,email').in('id', ids))).forEach((p) => { admins[p.id] = p; });
      return { rows, admins };
    },
    render: ({ rows, admins }) => `${head('Club admin', '<i>Companies.</i>', 'Companies pay with Paystack. For a company that pays by bank transfer, set its seats and end date here.')}${rows.map((c) => `<section class="card"><h3>${esc(c.name)}</h3><p class="meta">Admin: ${esc(admins[c.admin_id]?.full_name || 'none')} ${esc(admins[c.admin_id]?.email || '')}</p><form class="row" data-form="company" data-id="${c.id}"><div class="field" style="flex:0 1 140px"><label for="cs-${c.id}">Seats</label><input type="number" id="cs-${c.id}" name="seats" min="0" value="${c.seats}"></div><div class="field"><label for="cu-${c.id}">Paid until</label><input type="date" id="cu-${c.id}" name="until" value="${dateInput(c.active_until)}"></div><button class="btn sm" type="submit" style="align-self:flex-end">Save</button></form></section>`).join('') || '<section class="card"><p class="meta">No companies have registered yet.</p></section>'}`,
    forms: {
      async company(form) {
        const until = form.elements.until.value;
        await q(sb.from('companies').update({ seats: Math.max(0, parseInt(form.elements.seats.value, 10) || 0), active_until: until ? new Date(until + 'T23:59:59').toISOString() : null }).eq('id', form.dataset.id));
        toast('Company saved.');
        await app.refresh();
      },
    },
  },

  // ---------------------------------------------------------------- admin: fees and access
  'admin-fees': {
    access: 'admin',
    load: async () => ({
      plans: await q(sb.from('plans').select('*')),
      access: (await q(sb.from('app_settings').select('value').eq('key', 'access').maybeSingle()))?.value || {},
      codes: await q(sb.from('discount_codes').select('*').order('created_at')),
    }),
    render: ({ plans, access, codes }) => {
      const p = (k) => plans.find((x) => x.key === k) || { amount_kobo: 0 };
      const fee = (k, label) => `<div class="field"><label for="fee-${k}">${label} (₦)</label><input type="number" id="fee-${k}" min="0" step="1" value="${p(k).amount_kobo / 100}"></div>`;
      return `${head('Club admin', 'Fees and <i>access.</i>')}
<section class="card"><h3>Who can join rooms</h3><label class="check" for="fa-paid"><input type="checkbox" id="fa-paid" data-change="paid" ${access.free_access ? '' : 'checked'}><span>Require a paid membership or a company seat</span></label><p class="meta">While this is off, every approved member can join for free. Switch it on once fees are set and Paystack is connected.</p></section>
<section class="card"><h3>Fees</h3><form class="stack" data-form="fees"><div class="row" style="align-items:flex-start">${fee('monthly', 'Member, monthly')}${fee('yearly', 'Member, yearly')}</div><div class="row" style="align-items:flex-start">${fee('company_seat_monthly', 'Company seat, monthly')}${fee('company_seat_yearly', 'Company seat, yearly')}</div>
<div class="row" style="align-items:flex-start"><div class="field"><label for="pc-monthly">Paystack plan code, monthly (optional)</label><input type="text" id="pc-monthly" value="${esc(p('monthly').paystack_plan_code || '')}" placeholder="PLN_..."></div><div class="field"><label for="pc-yearly">Paystack plan code, yearly (optional)</label><input type="text" id="pc-yearly" value="${esc(p('yearly').paystack_plan_code || '')}" placeholder="PLN_..."></div></div>
<p class="meta">Without a plan code, members pay once per period and renew by hand. With a plan code from Paystack, their card renews automatically. The plan amount in Paystack must match the fee here.</p>
<div class="row"><button class="btn gold sm" type="submit">Save fees</button></div></form></section>
<section class="card"><h3>Founding member codes</h3><ul class="list">${codes.map((c) => `<li class="item"><div class="grow"><div class="it">${esc(c.code)} ${c.active ? '' : '<span class="tag">Off</span>'}</div><div class="meta">${c.percent_off}% off · used ${c.used} of ${c.max_uses}</div></div><button class="btn sm" data-act="toggleCode" data-code="${esc(c.code)}" data-on="${c.active ? '' : 1}">${c.active ? 'Switch off' : 'Switch on'}</button><button class="btn sm bad" data-act="delCode" data-code="${esc(c.code)}">Delete</button></li>`).join('') || emptyRow('No codes yet.')}</ul>
<form class="row" data-form="code" style="align-items:flex-start"><div class="field"><label for="dc-code">Code</label><input type="text" id="dc-code" placeholder="FOUNDER" maxlength="30"></div><div class="field" style="flex:0 1 120px"><label for="dc-pct">% off</label><input type="number" id="dc-pct" min="1" max="100" value="30"></div><div class="field" style="flex:0 1 140px"><label for="dc-max">Uses allowed</label><input type="number" id="dc-max" min="1" value="100"></div><button class="btn gold sm" type="submit" style="align-self:flex-end">Add code</button></form></section>`;
    },
    changes: {
      async paid(el) {
        await q(sb.from('app_settings').upsert({ key: 'access', value: { free_access: !el.checked } }));
        toast(el.checked ? 'Paid membership is now required.' : 'Rooms are free for approved members.');
      },
    },
    forms: {
      async fees() {
        for (const k of ['monthly', 'yearly', 'company_seat_monthly', 'company_seat_yearly']) {
          const amount = Math.max(0, parseFloat($('#fee-' + k).value) || 0);
          const patch = { amount_kobo: Math.round(amount * 100) };
          if (k === 'monthly' || k === 'yearly') patch.paystack_plan_code = $('#pc-' + k).value.trim() || null;
          await q(sb.from('plans').update(patch).eq('key', k));
        }
        toast('Fees saved.');
        await app.refresh();
      },
      async code() {
        const code = $('#dc-code').value.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
        if (code.length < 3) throw new Error('Use a code of 3 or more letters or numbers.');
        await q(sb.from('discount_codes').insert({ code, percent_off: Math.max(1, Math.min(100, parseInt($('#dc-pct').value, 10) || 0)), max_uses: Math.max(1, parseInt($('#dc-max').value, 10) || 1) }));
        $('#dc-code').value = '';
        await app.refresh();
      },
    },
    actions: {
      async toggleCode(el) { await q(sb.from('discount_codes').update({ active: !!el.dataset.on }).eq('code', el.dataset.code)); await app.refresh(); },
      async delCode(el) { await q(sb.from('discount_codes').delete().eq('code', el.dataset.code)); await app.refresh(); },
    },
  },
};
