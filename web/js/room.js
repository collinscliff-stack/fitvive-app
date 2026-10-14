// Live video: trainer-led rooms of six, and one-to-one partner workouts. Video runs on Daily.
import { sb, S, uid, $, esc, ini, toast, q, fn, go, head, fmtTime, fmtDay, sessionState, stop, icon, youtubeId } from './core.js';
import { createRepCounter } from './rep-counter.js';

const FLAG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 21V4h11l-2 4 2 4H5"/></svg>';
const REASONS = ['Recording or taking screenshots', 'Harassment', 'Inappropriate behaviour', 'Something else'];
const dailyLib = () => window.Daily || window.DailyIframe;

// A pass handed over by the Partners screen so the caller joins without asking the server twice.
let pending = null;
export const setPendingCall = (pass) => { pending = pass; };

const fresh = () => ({
  kind: '', call: null, joined: false, sessionId: null, session: null, info: null, roster: [], lowData: false,
  mic: false, cam: true, zoom: 1, zoomCaps: null, rot: 0, called: {}, reporting: null, timers: [], channels: [], subs: {}, recvKey: '',
  raf: 0, reps: 0, theirReps: 0, partnerName: '', wake: null, noCall: false,
  round: null, results: [], pickEx: 'squat', counter: null, countingRound: null, repStarting: false, repMsg: '',
  myReps: 0, sentReps: -1, countStart: 0, repTick: 0, resultsTimer: 0, sendTimer: 0,
  yt: null, ytId: '', ytReady: false, ytCheck: 0, skew: 0,
});
const R = fresh();

// ---------------------------------------------------------------- video tiles (kept in place so video never flickers)
function ensureTile(container, key, cls) {
  let el = container.querySelector(`[data-key="${key}"]`);
  if (!el) {
    el = document.createElement('div');
    el.dataset.key = key;
    el.innerHTML = '<video autoplay playsinline muted hidden></video><div class="av" aria-hidden="true"></div><span class="nm"></span>';
    container.appendChild(el);
  }
  el.className = 'tile ' + cls;
  return el;
}

function fillTile(el, { name, label, participant, flag }) {
  el.querySelector('.av').textContent = ini(name);
  el.querySelector('.nm').textContent = label || name;
  const video = el.querySelector('video');
  const t = participant?.tracks?.video;
  const track = t && t.state === 'playable' ? (t.persistentTrack || t.track) : null;
  if (track) {
    if (video._tid !== track.id) { video.srcObject = new MediaStream([track]); video._tid = track.id; video.play?.().catch(() => {}); }
  } else if (video._tid) { video.srcObject = null; video._tid = null; }
  video.hidden = !track;
  el.querySelector('.av').hidden = !!track;
  let btn = el.querySelector('.flag');
  if (flag && !btn) { btn = document.createElement('button'); btn.className = 'flag'; btn.dataset.act = 'report'; btn.innerHTML = FLAG; el.appendChild(btn); }
  if (!flag && btn) btn.remove();
  if (flag && btn) { btn.dataset.id = flag.id; btn.dataset.n = flag.name; btn.setAttribute('aria-label', 'Report ' + flag.name); }
}

function prune(container, keep) {
  [...container.children].forEach((c) => { if (!keep.has(c.dataset.key)) c.remove(); });
}

function syncAudio(list) {
  const box = $('#rm-audio'); if (!box) return;
  const keep = new Set();
  list.forEach((p) => {
    const t = p.tracks?.audio;
    const track = t && t.state === 'playable' ? (t.persistentTrack || t.track) : null;
    if (!track) return;
    keep.add(p.session_id);
    let a = box.querySelector(`[data-key="${p.session_id}"]`);
    if (!a) { a = document.createElement('audio'); a.autoplay = true; a.dataset.key = p.session_id; box.appendChild(a); }
    if (a._tid !== track.id) { a.srcObject = new MediaStream([track]); a._tid = track.id; a.play?.().catch(() => {}); }
  });
  prune(box, keep);
}

