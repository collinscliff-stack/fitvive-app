// Members, profiles and direct messages: see who is online, open a member's profile, and message them.
import { sb, S, uid, app, $, esc, toast, q, head, icon, emptyRow, photoUrls, avatar, placeOf, seen, NG_STATES, fmtTime, fmtDate } from './core.js';

const ui = { show: 'online', search: '', state: '', reporting: false };
const CARD_COLS = 'id,display_name,role,avatar_path,state,area,bio,last_active,online,live';
const REASONS = ['Unwanted messages', 'Harassment or insults', 'Sexual comments', 'Spam or selling', 'Fake profile', 'Something else'];

const when = (ts) => {
  const d = new Date(ts);
  return new Date().toDateString() === d.toDateString() ? fmtTime(ts) : fmtDate(ts);
};
const roleTag = (c) => (c.role === 'trainer' ? '<span class="tag warn">Trainer</span>' : c.role === 'admin' ? '<span class="tag">Club team</span>' : '');

async function card(id) {
  return q(sb.from('member_cards').select(CARD_COLS).eq('id', id).maybeSingle());
}

// Shrinks a photo on the phone before upload, so it is quick on mobile data.
function shrink(file, max = 640) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const side = Math.round(Math.min(img.width, img.height) * scale);
      const c = document.createElement('canvas');
      c.width = side; c.height = side;
      const sx = (img.width - Math.min(img.width, img.height)) / 2;
      const sy = (img.height - Math.min(img.width, img.height)) / 2;
      c.getContext('2d').drawImage(img, sx, sy, Math.min(img.width, img.height), Math.min(img.width, img.height), 0, 0, side, side);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('That photo could not be read. Try another one.'))), 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a photo we can read. Use a JPG or PNG.')); };
    img.src = url;
  });
}

