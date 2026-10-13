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
  repExercise: 'squat', repCount: 0, repStartedAt: 0, repDuration: 0, repCounter: null,
  repRunning: false, repSaving: false, repSaved: false, repScores: {}, repPreviewStream: null,
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


// ---------------------------------------------------------------- browser-only exercise counter and room leaderboard
const REP_EXERCISES = {
  squat: { label: 'Squats', singular: 'squat' },
  press_up: { label: 'Press-ups', singular: 'press-up' },
  jumping_jack: { label: 'Jumping jacks', singular: 'jumping jack' },
};
const repExerciseLabel = (key) => REP_EXERCISES[key]?.label || 'Exercise';

function currentLocalVideoTrack() {
  const local = R.call?.participants?.()?.local;
  const t = local?.tracks?.video;
  if (!t || t.state !== 'playable') return null;
  return t.persistentTrack || t.track || null;
}

function broadcastRepScore() {
  if (R.kind !== 'session' || !R.call || !R.joined || R.info?.isHost) return;
  const payload = {
    type: 'fitvive-rep-score', sessionId: R.sessionId, roomNo: Number(R.info?.roomNo),
    userId: uid(), name: String(S.profile?.display_name || S.profile?.full_name || 'Member').slice(0, 60),
    exercise: R.repExercise, reps: R.repCount, sentAt: Date.now(),
  };
  try { R.call.sendAppMessage(payload, '*'); } catch { /* a temporary reconnect is harmless */ }
  const key = `${payload.roomNo}:${payload.userId}`;
  R.repScores[key] = { ...payload, sentAt: payload.sentAt };
  updateRepPanel();
}

function drawRepPanel() {
  const el = $('#rm-rep');
  if (!el || R.kind !== 'session' || R.noCall) {
    if (el) el.innerHTML = '';
    return;
  }
  el.innerHTML = `<section class="card rep-card">
    <h3>Rep counter</h3>
    <p class="meta">Choose an exercise, then start counting. Pose detection runs on this phone; only your exercise and count are shared. Keep your camera on and position your full body in view.</p>
    <div class="row rep-exercises" role="group" aria-label="Choose exercise">
      <button class="btn sm ${R.repExercise === 'squat' ? 'gold' : ''}" data-act="repExercise" data-exercise="squat" ${R.repRunning ? 'disabled' : ''}>Squats</button>
      <button class="btn sm ${R.repExercise === 'press_up' ? 'gold' : ''}" data-act="repExercise" data-exercise="press_up" ${R.repRunning ? 'disabled' : ''}>Press-ups</button>
      <button class="btn sm ${R.repExercise === 'jumping_jack' ? 'gold' : ''}" data-act="repExercise" data-exercise="jumping_jack" ${R.repRunning ? 'disabled' : ''}>Jumping jacks</button>
    </div>
    <div class="row" style="align-items:center;margin-top:12px">
      <div class="grow"><div id="rm-rep-count" style="font-size:2rem;font-weight:700;font-variant-numeric:tabular-nums">${R.repCount}</div><div id="rm-rep-status" class="meta">Ready when you are.</div></div>
      <button class="btn gold" id="rm-rep-start" data-act="repStart" ${R.repRunning ? 'hidden' : ''}>Start counting</button>
      <button class="btn bad" id="rm-rep-stop" data-act="repStop" ${R.repRunning ? '' : 'hidden'} ${R.repSaving ? 'disabled' : ''}>Finish and save</button>
    </div>
    <video id="rm-rep-preview" muted playsinline autoplay hidden style="width:100%;max-width:360px;border-radius:12px;margin-top:12px;transform:scaleX(-1)"></video>
    <div id="rm-rep-leaderboard" style="margin-top:16px"></div>
    <p class="meta">Counts are estimates, not a form or medical assessment. Do the movement safely and stop if you feel pain, dizziness or unusual shortness of breath.</p>
  </section>`;
  updateRepPanel();
}

function updateRepPanel() {
  const count = $('#rm-rep-count');
  if (count) count.textContent = String(R.repCount);
  const status = $('#rm-rep-status');
  if (status) status.textContent = R.repSaving ? 'Saving your result…'
    : R.repRunning ? `Counting ${repExerciseLabel(R.repExercise).toLowerCase()} · ${Math.max(0, Math.floor((Date.now() - R.repStartedAt) / 1000))} seconds`
    : R.repSaved ? `Saved: ${R.repCount} ${repExerciseLabel(R.repExercise).toLowerCase()}.`
    : 'Ready when you are.';
  const start = $('#rm-rep-start'), finish = $('#rm-rep-stop');
  if (start) start.hidden = R.repRunning;
  if (finish) { finish.hidden = !R.repRunning; finish.disabled = R.repSaving; }
  document.querySelectorAll('#rm-rep [data-act="repExercise"]').forEach((b) => {
    b.disabled = R.repRunning || R.repSaving;
    b.classList.toggle('gold', b.dataset.exercise === R.repExercise);
  });
  const board = $('#rm-rep-leaderboard');
  if (!board) return;
  const rows = Object.values(R.repScores).filter((s) => !R.info?.isHost ? Number(s.roomNo) === Number(R.info?.roomNo) : true);
  rows.sort((a, b) => a.exercise.localeCompare(b.exercise) || b.reps - a.reps || a.name.localeCompare(b.name));
  const grouped = Object.keys(REP_EXERCISES).map((exercise) => {
    const entries = rows.filter((s) => s.exercise === exercise);
    if (!entries.length) return '';
    return `<div style="margin-top:10px"><h4>${esc(repExerciseLabel(exercise))}</h4><ol>${entries.map((s) =>
      `<li style="display:flex;justify-content:space-between;gap:12px;padding:4px 0"><span>${esc(s.name)}${s.userId === uid() ? ' · You' : ''}</span><strong>${s.reps}</strong></li>`
    ).join('')}</ol></div>`;
  }).join('');
  board.innerHTML = `<h3>Live room leaderboard</h3>${grouped || '<p class="meta">Scores appear here as members count reps.</p>'}`;
}