// ---------------------------------------------------------------- deciding who is on screen
function sync() {
  if (R.noCall) {
    // This browser cannot do live video: show who is in the session as name squares, and say why.
    const big = $('#rm-big'), grid = $('#rm-grid');
    if (big) big.hidden = true;
    if (grid) {
      const people = R.roster.filter((r) => r.user_id !== uid() && (R.info?.isHost ? !r.is_host : true));
      const tiles = people.slice(0, 12).map((r) => ({ key: r.user_id, name: r.display_name, label: r.is_host ? `${r.display_name} · Trainer` : (R.info?.isHost ? `${r.display_name} · Room ${r.room_no}` : r.display_name) }));
      tiles.unshift({ key: 'me', cls: 'me', name: 'You' });
      tiles.forEach((t) => fillTile(ensureTile(grid, t.key, t.cls || ''), t));
      prune(grid, new Set(tiles.map((t) => t.key)));
    }
    const note = $('#rm-note');
    if (note) { note.hidden = false; note.textContent = 'This browser blocks live video, so you see names instead of cameras. On iPhone, open fitvive.club in Safari to see everyone and be seen.'; }
    return;
  }
  if (!R.call || !R.joined) return;
  const all = R.call.participants();
  const local = all.local;
  const remote = Object.values(all).filter((p) => !p.local);
  const byUser = {};
  remote.forEach((p) => { if (p.user_id) byUser[p.user_id] = p; });
  const big = $('#rm-big'), grid = $('#rm-grid');
  if (!big || !grid) return;

  if (R.kind === 'call') {
    const other = remote[0];
    const keep = new Set(['me', 'other']);
    fillTile(ensureTile(grid, 'me', 'me'), { name: 'You', participant: local });
    fillTile(ensureTile(grid, 'other', ''), { name: R.partnerName, label: other ? R.partnerName : `Waiting for ${R.partnerName}`, participant: other });
    prune(grid, keep);
    syncAudio(remote);
    return;
  }

  const isHost = !!R.info?.isHost;
  // With a session video, the video takes the big screen and the trainer's camera moves into the grid.
  const vid = !!youtubeId(R.session?.video_url);
  big.hidden = vid;
  const members = R.roster.filter((r) => !r.is_host);
  const hosts = R.roster.filter((r) => r.is_host);
  const wanted = new Set();
  const tiles = [];

  if (isHost) {
    const pages = Math.max(1, Math.ceil(members.length / 6));
    const page = R.rot % pages;
    const sample = members.slice(page * 6, page * 6 + 6);
    sample.forEach((m) => { wanted.add(m.user_id); tiles.push({ key: m.user_id, name: m.display_name, label: `${m.display_name} · Room ${m.room_no}`, participant: byUser[m.user_id] }); });
    const rooms = new Set(members.map((m) => m.room_no)).size;
    const liveTo = `You · live to ${members.length} ${members.length === 1 ? 'member' : 'members'} in ${rooms} ${rooms === 1 ? 'room' : 'rooms'}`;
    if (vid) tiles.unshift({ key: 'me', cls: 'me', name: 'You', label: liveTo, participant: local });
    else fillTile(ensureTile(big, 'big', 'big glow me'), { name: 'You', label: liveTo, participant: local });
  } else {
    const mates = members.filter((m) => m.user_id !== uid());
    const shown = R.lowData ? mates.slice(0, 2) : mates;
    const hostRow = hosts.find((h) => h.user_id === R.session.trainer_id && byUser[h.user_id]) || hosts.find((h) => byUser[h.user_id]);
    const hostP = hostRow ? byUser[hostRow.user_id] : remote.find((p) => p.owner);
    hosts.forEach((h) => wanted.add(h.user_id));
    shown.forEach((m) => wanted.add(m.user_id));
    tiles.push({ key: 'me', cls: 'me', name: 'You', participant: local });
    shown.forEach((m) => tiles.push({ key: m.user_id, name: m.display_name, participant: byUser[m.user_id], flag: { id: m.user_id, name: m.display_name } }));
    const hostName = hostRow?.display_name || (hostP ? hostP.user_name : '') || 'Trainer';
    if (vid) { if (hostP) tiles.unshift({ key: 'host', name: hostName, label: `${hostName} · Trainer`, participant: hostP }); }
    else fillTile(ensureTile(big, 'big', 'big glow'), { name: hostName, label: hostP ? `${hostName} · Trainer` : 'Waiting for the trainer', participant: hostP });
    const note = $('#rm-note');
    if (note) {
      const hidden = mates.slice(shown.length);
      note.hidden = !hidden.length;
      note.textContent = hidden.length ? `Low-data mode: showing the trainer and 2 members. Also in the room: ${hidden.map((m) => m.display_name).join(', ')}.` : '';
    }
  }

  const keep = new Set(tiles.map((t) => t.key));
  tiles.forEach((t) => fillTile(ensureTile(grid, t.key, t.cls || ''), t));
  prune(grid, keep);

  // Ask Daily only for the video we show. This is what keeps data use low.
  const recv = {};
  const heard = [];
  remote.forEach((p) => {
    const want = wanted.has(p.user_id) || (!isHost && !!p.owner);
    if (R.subs[p.session_id] !== want) {
      try { R.call.updateParticipant(p.session_id, { setSubscribedTracks: want ? { audio: true, video: true } : false }); } catch { /* participant just left */ }
      R.subs[p.session_id] = want;
    }
    if (want) { heard.push(p); recv[p.session_id] = { video: { layer: p.owner && !R.lowData ? 2 : 0 } }; }
  });
  const key = JSON.stringify(recv);
  if (key !== R.recvKey) {
    R.recvKey = key;
    try { Promise.resolve(R.call.updateReceiveSettings(recv)).catch(() => {}); } catch { /* not supported in this call mode */ }
  }
  syncAudio(heard);
}

const kick = () => { cancelAnimationFrame(R.raf); R.raf = requestAnimationFrame(() => { sync(); drawHostPanel(); }); };

// ---------------------------------------------------------------- the parts around the video
function drawHead() {
  const el = $('#rm-head'); if (!el) return;
  if (R.kind === 'call') { el.innerHTML = head('Partner workout', `You and <i>${esc(R.partnerName)}${stop(R.partnerName)}</i>`); return; }
  el.innerHTML = R.info.isHost
    ? head(`${esc(R.session.title)} · Live`, 'One camera, <i>every room.</i>', 'You cannot watch every room at once, so six members are shown at a time.')
    : head(`${esc(R.session.title)} · Room ${R.info.roomNo}`, 'Six members, <i>one trainer.</i>', `Until ${fmtTime(new Date(R.session.starts_at).getTime() + R.session.duration_min * 60000)}.`);
}