export const views = {
  // ---------------------------------------------------------------- everyone in the club
  members: {
    access: 'member',
    load: async () => {
      const cards = (await q(sb.from('member_cards').select(CARD_COLS).neq('id', uid()).order('last_active', { ascending: false, nullsFirst: false }).limit(500)));
      return { cards, url: await photoUrls(cards.map((c) => c.avatar_path)) };
    },
    render: ({ cards, url }) => {
      const online = cards.filter((c) => c.online || c.live);
      const live = cards.filter((c) => c.live).length;
      const term = ui.search.trim().toLowerCase();
      let list = ui.show === 'online' ? online : cards;
      if (ui.state) list = list.filter((c) => c.state === ui.state);
      if (term) list = list.filter((c) => `${c.display_name} ${c.area || ''} ${c.state || ''}`.toLowerCase().includes(term));
      const me = S.profile;
      const nudge = !me.avatar_path || !me.state
        ? `<section class="card glow"><div class="row"><span class="grow"><span class="it">Add your photo and location</span><br><span class="meta">Members are more likely to say hello when they can see who you are.</span></span><a class="btn gold sm" href="#/profile">${icon('camera')}Edit my profile</a></div></section>` : '';
      return `${head('Members', `Who is <i>here.</i>`, `${online.length} online now${live ? `, ${live} training live` : ''}. Tap a member to see their profile or send a message.`)}
${nudge}
<section class="card"><div class="row"><button class="btn sm" aria-pressed="${ui.show === 'online'}" data-act="show" data-v="online">Online now · ${online.length}</button><button class="btn sm" aria-pressed="${ui.show === 'all'}" data-act="show" data-v="all">All members · ${cards.length}</button></div>
<div class="row" style="align-items:flex-end"><div class="field"><label for="mb-q" class="meta">Search by name or area</label><input type="text" inputmode="search" id="mb-q" autocomplete="off" data-change="search" value="${esc(ui.search)}" placeholder="Ada, Lekki…"></div><div class="field" style="flex:0 1 200px"><label for="mb-st" class="meta">State</label><select id="mb-st" data-change="state"><option value="">Anywhere</option>${NG_STATES.map((s) => `<option ${ui.state === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div></div></section>
<section class="people">${list.map((c) => `<a class="person" href="#/member/${c.id}">${avatar(c, url(c.avatar_path), 'lg')}<span class="pname">${esc(c.display_name)} ${roleTag(c)}</span><span class="meta">${esc(placeOf(c) || 'Location not added')}</span><span class="meta ${c.live ? 'hot' : ''}">${esc(seen(c))}</span></a>`).join('')}</section>
${list.length ? '' : `<section class="card"><p class="meta">${ui.show === 'online' ? 'Nobody matching is online right now. Switch to All members to message anyone.' : 'No member matches that search.'}</p></section>`}`;
    },
    mount: () => { const t = setInterval(() => app.refresh(), 60000); return () => clearInterval(t); },
    actions: {
      show(el) { ui.show = el.dataset.v; return app.refresh(); },
    },
    changes: {
      search(el) { ui.search = el.value; return app.refresh(); },
      state(el) { ui.state = el.value; return app.refresh(); },
    },
  },

  // ---------------------------------------------------------------- one member's profile
  member: {
    access: 'member',
    load: async ([id]) => {
      if (!id || id === uid()) { location.hash = '#/profile'; return {}; }
      const c = await card(id);
      if (!c) return { missing: true };
      const [a, b] = [uid(), id].sort();
      const [pair, block, url] = await Promise.all([
        q(sb.from('partnerships').select('id,status,requested_by').eq('a', a).eq('b', b).maybeSingle()),
        q(sb.from('blocks').select('blocked').eq('blocker', uid()).eq('blocked', id).maybeSingle()),
        photoUrls([c.avatar_path]),
      ]);
      return { c, pair, blocked: !!block, url };
    },
    render: (d) => {
      if (!d.c) return d.missing ? `<section class="card"><h3>Member not found</h3><p class="meta">This member may have left the club.</p><a class="btn sm" href="#/members">Back to members</a></section>` : '';
      const { c, pair, blocked, url } = d;
      const partner = pair?.status === 'accepted'
        ? `<a class="btn sm" href="#/partners">${icon('flame')}Workout partners</a>`
        : pair ? `<span class="meta">${pair.requested_by === uid() ? 'Partner request sent' : `${esc(c.display_name)} asked to be your partner. Answer in Partners.`}</span>`
          : `<button class="btn sm" data-act="partner">${icon('flame')}Ask to be workout partners</button>`;
      const report = ui.reporting
        ? `<section class="card"><h3>Report ${esc(c.display_name)}</h3><p class="meta">The club team reviews every report. ${esc(c.display_name)} is not told who reported them.</p><div class="field" style="flex:none"><label for="pr-why">What happened?</label><select id="pr-why">${REASONS.map((r) => `<option>${r}</option>`).join('')}</select></div><div class="row"><button class="btn gold sm" data-act="sendReport">Send report</button><button class="btn sm" data-act="cancelReport">Cancel</button></div></section>` : '';
      return `<section class="card glow profilehead">${avatar(c, url(c.avatar_path), 'xl')}
<div class="stack" style="gap:6px"><h2 class="pname big">${esc(c.display_name)} ${roleTag(c)}</h2>
${placeOf(c) ? `<span class="meta">${icon('pin')}${esc(placeOf(c))}</span>` : ''}
<span class="meta ${c.live ? 'hot' : ''}">${esc(seen(c))}</span>
${c.bio ? `<p>${esc(c.bio)}</p>` : ''}</div></section>
<section class="card"><div class="row">${blocked ? `<span class="meta grow">You blocked ${esc(c.display_name)}. They cannot message you.</span><button class="btn sm" data-act="unblock">Unblock</button>`
        : `<a class="btn gold" href="#/chat/${c.id}">${icon('chat')}Message</a>${partner}`}</div></section>
${report}
<section class="card"><div class="row">${blocked ? '' : '<button class="btn sm bad" data-act="block">Block</button>'}<button class="btn sm bad" data-act="report">${icon('flag')}Report</button><a class="btn sm" href="#/members">Back to members</a></div></section>`;
    },
    actions: {
      async partner(_, d) {
        await q(sb.rpc('request_partner', { p_other: d.c.id }));
        toast(`Partner request sent to ${d.c.display_name}.`);
        await app.refresh();
      },
      async block(_, d) {
        if (!confirm(`Block ${d.c.display_name}? They will not be able to message you.`)) return;
        await q(sb.from('blocks').insert({ blocker: uid(), blocked: d.c.id }));
        toast('Blocked.');
        await app.refresh();
      },
      async unblock(_, d) {
        await q(sb.from('blocks').delete().eq('blocker', uid()).eq('blocked', d.c.id));
        toast('Unblocked.');
        await app.refresh();
      },
      report() { ui.reporting = true; return app.refresh(); },
      cancelReport() { ui.reporting = false; return app.refresh(); },
      async sendReport(_, d) {
        await q(sb.from('reports').insert({ reporter_id: uid(), reported_id: d.c.id, reason: 'Profile/messages: ' + $('#pr-why').value }));
        ui.reporting = false;
        toast('Report sent. Thank you.');
        await app.refresh();
      },
    },
  },

  // ---------------------------------------------------------------- all my conversations
  messages: {
    access: 'member',
    load: async () => {
      const threads = await q(sb.rpc('dm_threads'));
      return { threads, url: await photoUrls(threads.map((t) => t.avatar_path)) };
    },
    render: ({ threads, url }) => `${head('Messages', 'Your <i>conversations.</i>', 'Private between you and the member. Be respectful: the code of conduct applies here too.')}
<section class="card"><div class="list">${threads.map((t) => `<a class="thread" href="#/chat/${t.other_id}">${avatar({ display_name: t.display_name }, url(t.avatar_path), 'md')}<span class="grow tbody"><span class="pname">${esc(t.display_name)}</span><span class="meta clip">${t.last_from_me ? 'You: ' : ''}${esc(t.last_body)}</span></span><span class="stack tside"><span class="meta">${when(t.last_at)}</span>${t.unread ? `<span class="badge">${t.unread}</span>` : ''}</span></a>`).join('')
  || `${emptyRow('No messages yet.')}<div class="row" style="margin-top:12px"><a class="btn gold sm" href="#/members">${icon('users')}Find members to say hello</a></div>`}</div></section>`,
    mount: () => {
      const ch = sb.channel('dm-list-' + uid())
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages', filter: `recipient_id=eq.${uid()}` }, () => app.refresh())
        .subscribe();
      return () => sb.removeChannel(ch);
    },
  },

  // ---------------------------------------------------------------- one conversation
  chat: {
    access: 'member',
    load: async ([id]) => {
      if (!id || id === uid()) { location.hash = '#/messages'; return {}; }
      const me = uid();
      const [c, msgs, block] = await Promise.all([
        card(id),
        q(sb.from('direct_messages').select('id,sender_id,body,created_at,read_at')
          .or(`and(sender_id.eq.${me},recipient_id.eq.${id}),and(sender_id.eq.${id},recipient_id.eq.${me})`)
          .order('created_at', { ascending: false }).limit(200)),
        q(sb.from('blocks').select('blocked').eq('blocker', me).eq('blocked', id).maybeSingle()),
      ]);
      if (msgs.some((m) => m.sender_id === id && !m.read_at)) { try { await q(sb.rpc('mark_read', { p_other: id })); } catch { /* try next time */ } app.unread?.(); }
      return { c, msgs: msgs.reverse(), blocked: !!block, url: await photoUrls([c?.avatar_path]) };
    },
    render: (d) => {
      if (!d.c) return `<section class="card"><h3>Member not found</h3><p class="meta">This member may have left the club.</p><a class="btn sm" href="#/messages">Back to messages</a></section>`;
      const { c, msgs, blocked, url } = d;
      let lastDay = '';
      const bubbles = msgs.map((m) => {
        const day = new Date(m.created_at).toDateString();
        const sep = day !== lastDay ? `<p class="daysep">${fmtDate(m.created_at)}</p>` : '';
        lastDay = day;
        return `${sep}<div class="bubble ${m.sender_id === uid() ? 'me' : ''}">${esc(m.body)}<span class="btime">${fmtTime(m.created_at)}</span></div>`;
      }).join('');
      return `<section class="card chathead"><a class="row grow" href="#/member/${c.id}" style="text-decoration:none;color:inherit">${avatar(c, url(c.avatar_path), 'md')}<span class="stack" style="gap:2px"><span class="pname">${esc(c.display_name)} ${roleTag(c)}</span><span class="meta ${c.live ? 'hot' : ''}">${esc(seen(c) || placeOf(c))}</span></span></a><a class="btn sm" href="#/messages">All messages</a></section>
<section class="card"><div class="stack chatbox" id="dmbox">${bubbles || `<p class="meta">No messages yet. Say hello to ${esc(c.display_name)}.</p>`}</div>
${blocked ? `<p class="meta">You blocked ${esc(c.display_name)}. <a href="#/member/${c.id}">Unblock</a> to send messages.</p>`
    : `<form class="row" data-form="send" style="margin-top:12px"><div class="field"><label for="dm-msg" class="meta">Message</label><input type="text" id="dm-msg" autocomplete="off" maxlength="1000" enterkeyhint="send"></div><button class="btn gold sm" type="submit" style="align-self:flex-end">Send</button></form>`}</section>`;
    },
    mount: (d) => {
      const box = $('#dmbox'); if (box) box.scrollTop = box.scrollHeight;
      if (!d.c) return null;
      const other = d.c.id;
      const ch = sb.channel('dm-' + uid() + '-' + other)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages', filter: `recipient_id=eq.${uid()}` }, (p) => { if (p.new.sender_id === other) app.refresh(); })
        .subscribe();
      return () => sb.removeChannel(ch);
    },
    remount: () => { const box = $('#dmbox'); if (box) box.scrollTop = box.scrollHeight; },
    forms: {
      async send(form, d) {
        const input = $('#dm-msg');
        const body = input.value.trim();
        if (!body) return;
        await q(sb.from('direct_messages').insert({ sender_id: uid(), recipient_id: d.c.id, body }));
        input.value = '';
        await app.refresh();
        $('#dm-msg')?.focus();
      },
    },
  },

  // ---------------------------------------------------------------- my own profile
  profile: {
    access: 'member',
    load: async () => ({ url: await photoUrls([S.profile.avatar_path]) }),
    render: ({ url }) => {
      const p = S.profile;
      const me = { display_name: p.full_name, online: p.show_online };
      return `${head('My profile', 'How members <i>see you.</i>')}
<section class="card glow profilehead">${avatar(me, url(p.avatar_path), 'xl')}<div class="stack" style="gap:10px"><h2 class="pname big">${esc(p.full_name)}</h2>
<label class="btn sm" for="pf-photo" style="align-self:flex-start">${icon('camera')}${p.avatar_path ? 'Change photo' : 'Add a photo'}</label><input type="file" id="pf-photo" accept="image/*" data-change="photo" hidden>
${p.avatar_path ? '<button class="linkbtn" data-act="removePhoto" style="align-self:flex-start">Remove photo</button>' : ''}
<span class="meta">A clear photo of your face. Only approved members can see it.</span></div></section>
<section class="card"><h3>About you</h3><form class="stack" data-form="save">
<div class="row" style="align-items:flex-start"><div class="field"><label for="pf-state">State</label><select id="pf-state"><option value="">Choose your state</option>${NG_STATES.map((s) => `<option ${p.state === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
<div class="field"><label for="pf-area">Area or city</label><input type="text" id="pf-area" maxlength="60" value="${esc(p.area || '')}" placeholder="Lekki, Wuse 2, GRA…"></div></div>
<div class="field" style="flex:none"><label for="pf-bio">A line about you (optional)</label><input type="text" id="pf-bio" maxlength="200" value="${esc(p.bio || '')}" placeholder="Morning runner. Looking for a press-up partner."></div>
<label class="check" for="pf-online"><input type="checkbox" id="pf-online" ${p.show_online !== false ? 'checked' : ''}><span>Show other members when I am online or training live</span></label>
<div class="row"><button class="btn gold sm" type="submit">Save profile</button></div>
<p class="meta">Members see your first name, the first letter of your surname, your photo, area and state. Never your phone number or email.</p></form></section>`;
    },
    changes: {
      async photo(el) {
        const file = el.files?.[0];
        if (!file) return;
        if (file.size > 15 * 1024 * 1024) throw new Error('That photo is too large. Use one under 15 MB.');
        toast('Uploading your photo…');
        const blob = await shrink(file);
        const path = `${uid()}/${Date.now()}.jpg`;
        const { error } = await sb.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg' });
        if (error) throw new Error(error.message);
        const old = S.profile.avatar_path;
        await q(sb.from('profiles').update({ avatar_path: path }).eq('id', uid()));
        if (old) sb.storage.from('avatars').remove([old]).then(() => {}, () => {});
        S.profile.avatar_path = path;
        toast('Photo saved.');
        await app.refresh();
      },
    },
    actions: {
      async removePhoto() {
        const old = S.profile.avatar_path;
        await q(sb.from('profiles').update({ avatar_path: null }).eq('id', uid()));
        if (old) sb.storage.from('avatars').remove([old]).then(() => {}, () => {});
        S.profile.avatar_path = null;
        toast('Photo removed.');
        await app.refresh();
      },
    },
    forms: {
      async save() {
        const v = { state: $('#pf-state').value || null, area: $('#pf-area').value.trim() || null, bio: $('#pf-bio').value.trim() || null, show_online: $('#pf-online').checked };
        await q(sb.from('profiles').update(v).eq('id', uid()));
        Object.assign(S.profile, v);
        toast('Profile saved.');
        await app.refresh();
      },
    },
  },
};