async function startRepCounter() {
  if (R.kind !== 'session' || R.info?.isHost) return;
  if (!R.joined || !R.call) throw new Error('Join the live room before starting the rep counter.');
  const track = currentLocalVideoTrack();
  if (!track || track.readyState === 'ended') throw new Error('Turn on your Fitvive camera first, then start the rep counter.');
  const video = $('#rm-rep-preview');
  if (!video) throw new Error('The rep counter panel is not ready. Reopen the room and try again.');
  const startedSessionId = R.sessionId;
  R.repCount = 0; R.repDuration = 0; R.repStartedAt = Date.now(); R.repSaved = false;
  R.repPreviewStream = new MediaStream([track]);
  video.srcObject = R.repPreviewStream;
  video.hidden = false;
  try { await video.play(); } catch { /* muted inline video usually plays without a gesture */ }
  R.repRunning = true;
  updateRepPanel();
  try {
    const counter = await createRepCounter(video, R.repExercise, (count) => {
      if (!R.repRunning) return;
      R.repCount = count;
      broadcastRepScore();
    });
    if (R.sessionId !== startedSessionId || !R.joined || !R.repRunning) {
      await counter.stop();
      throw new Error('The room changed while the exercise model was loading. Start again from the live room.');
    }
    R.repCounter = counter;
  } catch (error) {
    R.repRunning = false;
    R.repPreviewStream = null;
    video.srcObject = null; video.hidden = true;
    updateRepPanel();
    throw error;
  }
  // Small, infrequent packets let people who join late catch the current count without video/data streaming.
  R.repHeartbeat = setInterval(broadcastRepScore, 5000);
  broadcastRepScore();
  updateRepPanel();
}

async function finishRepCounter({ quiet = false } = {}) {
  if (R.repSaving) return;
  if (!R.repRunning && (!R.repCounter || R.repSaved)) return;
  R.repSaving = true;
  const sessionId = R.sessionId, exercise = R.repExercise, reps = R.repCount;
  const durationSeconds = Math.min(10800, Math.max(0, Math.floor((Date.now() - (R.repStartedAt || Date.now())) / 1000)));
  broadcastRepScore();
  R.repRunning = false;
  clearInterval(R.repHeartbeat); R.repHeartbeat = 0;
  try { await R.repCounter?.stop?.(); } catch { /* dispose best-effort */ }
  R.repCounter = null;
  const video = $('#rm-rep-preview');
  if (video) { video.pause?.(); video.srcObject = null; video.hidden = true; }
  R.repPreviewStream = null;
  try {
    if (sessionId && reps >= 0 && durationSeconds > 0) {
      await q(sb.rpc('save_exercise_result', {
        p_session: sessionId, p_exercise: exercise, p_reps: reps, p_duration_seconds: durationSeconds,
      }));
    }
    R.repSaved = true;
    R.repDuration = durationSeconds;
    if (!quiet) toast(`Saved ${reps} ${repExerciseLabel(exercise).toLowerCase()}.`);
  } catch (error) {
    if (!quiet) toast(`Could not save your result: ${error.message}`);
    else console.warn('Fitvive rep result could not be saved:', error);
  } finally {
    R.repSaving = false;
    updateRepPanel();
  }
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
  call.on('app-message', (e) => {
    const d = e?.data;
    // Keep the legacy partner-workout rep message working.
    if (typeof d?.reps === 'number' && d?.type !== 'fitvive-rep-score') { R.theirReps = d.reps; drawControls(); return; }
    if (d?.type !== 'fitvive-rep-score' || R.kind !== 'session' || d.sessionId !== R.sessionId) return;
    const mine = uid();
    // Members only see scores from their room. The trainer/admin is the shared host across rooms.
    if (!R.info?.isHost && Number(d.roomNo) !== Number(R.info?.roomNo)) return;
    if (!d.userId || d.userId === mine || !['squat', 'press_up', 'jumping_jack'].includes(d.exercise)) return;
    const key = `${d.roomNo}:${d.userId}`;
    const previous = R.repScores[key];
    if (previous && Number(d.sentAt || 0) < Number(previous.sentAt || 0)) return;
    R.repScores[key] = {
      userId: d.userId, name: String(d.name || 'Member').slice(0, 60),
      roomNo: Number(d.roomNo), exercise: d.exercise,
      reps: Math.max(0, Math.min(10000, Math.floor(Number(d.reps) || 0))),
      sentAt: Number(d.sentAt) || Date.now(),
    };
    updateRepPanel();
  });
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
  // Finish the save before marking the member as having left, so the RPC can verify their session membership.
  const savePromise = R.kind === 'session' && R.repRunning && !R.repSaved
    ? finishRepCounter({ quiet: true }) : Promise.resolve();
  const { call, sessionId, joined } = R;
  R.joined = false;
  R.timers.forEach(clearInterval);
  clearInterval(R.repHeartbeat);
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
  cam() { R.cam = !R.cam; R.call?.setLocalVideo(R.cam); drawControls(); kick(); },
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
      repExercise(el) {
        if (R.repRunning || !REP_EXERCISES[el.dataset.exercise]) return;
        R.repExercise = el.dataset.exercise; R.repCount = 0; R.repSaved = false; updateRepPanel();
      },
      async repStart() { await startRepCounter(); },
      async repStop() { await finishRepCounter(); },
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
        if (R.repRunning) await finishRepCounter({ quiet: true });
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