function drawControls() {
  const el = $('#rm-controls'); if (!el) return;
  const member = R.kind === 'session' && !R.info.isHost;
  const zoomOptions = [0.5, 1, 2, 2.5];
  const zoomTrack = !R.noCall && R.joined ? currentLocalVideoTrack() : null;
  let zoomCaps = null;
  try { zoomCaps = zoomTrack?.getCapabilities?.()?.zoom ?? null; } catch { /* capabilities are optional */ }
  R.zoomCaps = zoomCaps;
  const zoomControls = !R.noCall && R.joined && R.cam ? `<div class="row" role="group" aria-label="Camera zoom" style="gap:6px;align-items:center"><span class="meta">Zoom</span>${zoomOptions.map((z) => {
    const supported = !zoomCaps || (z >= Number(zoomCaps.min) && z <= Number(zoomCaps.max));
    const label = `${z}x`;
    return `<button class="btn sm ${Number(R.zoom) === z ? 'gold' : ''}" data-act="zoom" data-zoom="${z}" aria-pressed="${Number(R.zoom) === z}" ${supported ? '' : 'disabled title="This camera does not support this zoom level in this browser"'}>${label}</button>`;
  }).join('')}</div>` : '';
  el.innerHTML = `${R.noCall ? '' : `<button class="btn sm" aria-pressed="${R.mic}" data-act="mic">${icon(R.mic ? 'mic' : 'micoff')}${R.mic ? 'Mic on' : 'Mic off'}</button>
<button class="btn sm" aria-pressed="${R.cam}" data-act="cam">${icon(R.cam ? 'video' : 'videooff')}${R.cam ? 'Camera on' : 'Camera off'}</button>`}
${zoomControls}
${member && !R.noCall ? `<button class="btn sm" aria-pressed="${R.lowData}" data-act="low">${icon('signal')}Low-data mode</button>` : ''}
${R.kind === 'call' ? `<span class="it grow">Reps: you ${R.reps} · ${esc(R.partnerName)} ${R.theirReps}</span><button class="btn gold sm" data-act="rep">Add a rep</button>` : ''}
<button class="btn sm bad" data-act="leave">${icon('leave')}${R.kind === 'call' ? 'End workout' : 'Leave room'}</button>
${R.kind === 'session' && R.info.isHost ? '<button class="btn sm bad" data-act="endSession">End session for everyone</button>' : ''}`;
}

async function setCameraZoom(value) {
  const zoom = Number(value);
  if (![0.5, 1, 2, 2.5].includes(zoom)) return;
  if (!R.joined || !R.cam) throw new Error('Turn your camera on before changing zoom.');
  const track = currentLocalVideoTrack();
  if (!track || track.readyState === 'ended') throw new Error('Your camera track is not ready. Turn your camera off and on, then try again.');
  let caps = null;
  try { caps = track.getCapabilities?.()?.zoom ?? null; } catch { /* optional browser API */ }
  if (caps && (zoom < Number(caps.min) || zoom > Number(caps.max))) {
    throw new Error(`${zoom}x zoom is not supported by this camera. Available range: ${caps.min}x–${caps.max}x.`);
  }
  if (typeof track.applyConstraints !== 'function') {
    throw new Error('This browser does not expose camera zoom controls for this camera.');
  }
  try {
    await track.applyConstraints({ advanced: [{ zoom }] });
    R.zoom = zoom;
    drawControls();
    toast(`Camera zoom set to ${zoom}x.`);
  } catch (error) {
    throw new Error(`${zoom}x zoom is not available on this phone/browser. Try another zoom level or use the phone's supported camera settings.`);
  }
}

function drawPanel() {
  const el = $('#rm-panel'); if (!el) return;
  el.innerHTML = R.reporting
    ? `<section class="card"><h3>Report ${esc(R.reporting.name)}</h3><div class="field" style="flex:none"><label for="rp-why">What happened?</label><select id="rp-why">${REASONS.map((r) => `<option>${r}</option>`).join('')}</select></div><div class="row"><button class="btn gold sm" data-act="sendReport">Send report</button><button class="btn sm" data-act="cancelReport">Cancel</button></div></section>`
    : '';
}


