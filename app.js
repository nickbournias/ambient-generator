// Ambient Drone Pad
// Canvas = XY instrument
// X → pitch (scale-snapped)
// Y → brightness
// Speed → energy / shimmer
// Pointer Events + Web Audio API

(() => {
  /* =========================
     DOM
  ========================= */
  const canvas = document.getElementById("pad");
  const statusEl = document.getElementById("status");
  const readoutEl = document.getElementById("readout");
  const overlayEl = document.getElementById("overlay");
  const ctx2d = canvas.getContext("2d");

  /* =========================
     Canvas sizing (retina-safe)
  ========================= */
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  /* =========================
     Helpers
  ========================= */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  /* =========================
     Pointer state
  ========================= */
  const pointer = {
    down: false,
    x: 0.5,
    y: 0.5,
    px: 0.5,
    py: 0.5,
    speed: 0,
    active: false
  };

  /* =========================
     Musical mapping
  ========================= */
  // A minor pentatonic (always pleasant)
  const ROOT_MIDI = 45; // A2
  const SCALE = [0, 3, 5, 7, 10];
  const OCTAVES = 3;

  function midiToHz(m) {
    return 440 * Math.pow(2, (m - 69) / 12);
  }

  function xToMidi(nx) {
    const steps = SCALE.length * OCTAVES;
    const i = Math.round(nx * (steps - 1));
    const oct = Math.floor(i / SCALE.length);
    const deg = i % SCALE.length;
    return ROOT_MIDI + oct * 12 + SCALE[deg];
  }

  /* =========================
     Web Audio
  ========================= */
  let audioCtx = null;
  let running = false;

  let master, filter, delay, feedback;
  let osc1, osc2, osc3;
  let g1, g2, g3;
  let lfo, lfoGain;

  function now() {
    return audioCtx.currentTime;
  }

  function startAudio() {
    if (running) return;

    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume?.();

    master = audioCtx.createGain();
    master.gain.value = 0.0001;

    filter = audioCtx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 600;
    filter.Q.value = 0.7;

    delay = audioCtx.createDelay(2);
    delay.delayTime.value = 0.18;

    feedback = audioCtx.createGain();
    feedback.gain.value = 0.35;
    delay.connect(feedback);
    feedback.connect(delay);

    osc1 = audioCtx.createOscillator();
    osc2 = audioCtx.createOscillator();
    osc3 = audioCtx.createOscillator();

    osc1.type = "sine";
    osc2.type = "triangle";
    osc3.type = "sine";

    g1 = audioCtx.createGain();
    g2 = audioCtx.createGain();
    g3 = audioCtx.createGain();
    g1.gain.value = 0;
    g2.gain.value = 0;
    g3.gain.value = 0;

    osc1.detune.value = -4;
    osc2.detune.value = +3;
    osc3.detune.value = +1;

    lfo = audioCtx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.12;

    lfoGain = audioCtx.createGain();
    lfoGain.gain.value = 0;

    lfo.connect(lfoGain);
    lfoGain.connect(osc2.detune);

    osc1.connect(g1);
    osc2.connect(g2);
    osc3.connect(g3);

    g1.connect(filter);
    g2.connect(filter);
    g3.connect(filter);

    filter.connect(master);
    filter.connect(delay);
    delay.connect(master);

    master.connect(audioCtx.destination);

    const t = now();
    osc1.start(t);
    osc2.start(t);
    osc3.start(t);
    lfo.start(t);

    master.gain.setTargetAtTime(0.12, t + 0.02, 0.6);

    running = true;
  }

  function stopAudio() {
    if (!running) return;

    const t = now();
    master.gain.setTargetAtTime(0.0001, t, 0.25);

    const stopAt = t + 0.8;
    osc1.stop(stopAt);
    osc2.stop(stopAt);
    osc3.stop(stopAt);
    lfo.stop(stopAt);

    running = false;
  }

  /* =========================
     Audio update
  ========================= */
  function updateSound() {
    if (!running) return;

    const nx = pointer.x;
    const ny = pointer.y;

    const midi = xToMidi(nx);
    const hz = midiToHz(midi);

    const cutoff = 300 + Math.pow(ny, 1.7) * 3000;
    const energy = clamp(pointer.speed * 1.4, 0, 1);

    const t = now();
    osc1.frequency.setTargetAtTime(hz, t, 0.05);
    osc2.frequency.setTargetAtTime(hz * 1.5, t, 0.05);
    osc3.frequency.setTargetAtTime(hz * 2.0, t, 0.05);

    filter.frequency.setTargetAtTime(cutoff, t, 0.06);
    filter.Q.setTargetAtTime(0.6 + energy * 2.0, t, 0.1);

    delay.delayTime.setTargetAtTime(0.14 + ny * 0.12, t, 0.12);
    feedback.gain.setTargetAtTime(0.25 + ny * 0.2, t, 0.18);

    const level = pointer.down ? (0.12 + ny * 0.15 + energy * 0.15) : 0.02;
    g1.gain.setTargetAtTime(level, t, 0.1);
    g2.gain.setTargetAtTime(level * 0.5, t, 0.12);
    g3.gain.setTargetAtTime(level * 0.18, t, 0.16);

    lfoGain.gain.setTargetAtTime(energy * 6, t, 0.2);

    readoutEl.textContent = `x ${(nx * 100).toFixed(0)}  y ${(ny * 100).toFixed(0)}`;
    statusEl.textContent = pointer.down ? "Playing" : "Move to play";
  }

  /* =========================
     Visuals
  ========================= */
  function draw() {
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    ctx2d.fillStyle = "rgba(8,8,12,0.12)";
    ctx2d.fillRect(0, 0, w, h);

    const x = pointer.x * w;
    const y = pointer.y * h;
    const energy = clamp(pointer.speed * 1.4, 0, 1);

    const hue = 190 + pointer.y * 60;
    const r = 30 + pointer.y * 40 + energy * 50;

    const grad = ctx2d.createRadialGradient(x, y, 0, x, y, r * 3);
    grad.addColorStop(0, `hsla(${hue},60%,70%,${0.25 + energy * 0.3})`);
    grad.addColorStop(0.4, `hsla(${hue + 10},60%,55%,${0.15})`);
    grad.addColorStop(1, "rgba(0,0,0,0)");

    ctx2d.fillStyle = grad;
    ctx2d.beginPath();
    ctx2d.arc(x, y, r * 3, 0, Math.PI * 2);
    ctx2d.fill();

    requestAnimationFrame(draw);
  }
  draw();

  /* =========================
     Pointer handling
  ========================= */
  function updatePointer(e) {
    const rect = canvas.getBoundingClientRect();
    const x = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    const y = clamp((e.clientY - rect.top) / rect.height, 0, 1);

    const dx = x - pointer.px;
    const dy = y - pointer.py;
    const dist = Math.sqrt(dx * dx + dy * dy);

    pointer.speed = lerp(pointer.speed, clamp(dist * 18, 0, 1), 0.18);
    pointer.px = pointer.x;
    pointer.py = pointer.y;
    pointer.x = x;
    pointer.y = y;

    updateSound();
  }

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointer.down = true;
    pointer.active = true;

    startAudio();
    overlayEl.classList.add("hidden");

    updatePointer(e);
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!pointer.active) return;
    updatePointer(e);
  });

  canvas.addEventListener("pointerup", () => {
    pointer.down = false;
    updateSound();
  });

  canvas.addEventListener("pointerleave", () => {
    pointer.down = false;
    updateSound();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopAudio();
  });
})();