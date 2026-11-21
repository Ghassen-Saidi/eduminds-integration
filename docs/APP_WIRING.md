# Wiring the app

The integration is designed to be dropped into `edu-minds-app` without
touching its gaze/stereo logic.

## 1. Vite proxy

```js
export default defineConfig({
  plugins: [basicSsl()],
  server: {
    host: true,
    proxy: { '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true, rewrite: (p) => p.replace(/^\\/api/, '') } },
  },
});
```

The phone reaches the simulator through the same HTTPS origin as the page.

## 2. Load the shared lab registry

Import `shared/labs.json` and map each app lab id to its simulator scenario.
The database lab id and simulator scenario are separate values.

## 3. Create one runtime per lab

Create the `createSimClient` and `createLabRuntime` instances from
`startSim(lab)`. Pass the existing `logEvent` callback, a UUID generator,
and the scene's `applySimState` renderer.

## 4. Camera callback

```js
export function onCameraFrame(video) {
  detectCtx.drawImage(video, 0, 0, detectCanvas.width, detectCanvas.height);
  const image = detectCtx.getImageData(0, 0, detectCanvas.width, detectCanvas.height);
  const { mat, frame } = vision.frameFromImage(image);
  if (!mat.found) {
    runtime?.place([]); // age old marker sightings out during mat loss
    showMatHint('show the four corner markers');
    return;
  }
  runtime?.place([frame]); // one call per processed frame; runtime owns history
}
```

The rolling history is five frames; a token must be present in at least three.
Do not call `stabilize([frame])` separately in the camera callback. If the mat
is absent, keep calling `place([])` so stale tokens disappear after the
stabilization window.

## 5. Result handling

Feed every simulator result to `runtime.apply(result)`. The runtime emits
throttled `sim_result` diagnostic snapshots and normal non-financial events.
Browser clients do not submit `failure_caused` events: those must come from a
trusted server-side verifier, or the database rejects them by policy.

## 6. Service exposure

The API binds to `127.0.0.1` by default. Keep it local for development. Never
expose the Vite dev server or simulator directly to the public internet. For a
tunnel, place an authenticated access proxy in front of the service and inject
`EDUMINDS_API_TOKEN` from that trusted proxy. Never embed that token in
browser code. Configure `EDUMINDS_ALLOWED_ORIGINS` only when cross-origin
requests are explicitly required.

## 7. Stop the lab

Call `await runtime.end()`, clear the runtime/client references, and close the
existing database session using the app's session lifecycle.
