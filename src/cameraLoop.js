/**
 * Camera side of the app: `<video>` frame -> detection -> a rolling window of
 * sightings -> the lab runtime.
 *
 * Two layers, deliberately split:
 *   - createVisionPump()   pure, no DOM: sampling budget + rolling window.
 *   - startCameraLoop()    ~40 lines of DOM glue around it (video, canvas, rAF).
 *
 * Why the pump keeps a window: `stabilize()` in perception.js needs a marker to
 * be seen in at least 3 of the last 5 frames before it becomes a placement.
 * Pushing single frames (`runtime.place([frame])`, as docs/APP_WIRING.md used to
 * say) can never satisfy that, so nothing ever appears on the board. The pump
 * hands `place()` the whole recent window instead.
 *
 * Budget (the demo video reads 79 ms/frame at 720p, so detection is the cost):
 *   ARUCO_EVERY = 2      detect on every second camera frame,
 *   MIN_INTERVAL_MS=100  and never more than 10 detections per second.
 * Both are enforced here, not in the app.
 */

/** Default sampling budget. */
export const DETECT_EVERY_N_FRAMES = 2;
export const MIN_DETECT_INTERVAL_MS = 100;
export const WINDOW_FRAMES = 5;

/**
 * @param {object}  opts
 * @param {object}  opts.vision            createVision(...) result
 * @param {Function} opts.onFrames         called with ([...frames], sighting) once per detection that found the mat
 * @param {Function} [opts.onMat]          called with the mat result of every sampled frame (found or not)
 * @param {number}  [opts.everyNFrames]    sample every Nth camera frame (default 2)
 * @param {number}  [opts.minIntervalMs]   minimum spacing between two detections (default 100 ms => 10 fps)
 * @param {number}  [opts.windowFrames]    size of the rolling window handed to the runtime (default 5)
 * @param {Function} [opts.now]            clock, injectable for tests
 */
export function createVisionPump({
  vision,
  onFrames = () => {},
  onMat = () => {},
  everyNFrames = DETECT_EVERY_N_FRAMES,
  minIntervalMs = MIN_DETECT_INTERVAL_MS,
  windowFrames = WINDOW_FRAMES,
  now = () => Date.now(),
} = {}) {
  if (!vision || typeof vision.frameFromImage !== 'function') {
    throw new Error('createVisionPump needs a vision object (createVision(...))');
  }
  let seen = 0;
  let detected = 0;
  let lastDetectAt = -Infinity;
  let window = [];

  return {
    /**
     * Offer one camera frame. Returns what happened, for the UI badge:
     *   { sampled, detected, matFound, frames, sent }
     * `sent` is the window that was handed to onFrames (null when it was not).
     */
    push(image, timestamp = now()) {
      seen += 1;
      if (everyNFrames > 1 && (seen - 1) % everyNFrames !== 0) {
        return { sampled: false, detected: false, matFound: false, sent: null };
      }
      if (timestamp - lastDetectAt < minIntervalMs) {
        return { sampled: false, detected: false, matFound: false, sent: null };
      }
      lastDetectAt = timestamp;
      detected += 1;

      const sighting = vision.frameFromImage(image);
      const matFound = Boolean(sighting && sighting.mat && sighting.mat.found);
      onMat({ ...(sighting?.mat ?? { found: false }), markers: sighting?.markers ?? [] }, { timestamp, detected });
      if (!matFound) {
        // The mat is out of view: keep the window as it is and send nothing.
        // Clearing it here would let a single bad frame empty the student's board.
        return { sampled: true, detected: true, matFound: false, sent: null };
      }

      window.push(sighting.frame ?? []);
      if (window.length > windowFrames) window = window.slice(-windowFrames);
      const sent = window.slice();
      onFrames(sent, sighting);
      return { sampled: true, detected: true, matFound: true, sent };
    },

    /** Forget what was on the mat (called when a lab starts or stops). */
    reset() {
      window = [];
      lastDetectAt = -Infinity;
    },

    get window() { return window.slice(); },
    get stats() { return { framesSeen: seen, detections: detected }; },
  };
}

/**
 * DOM glue: draw the video into the detection canvas, hand the pixels to the
 * pump, repeat on requestAnimationFrame while running.
 *
 * The video element stays the scene background at full resolution; only the
 * offscreen 640x360 canvas is downscaled for detection.
 */
export function startCameraLoop({
  video,
  canvas,
  vision,
  onFrames,
  onMat,
  onError = () => {},
  everyNFrames = DETECT_EVERY_N_FRAMES,
  minIntervalMs = MIN_DETECT_INTERVAL_MS,
  windowFrames = WINDOW_FRAMES,
  now = () => Date.now(),
} = {}) {
  if (!video || !canvas || !vision) throw new Error('startCameraLoop needs video, canvas and vision');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const pump = createVisionPump({ vision, onFrames, onMat, everyNFrames, minIntervalMs, windowFrames, now });
  let raf = null;
  let running = false;

  function tick() {
    if (!running) return;
    try {
      if (video.readyState >= 2 && video.videoWidth) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        pump.push(ctx.getImageData(0, 0, canvas.width, canvas.height), now());
      }
    } catch (err) {
      onError(err);
    }
    raf = requestAnimationFrame(tick);
  }

  return {
    pump,
    start() {
      if (running) return;
      running = true;
      raf = requestAnimationFrame(tick);
    },
    stop() {
      running = false;
      if (raf !== null) cancelAnimationFrame(raf);
      raf = null;
    },
    get running() { return running; },
  };
}