// ---------------------------------------------------------------- coach-led rep rounds
// The coach starts a round for everyone. Each member's phone counts their reps on the phone itself
// (no video leaves the phone for this) and reports the count. When the coach completes the round,
// the results are final: most reps first, then the quickest time.
const REP_EX = { squat: 'Squats', press_up: 'Press-ups', jumping_jack: 'Jumping jacks' };
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, '0')}`;

function currentLocalVideoTrack() {
  const local = R.call?.participants?.()?.local;
  const t = local?.tracks?.video;
  if (!t || t.state !== 'playable') return null;
  return t.persistentTrack || t.track || null;
}

async function loadRound() {
  if (R.kind !== 'session' || !R.sessionId) return;
  try {
    const rows = await q(sb.from('rep_rounds').select('*').eq('session_id', R.sessionId).order('started_at', { ascending: false }).limit(1));
    R.round = rows[0] || null;
  } catch { return; }
  await syncRound();
}

async function syncRound() {
  const r = R.round;
  const open = !!(r && !r.ended_at);
  clearInterval(R.resultsTimer); R.resultsTimer = 0;
  if (r) {
    await loadResults();
    if (open) R.resultsTimer = setInterval(loadResults, 4000);
  }
  if (!R.info?.isHost) {
    if (open && R.countingRound !== r.id) await startCounting();
    else if (!open && R.countingRound) await stopCounting();
  }
  drawRepPanel();
}

async function loadResults() {
  if (!R.round) return;
  try { R.results = await q(sb.rpc('rep_results', { p_round: R.round.id })); } catch { /* keep the last results */ }
  drawResults();
}

async function startCounting() {
  const r = R.round;
  if (!r || R.countingRound === r.id || R.repStarting) return;
  if (R.noCall) { R.repMsg = 'This browser blocks the camera, so your reps cannot be counted here. Use Safari on iPhone or Chrome on Android.'; return; }
  const track = currentLocalVideoTrack();
  if (!R.cam || !track || track.readyState === 'ended') { R.repMsg = 'Turn your camera on to be counted. Stand back so your whole body is in view.'; return; }
  R.repStarting = true; R.repMsg = 'Getting ready to count…'; drawRepPanel();
  try {
    if (R.counter) { try { await R.counter.stop(); } catch { /* already stopped */ } R.counter = null; }
    R.myReps = 0; R.sentReps = -1; R.countStart = Date.now();
    let video = $('#rm-rep-cam');
    if (!video) { video = document.createElement('video'); video.id = 'rm-rep-cam'; video.muted = true; video.playsInline = true; video.setAttribute('playsinline', ''); video.style.cssText = 'position:fixed;width:2px;height:2px;opacity:0;pointer-events:none;left:0;top:0'; document.body.appendChild(video); }
    video.srcObject = new MediaStream([track]);
    try { await video.play(); } catch { /* muted video normally plays */ }
    await submitReps(true);
    R.counter = await createRepCounter(video, r.exercise, (n) => { R.myReps = n; drawMyCount(); submitReps(); });
    if (R.round?.id !== r.id || !R.joined) { await R.counter.stop(); R.counter = null; return; }
    R.countingRound = r.id; R.repMsg = '';
    R.repTick = setInterval(drawMyCount, 1000);
    try { navigator.vibrate?.(80); } catch { /* not available */ }
  } catch (e) {
    R.repMsg = e.message || 'The rep counter could not start on this phone.';
  } finally { R.repStarting = false; drawRepPanel(); }
}

async function stopCounting() {
  clearInterval(R.repTick); R.repTick = 0;
  const c = R.counter; R.counter = null;
  try { await c?.stop(); } catch { /* already stopped */ }
  await submitReps(true);
  R.countingRound = null;
  const v = $('#rm-rep-cam'); if (v) { v.srcObject = null; v.remove(); }
}

// Sends the count at most every 2 seconds, and always at the start and end.
async function submitReps(now = false) {
  const r = R.round; if (!r) return;
  if (!now && (R.sendTimer || R.myReps === R.sentReps)) { if (!R.sendTimer) R.sendTimer = setTimeout(() => { R.sendTimer = 0; submitReps(true); }, 2000); return; }
  clearTimeout(R.sendTimer); R.sendTimer = 0;
  const reps = R.myReps;
  try { const kept = await q(sb.rpc('submit_reps', { p_round: r.id, p_reps: reps })); R.sentReps = reps; if (typeof kept === 'number' && kept < reps) { R.myReps = kept; } } catch { /* the next report will retry */ }
}

function drawMyCount() {
  const n = $('#rm-my-reps'); if (n) n.textContent = String(R.myReps);
  const t = $('#rm-my-time'); if (t && R.countStart) t.textContent = mmss((Date.now() - R.countStart) / 1000);
}

function drawResults() {
  const el = $('#rm-results'); if (!el) return;
  const r = R.round;
  if (!r) { el.innerHTML = ''; return; }
  const open = !r.ended_at;
  const rows = R.results || [];
  const place = (i) => ['1st', '2nd', '3rd'][i] || `${i + 1}th`;
  el.innerHTML = `<h3>${open ? 'Live' : 'Final results'}: ${REP_EX[r.exercise]}</h3>
${rows.length ? `<ol class="board">${rows.map((x, i) => `<li class="${i < 3 && !open ? 'top' : ''} ${x.is_me ? 'mine' : ''}"><span class="pl">${place(i)}</span><span class="grow">${esc(x.display_name)}${x.is_me ? ' · You' : ''}${R.info?.isHost && x.room_no ? ` <span class="meta">· Room ${x.room_no}</span>` : ''}</span><strong>${x.reps}</strong><span class="meta">${x.reps ? mmss(x.seconds) : '–'}</span></li>`).join('')}</ol>`
    : `<p class="meta">${open ? 'Counts appear here as members start moving.' : 'Nobody was counted in this round.'}</p>`}
${!open ? '<p class="meta">Ranked by most reps, then the quickest time from starting to the last rep.</p>' : ''}`;
}

function drawRepPanel() {
  const el = $('#rm-rep');
  if (!el || R.kind !== 'session') return;
  const r = R.round, open = !!(r && !r.ended_at);
  if (R.info?.isHost) {
    el.innerHTML = `<section class="card rep-card"><h3>Rep count</h3>
${open ? `<p>Counting <b>${REP_EX[r.exercise]}</b> for everyone. Members with their camera on are being counted.</p><div class="row"><button class="btn gold" data-act="repEnd">${icon('check')}Complete reps</button></div>`
    : `<p class="meta">Pick an exercise and start. Every member's phone counts their reps until you tap Complete reps.</p><div class="row">${Object.entries(REP_EX).map(([k, v]) => `<button class="btn sm" aria-pressed="${R.pickEx === k}" data-act="repPick" data-ex="${k}">${v}</button>`).join('')}</div><div class="row"><button class="btn gold" data-act="repGo">${icon('play')}Count reps for everyone</button></div>`}
<div id="rm-results"></div></section>`;
  } else {
    el.innerHTML = r || R.repMsg ? `<section class="card rep-card">${open ? `<p class="eyebrow">Coach started: ${REP_EX[r.exercise]}</p>
<div class="row" style="align-items:flex-end"><span class="bigcount" id="rm-my-reps">${R.myReps}</span><span class="meta grow">your reps · <span id="rm-my-time">${R.countStart && R.countingRound ? mmss((Date.now() - R.countStart) / 1000) : '0:00'}</span></span></div>` : ''}
${R.repMsg ? `<p class="${R.countingRound ? 'meta' : 'err'}">${esc(R.repMsg)}</p>${open && !R.repStarting && !R.countingRound ? '<div class="row"><button class="btn sm" data-act="repRetry">Try again</button></div>' : ''}` : ''}
${open && R.countingRound ? '<p class="meta">Keep your whole body in view. Your phone counts; only the number is shared. Stop if you feel pain or dizziness.</p>' : ''}
<div id="rm-results"></div></section>` : '';
  }
  drawResults();
}

function drawHostPanel() {
  const el = $('#rm-host'); if (!el || R.kind !== 'session' || !R.info?.isHost) return;
  const members = R.roster.filter((r) => !r.is_host);
  el.innerHTML = `<div class="row"><button class="btn gold sm" data-act="next">Show the next six</button></div>
