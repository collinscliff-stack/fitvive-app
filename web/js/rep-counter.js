// Browser-only Fitvive repetition counter.
// TensorFlow.js MoveNet runs locally. This module never uploads camera frames or stops the Daily camera track.
const TF_VERSION = '4.22.0';
const POSE_VERSION = '2.1.3';
let libsPromise = null;

function loadScript(src, test) {
  if (test()) return Promise.resolve();
  const existing = [...document.scripts].find((s) => s.src === src);
  if (existing) return new Promise((resolve, reject) => {
    if (test()) resolve();
    else { existing.addEventListener('load', resolve, { once: true }); existing.addEventListener('error', reject, { once: true }); }
  });
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.onload = resolve;
    script.onerror = () => { script.remove(); reject(new Error('The exercise model could not load. Check your connection and try again.')); };
    document.head.appendChild(script);
  });
}

async function loadModel() {
  if (!libsPromise) {
    libsPromise = (async () => {
      await loadScript(`https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-core@${TF_VERSION}/dist/tf-core.min.js`, () => !!window.tf?.engine);
      await loadScript(`https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-converter@${TF_VERSION}/dist/tf-converter.min.js`, () => !!window.tf?.loadGraphModel);
      await loadScript(`https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-webgl@${TF_VERSION}/dist/tf-backend-webgl.min.js`, () => !!window.tf?.findBackend('webgl'));
      await loadScript(`https://cdn.jsdelivr.net/npm/@tensorflow-models/pose-detection@${POSE_VERSION}/dist/pose-detection.min.js`, () => !!window.poseDetection?.SupportedModels);
      const tf = window.tf;
      if (!tf || !window.poseDetection) throw new Error('The exercise model did not initialise. Reload the room and try again.');
      try { await tf.setBackend('webgl'); await tf.ready(); }
      catch { throw new Error('This phone could not start browser pose detection. Try the latest Safari or Chrome and close other heavy apps.'); }
      return window.poseDetection;
    })().catch((error) => { libsPromise = null; throw error; });
  }
  const poseDetection = await libsPromise;
  // A new detector per workout: stop() disposes it, while the CDN libraries stay cached.
  return poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
    modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
    enableSmoothing: true,
  });
}

function angle(a, b, c) {
  const abx = a.x - b.x, aby = a.y - b.y;
  const cbx = c.x - b.x, cby = c.y - b.y;
  const dot = abx * cbx + aby * cby;
  const den = Math.hypot(abx, aby) * Math.hypot(cbx, cby);
  if (!den) return 180;
  return Math.acos(Math.max(-1, Math.min(1, dot / den))) * 180 / Math.PI;
}
function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function midpoint(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

function getPoints(pose) {
  const out = {};
  for (const p of pose?.keypoints || []) out[p.name] = p;
  return out;
}
function good(...points) { return points.every((p) => p && (p.score ?? 1) >= 0.25); }

function squatSignal(k) {
  const left = good(k.left_hip, k.left_knee, k.left_ankle)
    ? angle(k.left_hip, k.left_knee, k.left_ankle) : null;
  const right = good(k.right_hip, k.right_knee, k.right_ankle)
    ? angle(k.right_hip, k.right_knee, k.right_ankle) : null;
  const values = [left, right].filter(Number.isFinite);
  return values.length ? Math.min(...values) : null;
}
function pressUpSignal(k) {
  const left = good(k.left_shoulder, k.left_elbow, k.left_wrist)
    ? angle(k.left_shoulder, k.left_elbow, k.left_wrist) : null;
  const right = good(k.right_shoulder, k.right_elbow, k.right_wrist)
    ? angle(k.right_shoulder, k.right_elbow, k.right_wrist) : null;
  const values = [left, right].filter(Number.isFinite);
  return values.length ? Math.min(...values) : null;
}
function jumpingJackOpen(k) {
  if (!good(k.left_shoulder, k.right_shoulder, k.left_wrist, k.right_wrist,
    k.left_hip, k.right_hip, k.left_ankle, k.right_ankle)) return null;
  const shoulder = midpoint(k.left_shoulder, k.right_shoulder);
  const hip = midpoint(k.left_hip, k.right_hip);
  const shoulderWidth = Math.max(1, distance(k.left_shoulder, k.right_shoulder));
  const ankleWidth = distance(k.left_ankle, k.right_ankle);
  const wristsUp = k.left_wrist.y < shoulder.y - shoulderWidth * 0.12
    && k.right_wrist.y < shoulder.y - shoulderWidth * 0.12;
  const feetApart = ankleWidth > shoulderWidth * 1.35;
  const armsDown = k.left_wrist.y > shoulder.y + shoulderWidth * 0.1
    && k.right_wrist.y > shoulder.y + shoulderWidth * 0.1;
  const feetTogether = ankleWidth < shoulderWidth * 1.05;
  if (wristsUp && feetApart) return true;
  if (armsDown && feetTogether && hip.y > shoulder.y) return false;
  return null;
}

export async function createRepCounter(video, exercise, onCount) {
  if (!video || !onCount) throw new Error('The rep counter is missing its video or count handler.');
  if (!['squat', 'press_up', 'jumping_jack'].includes(exercise)) throw new Error('Choose a supported exercise.');
  const detector = await loadModel();
  let stopped = false, busy = false, raf = 0, count = 0, lastRun = 0;
  let phase = exercise === 'jumping_jack' ? 'closed' : 'up';
  const interval = 170; // roughly 5–6 inferences per second for mid-range phones
  const run = async (now) => {
    if (stopped) return;
    raf = requestAnimationFrame(run);
    if (document.hidden || busy || now - lastRun < interval || video.readyState < 2 || !video.videoWidth) return;
    lastRun = now; busy = true;
    try {
      const poses = await detector.estimatePoses(video, { maxPoses: 1, flipHorizontal: false });
      const k = getPoints(poses?.[0]);
      let next = null;
      if (exercise === 'squat') {
        const value = squatSignal(k);
        if (value !== null) {
          if (phase === 'up' && value < 105) phase = 'down';
          else if (phase === 'down' && value > 150) { phase = 'up'; next = true; }
        }
      } else if (exercise === 'press_up') {
        const value = pressUpSignal(k);
        if (value !== null) {
          if (phase === 'up' && value < 95) phase = 'down';
          else if (phase === 'down' && value > 155) { phase = 'up'; next = true; }
        }
      } else {
        const open = jumpingJackOpen(k);
        if (open === true && phase === 'closed') phase = 'open';
        else if (open === false && phase === 'open') { phase = 'closed'; next = true; }
      }
      if (next) { count += 1; onCount(count); }
    } catch (error) {
      // A single missed frame should not end the workout. The next inference will retry.
      if (/disposed|backend/i.test(String(error?.message || ''))) console.warn('Fitvive pose inference:', error);
    } finally { busy = false; }
  };
  raf = requestAnimationFrame(run);
  return {
    get count() { return count; },
    async stop() {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(raf);
      // Wait for an in-flight inference before releasing the detector.
      for (let i = 0; busy && i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 25));
      try { await detector.dispose(); } catch { /* already disposed */ }
    },
  };
}