<section class="card"><h3>Names for shout-outs</h3><p class="meta">Tap a name once you have called it.</p><div class="row">${members.map((m) => `<button class="btn sm" aria-pressed="${!!R.called[m.user_id]}" data-act="shout" data-id="${m.user_id}">${esc(m.display_name)} · ${m.room_no}</button>`).join('') || '<span class="meta">Nobody has joined yet.</span>'}</div></section>`;
}

const skeleton = () => `<div id="rm-head"></div>
<section class="stage" ${R.kind === 'call' ? 'style="grid-template-columns:minmax(0,1fr)"' : ''}>${R.kind === 'call' ? '' : '<div id="rm-yt-wrap" class="tile yt" hidden></div><div id="rm-big" style="min-width:0"></div>'}<div id="rm-grid" class="mgrid" ${R.kind === 'call' ? 'style="grid-template-columns:repeat(2,minmax(0,1fr))"' : ''}></div>${R.kind === 'call' ? '<div id="rm-big" hidden></div>' : ''}</section>
<p id="rm-note" class="meta" hidden></p>
<div id="rm-panel"></div>
<div id="rm-rep"></div>
<div id="rm-controls" class="row"></div>
<div id="rm-video"></div>
<div id="rm-host" class="stack"></div>
<div id="rm-audio"></div>
<p class="note">Recording or taking screenshots of other members breaks the code of conduct.</p>`;

function drawRoom() {
  $('#main').innerHTML = skeleton();
  drawHead(); drawControls(); drawPanel(); drawRepPanel(); drawVideoPanel(); drawHostPanel(); sync();
  if (R.kind === 'session') applyVideo();
}

// ---------------------------------------------------------------- the session video (YouTube)
// Everyone plays the same video at the same point. By default it follows the session clock:
// it starts at the session's start time, so it runs even when the trainer is not live.
// The trainer or an admin can play, pause or restart it for everyone.
let ytApi = null;
function loadYouTube() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!ytApi) {
    ytApi = new Promise((resolve, reject) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { try { prev?.(); } catch { /* ignore */ } resolve(window.YT); };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.onerror = () => { ytApi = null; reject(new Error('YouTube did not load')); };
      document.head.appendChild(s);
    });
  }
  return ytApi;
}

// Where the video should be right now, in seconds, and whether it should be playing.
function videoTarget() {
  const s = R.session;
  const now = (Date.now() + R.skew) / 1000;
  if (s.video_state === 'paused') return { pos: +s.video_offset || 0, play: false };
  if (s.video_state === 'playing') return { pos: (+s.video_offset || 0) + Math.max(0, now - new Date(s.video_started_at).getTime() / 1000), play: true };
  const start = new Date(s.starts_at).getTime() / 1000;
  return now < start ? { pos: 0, play: false, waiting: true } : { pos: now - start, play: true };
}

function ytMessage(text, needTap) {
  const el = $('#rm-yt-wrap .ytmsg');
  if (!el) return;
  el.hidden = !text && !needTap;
  el.innerHTML = needTap
    ? `<span>Tap to start the video on this phone.</span><button class="btn gold sm" data-act="ytstart">${icon('play')}Start the video</button>`
    : esc(text);
}

const ytHolder = () => '<div id="rm-yt"></div><div class="ytshield"></div><div class="ytmsg" hidden></div>';

async function applyVideo() {
  if (R.kind !== 'session' || !R.joined) return;
  const wrap = $('#rm-yt-wrap');
  if (!wrap) return;
  const id = youtubeId(R.session.video_url);
  if (!id) {
    if (R.yt) { try { R.yt.destroy(); } catch { /* ignore */ } R.yt = null; }
    R.ytId = ''; R.ytReady = false; wrap.hidden = true; wrap.innerHTML = '';
    kick();
    return;
  }
  wrap.hidden = false;
  if (R.ytId !== id) {
    R.ytId = id; R.ytReady = false;
    if (R.yt) { try { R.yt.destroy(); } catch { /* ignore */ } R.yt = null; }
    wrap.innerHTML = ytHolder();
    kick();
    try {
      const YT = await loadYouTube();
      if (R.ytId !== id || !$('#rm-yt')) return;
      R.yt = new YT.Player('rm-yt', {
        videoId: id, width: '100%', height: '100%',
        playerVars: { playsinline: 1, controls: 0, disablekb: 1, rel: 0, modestbranding: 1, iv_load_policy: 3, fs: 0 },
        events: {
          onReady: () => { R.ytReady = true; applyVideo(); },
          onStateChange: (e) => { if (e.data === 1) ytMessage(''); },
          onError: (e) => ytMessage(e.data === 101 || e.data === 150
            ? 'The owner of this video does not allow it to play on other sites. The trainer needs to choose another video.'
            : 'This video could not be played. The trainer may need to check the link.'),
        },
      });
    } catch { ytMessage('YouTube did not load. Check your connection.'); }
    return;
  }
  if (!R.ytReady || !R.yt?.getPlayerState) return;
  const t = videoTarget();
  const state = R.yt.getPlayerState();
  const duration = R.yt.getDuration() || 0;
  if (duration && t.pos >= duration - 1) {
    if (state === 1 || state === 3) R.yt.pauseVideo();
    ytMessage('The video has finished.');
    return;
  }
  const playingNow = state === 1 || state === 3;
  if (t.play) {
    if (Math.abs((R.yt.getCurrentTime() || 0) - t.pos) > 3) R.yt.seekTo(t.pos, true);
    if (!playingNow) {
      R.yt.playVideo();
      clearTimeout(R.ytCheck);
      // Phones can block a video that starts by itself. Then one tap starts it.
      R.ytCheck = setTimeout(() => { if (R.yt?.getPlayerState && R.yt.getPlayerState() !== 1 && videoTarget().play) ytMessage('', true); }, 2500);
    }
  } else {
    if (playingNow) R.yt.pauseVideo();
    if (state === 2 && Math.abs((R.yt.getCurrentTime() || 0) - t.pos) > 3) R.yt.seekTo(t.pos, true);
    ytMessage(t.waiting ? `The video starts at ${fmtTime(R.session.starts_at)}.` : 'The trainer has paused the video.');
  }
}

async function setVideo(args) {
  await q(sb.rpc('set_session_video', { p_session: R.sessionId, ...args }));
  R.session = await q(sb.from('sessions').select('*').eq('id', R.sessionId).single());
  drawVideoPanel();
  applyVideo();
}

// The trainer's video controls. Drawn only when the video changes, so typing a link is never interrupted.
function drawVideoPanel() {
  const el = $('#rm-video');
  if (!el || R.kind !== 'session' || !R.info?.isHost) return;
  const s = R.session;
  const has = !!youtubeId(s.video_url);
  const mode = !has ? '' : s.video_state === 'playing' ? 'Playing for everyone.' : s.video_state === 'paused' ? 'Paused for everyone.' : `Following the session clock: it plays from ${fmtTime(s.starts_at)}.`;
  el.innerHTML = `<section class="card"><h3>Video for members</h3>
<p class="meta">Members watch it and follow along. Your camera is optional: you can turn it off and let the video lead.</p>
<form class="row" data-form="ytset"><div class="field"><label for="rm-ytlink">YouTube link</label><input type="text" id="rm-ytlink" inputmode="url" autocomplete="off" placeholder="https://youtu.be/..." value="${esc(s.video_url || '')}"></div><button class="btn sm" type="submit" style="align-self:flex-end">${has ? 'Change video' : 'Share video'}</button></form>
${has ? `<div class="row"><button class="btn gold sm" data-act="ytplay">${icon('play')}Play for everyone</button><button class="btn sm" data-act="ytpause">Pause for everyone</button><button class="btn sm" data-act="ytrestart">Start again</button>${s.video_state ? '<button class="btn sm" data-act="ytauto">Follow the session clock</button>' : ''}<button class="btn sm bad" data-act="ytremove">Remove video</button></div><p class="meta">${mode}</p>` : ''}
</section>`;
}

// ---------------------------------------------------------------- connecting and leaving
async function connect({ url, token, camOn, micOn, autoSubscribe }) {
  const lib = dailyLib();
  if (!lib) throw new Error('The video library did not load. Check your connection and reload the page.');
  const call = lib.createCallObject({ subscribeToTracksAutomatically: !!autoSubscribe });
  R.call = call;
  ['participant-joined', 'participant-updated', 'participant-left', 'track-started', 'track-stopped'].forEach((ev) => call.on(ev, kick));
  call.on('camera-error', () => toast('Your camera or microphone is blocked. Allow it in your browser settings.'));
  call.on('error', (e) => { if (R.joined) leave(e?.errorMsg || 'The video connection was lost.'); });
  call.on('left-meeting', () => { if (R.joined) leave('The room has closed.'); });
  call.on('app-message', (e) => { if (typeof e?.data?.reps === 'number') { R.theirReps = e.data.reps; drawControls(); } });
  await call.join({ url, token, startVideoOff: !camOn, startAudioOff: !micOn });
  try { await call.updateSendSettings({ video: 'bandwidth-optimized' }); } catch { /* older browsers */ }
  R.cam = camOn; R.mic = micOn; R.joined = true;
  try { R.wake = await navigator.wakeLock?.request('screen'); } catch { /* not available */ }
}

async function loadRoster() {
  if (!R.sessionId || !R.joined) return;
  try { R.roster = await q(sb.rpc('session_roster', { p_session: R.sessionId })); } catch { return; }
  const mine = R.roster.find((r) => r.user_id === uid());
  if (mine && !mine.is_host && mine.room_no !== R.info.roomNo) { R.info.roomNo = mine.room_no; drawHead(); toast(`You are now in room ${mine.room_no}.`); }
  kick();
}

function cleanup() {
  // Send the last count before marking the member as having left.
  const savePromise = R.countingRound ? stopCounting() : Promise.resolve();
  clearInterval(R.resultsTimer); clearInterval(R.repTick); clearTimeout(R.sendTimer);
  const { call, sessionId, joined } = R;
  R.joined = false;
  R.timers.forEach(clearInterval);
  R.channels.forEach((c) => sb.removeChannel(c));
  cancelAnimationFrame(R.raf);
  clearTimeout(R.ytCheck);
  try { R.yt?.destroy(); } catch { /* ignore */ }
  try { R.wake?.release(); } catch { /* ignore */ }
  if (call) { Promise.resolve(call.leave()).catch(() => {}).finally(() => { try { call.destroy(); } catch { /* ignore */ } }); }
  if (sessionId && joined) Promise.resolve(savePromise).catch(() => {}).finally(() => sb.rpc('leave_session', { p_session: sessionId }).then(() => {}, () => {}));
  Object.assign(R, fresh());
}

function leave(message) {
  if (message) toast(message);
  cleanup();
  go('home');
}

function noVideoHelp(e) {
  const m = String(e?.message || e?.errorMsg || e || '');
  return /webrtc|not supported|suppressed/i.test(m)
    ? 'This browser blocks live video. Open fitvive.club in Safari (iPhone) or Chrome (Android or laptop) and try again.'
    : m || 'The video connection failed. Try again.';
}

async function enterSession(session) {
  const camOn = $('#rm-cam') ? $('#rm-cam').checked : !S.profile.cam_off_default;
  const lowData = $('#rm-low') ? $('#rm-low').checked : S.profile.low_data;
  const info = await fn('video-token', { kind: 'session', sessionId: session.id });
  Object.assign(R, fresh(), { kind: 'session', sessionId: session.id, session, info, lowData });
  try { await connect({ url: info.url, token: info.token, camOn, micOn: !!info.isTrainer, autoSubscribe: false }); }
  catch (e) {
    // No live video in this browser (some privacy browsers and in-app browsers block it).
    // If the session has a video, the member can still follow it. Otherwise, explain what to do.
    if (!youtubeId(session.video_url)) { cleanup(); throw new Error(noVideoHelp(e)); }
    const c = R.call; R.call = null;
    if (c) { Promise.resolve(c.leave()).catch(() => {}).finally(() => { try { c.destroy(); } catch { /* ignore */ } }); }
    Object.assign(R, { joined: true, noCall: true, cam: false, mic: false });
    toast('Live video does not work in this browser, so you are following the session video only.');
  }
  try {
    const t0 = Date.now();
    const serverNow = await q(sb.rpc('server_now'));
    R.skew = new Date(serverNow).getTime() - (t0 + Date.now()) / 2;
  } catch { R.skew = 0; }
  drawRoom();
  await loadRoster();
  R.timers.push(setInterval(applyVideo, 4000));

  R.timers.push(setInterval(async () => {
    try {
      const room = await q(sb.rpc('heartbeat', { p_session: R.sessionId }));
      if (room === -1) { leave('Your training time has run out. Top up to keep training.'); return; }
      if (room === null) await q(sb.rpc('join_session', { p_session: R.sessionId }));
    } catch { /* try again next time */ }
    loadRoster();
  }, 30000));
  if (info.isHost) R.timers.push(setInterval(() => { R.rot++; kick(); }, 20000));

  let debounce = 0;
  const ch = sb.channel('room-' + session.id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'session_participants', filter: `session_id=eq.${session.id}` }, () => { clearTimeout(debounce); debounce = setTimeout(loadRoster, 400); })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${session.id}` }, (p) => {
      if (p.new.status !== 'scheduled') { if (R.joined) leave('The trainer ended the session.'); return; }
      const changed = p.new.video_url !== R.session.video_url;
      Object.assign(R.session, p.new);
      drawVideoPanel(); applyVideo();
      if (changed && !R.info.isHost) toast(p.new.video_url ? 'The trainer shared a video.' : 'The trainer removed the video.');
    })
    .subscribe();
  R.channels.push(ch);
  // Rep rounds: the coach's start and complete reach every phone at once.
  R.channels.push(sb.channel('reps-' + session.id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rep_rounds', filter: `session_id=eq.${session.id}` }, () => loadRound())
    .subscribe());
  R.timers.push(setInterval(() => { if (R.round && !R.round.ended_at) loadRound(); }, 15000));
  loadRound();
}

async function enterCall(callRow, name) {
  const pass = pending && pending.callId === callRow.id ? pending : await fn('video-token', { kind: 'partner', callId: callRow.id });
  pending = null;
  Object.assign(R, fresh(), { kind: 'call', partnerName: name });
  try { await connect({ url: pass.url, token: pass.token, camOn: !S.profile.cam_off_default, micOn: true, autoSubscribe: true }); }
  catch (e) { cleanup(); throw new Error(noVideoHelp(e)); }
  drawRoom();
}

const common = {
  mic() { R.mic = !R.mic; R.call?.setLocalAudio(R.mic); drawControls(); },
  cam() {
    R.cam = !R.cam; R.call?.setLocalVideo(R.cam); drawControls(); kick();
    // Turning the camera on during a rep round starts the counting for this member.
    if (R.cam && R.kind === 'session' && R.round && !R.round.ended_at && !R.countingRound) setTimeout(() => { R.repMsg = ''; startCounting(); }, 1500);
  },
  zoom(el) { return setCameraZoom(Number(el.dataset.zoom)); },
  leave() { leave(R.kind === 'call' ? 'Workout ended.' : 'You left the room.'); },
};

export const views = {
  // ---------------------------------------------------------------- a trainer-led session
  room: {
    access: 'member',
    load: async ([id]) => {
      const session = await q(sb.from('sessions').select('*').eq('id', id).maybeSingle());
      if (!session) throw new Error('This session was not found.');
      let trainer = 'Trainer to be confirmed';
      if (session.trainer_id) trainer = (await q(sb.from('member_cards').select('display_name').eq('id', session.trainer_id).maybeSingle()))?.display_name || trainer;
      return { session, trainer };
    },
    render: ({ session, trainer }) => {
      const st = sessionState(session);
      const trainerMe = session.trainer_id === uid();
      const host = trainerMe || S.profile.role === 'admin';
      const canJoin = host ? st !== 'ended' : st === 'live' || st === 'open';
      const why = st === 'ended' ? 'This session has ended.' : `Join opens 5 minutes before ${fmtTime(session.starts_at)}.`;
      return `<section class="card glow" style="padding:clamp(20px,4vw,36px)"><div class="eyebrow">${st === 'live' ? 'Live now' : fmtDay(session.starts_at)}</div><h2>${esc(session.title)} with <i>${esc(trainer)}</i></h2><p>${fmtTime(session.starts_at)} · ${session.duration_min} min${session.women_only ? ' · Women only' : ''}</p>${session.video_url ? '<p class="meta">This session has a video to follow. It plays for everyone together from the start time.</p>' : ''}${window.RTCPeerConnection ? '' : '<p class="err">This browser blocks live video, so cameras will not show. On iPhone, open fitvive.club in Safari instead.</p>'}
${canJoin ? `<label class="check" for="rm-cam"><input type="checkbox" id="rm-cam" ${S.profile.cam_off_default ? '' : 'checked'}><span>Join with my camera on</span></label>
${host ? '' : `<label class="check" for="rm-low"><input type="checkbox" id="rm-low" ${S.profile.low_data ? 'checked' : ''}><span>Low-data mode: the trainer and 2 members only</span></label>`}
<div class="row"><button class="btn gold" data-act="enter">${icon('play')}${trainerMe ? 'Start broadcasting' : host ? 'Join as a host' : 'Join the room'}</button><a class="btn" href="#/timetable">Back</a></div>
<p class="meta">Your browser will ask to use your camera and microphone. Your mic starts ${trainerMe ? 'on' : 'off'}.${host && !trainerMe ? ' As an admin you appear to every room as a host.' : ''}</p>`
        : `<p class="meta">${why}</p><div class="row"><a class="btn" href="#/timetable">Back to the timetable</a></div>`}</section>`;
    },
    mount: () => cleanup,
    forms: {
      async ytset() {
        const url = $('#rm-ytlink').value.trim();
        if (!youtubeId(url)) throw new Error('Paste a YouTube video link, for example https://youtu.be/abc123XYZ00');
        await setVideo({ p_url: url });
        toast('Video shared with everyone in the session.');
      },
    },
    actions: {
      ...common,
      enter: (_, data) => enterSession(data.session),
      low() { R.lowData = !R.lowData; drawControls(); kick(); },
      repPick(el) { if (REP_EX[el.dataset.ex]) { R.pickEx = el.dataset.ex; drawRepPanel(); } },
      async repGo() { await q(sb.rpc('start_rep_round', { p_session: R.sessionId, p_exercise: R.pickEx })); await loadRound(); toast(`Counting ${REP_EX[R.pickEx].toLowerCase()} for everyone.`); },
      async repEnd() { await q(sb.rpc('end_rep_round', { p_session: R.sessionId })); await loadRound(); toast('Reps complete. Final results are up.'); },
      async repRetry() { R.repMsg = ''; await startCounting(); },
      next() { R.rot++; kick(); },
      ytstart() { try { R.yt?.unMute(); R.yt?.playVideo(); } catch { /* not ready */ } ytMessage(''); setTimeout(applyVideo, 800); },
      ytplay() {
        const s = R.session;
        const from = s.video_state === 'paused' ? +s.video_offset || 0 : (R.yt?.getCurrentTime?.() ?? videoTarget().pos);
        return setVideo({ p_mode: 'play', p_offset: from });
      },
      ytpause() { return setVideo({ p_mode: 'pause', p_offset: R.yt?.getCurrentTime?.() ?? videoTarget().pos }); },
      ytrestart() { return setVideo({ p_mode: 'play', p_offset: 0 }); },
      ytauto() { return setVideo({ p_mode: 'auto' }); },
      async ytremove() { await setVideo({ p_url: '' }); toast('Video removed.'); },
      shout(el) { R.called[el.dataset.id] = !R.called[el.dataset.id]; drawHostPanel(); },
      report(el) { R.reporting = { id: el.dataset.id, name: el.dataset.n }; drawPanel(); $('#rp-why')?.focus(); },
      cancelReport() { R.reporting = null; drawPanel(); },
      async sendReport() {
        await q(sb.from('reports').insert({ reporter_id: uid(), reported_id: R.reporting.id, session_id: R.sessionId, reason: $('#rp-why').value }));
        R.reporting = null; drawPanel();
        toast('Report sent to the club admins.');
      },
      async endSession() {
        const id = R.sessionId;
        if (R.round && !R.round.ended_at) { try { await q(sb.rpc('end_rep_round', { p_session: id })); } catch { /* the session is ending anyway */ } }
        await q(sb.rpc('end_session', { p_session: id }));
        leave('Session ended in every room.');
      },
    },
  },

  // ---------------------------------------------------------------- a one-to-one partner workout
  call: {
    access: 'member',
    load: async ([id]) => {
      const call = await q(sb.from('partner_calls').select('*').eq('id', id).maybeSingle());
      if (!call) throw new Error('This workout invite was not found.');
      const other = call.from_id === uid() ? call.to_id : call.from_id;
      const name = (await q(sb.from('member_cards').select('display_name').eq('id', other).maybeSingle()))?.display_name || 'Your partner';
      return { call, name };
    },
    render: ({ call, name }) => {
      const expired = new Date(call.expires_at) < new Date();
      if (expired) return `<section class="card">${head('Partner workout', 'This invite has <i>expired.</i>', 'Start a new workout from Partners.')}<div class="row"><a class="btn" href="#/partners">Open Partners</a></div></section>`;
      return `<section class="card glow">${head('Partner workout', `Work out with <i>${esc(name)}${stop(name)}</i>`, 'You will see and hear each other. Your browser will ask to use your camera and microphone.')}<div class="row"><button class="btn gold" data-act="enter" id="call-enter">Join the workout</button><a class="btn" href="#/partners">Back</a></div></section>`;
    },
    mount: ({ call }) => {
      // The person who started the workout joins straight away.
      if (pending && pending.callId === call.id) setTimeout(() => $('#call-enter')?.click(), 0);
      return cleanup;
    },
    actions: {
      ...common,
      enter: (_, data) => enterCall(data.call, data.name),
      rep() { R.reps++; try { R.call?.sendAppMessage({ reps: R.reps }, '*'); } catch { /* not connected */ } drawControls(); },
    },
  },
};
