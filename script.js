/* =========================================================
   Volcano Formation Simulator
   --------------------------------------------------------
   A conceptual cross-section simulation showing how a
   volcano grows from mantle melting through repeated
   eruptions and lava layer deposition.

   Architecture:
     - One requestAnimationFrame loop drives everything.
     - The world is laid out in canvas-relative ratios so
       it scales with the canvas size.
     - State is grouped into:
         * geology   (cone, layers, conduit, chamber)
         * magma     (rising blobs)
         * particles (eruption ash + lava bombs)
         * lavaFlows (cooling lava draped on the cone)
         * stage     (which step of the process is active)
   ========================================================= */

(() => {
  "use strict";

  // -------------------- Setup --------------------
  const canvas = document.getElementById("scene");
  const ctx = canvas.getContext("2d");

  // We render at the canvas's native pixel size and let CSS scale it.
  const W = canvas.width;
  const H = canvas.height;

  // UI references
  const playBtn = document.getElementById("playBtn");
  const playLabel = document.getElementById("playLabel");
  const playIcon = document.getElementById("playIcon");
  const resetBtn = document.getElementById("resetBtn");
  const pressureSlider = document.getElementById("pressure");
  const pressureValue = document.getElementById("pressureValue");
  const statusPill = document.getElementById("statusPill");
  const stepsList = document.getElementById("steps");
  const eruptionCountEl = document.getElementById("eruptionCount");
  const layerCountEl = document.getElementById("layerCount");
  const coneHeightEl = document.getElementById("coneHeight");

  // -------------------- World layout --------------------
  // Y-coordinates of geological boundaries.
  // Sky is on top, then crust, then mantle.
  const layout = {
    skyTop: 0,
    surfaceY: H * 0.55,        // ground level (where the volcano sits)
    crustBottom: H * 0.78,     // boundary between crust and mantle
    mantleBottom: H,           // bottom of canvas
    chamberCenterX: W * 0.5,
    chamberCenterY: H * 0.86,  // upper-mantle / lower-crust
    chamberRadiusX: W * 0.18,
    chamberRadiusY: H * 0.07,
    conduitTopY: H * 0.45,     // crater height (above original surface)
    conduitWidth: 26
  };

  // Static stars in the sky for atmosphere (computed once)
  const stars = Array.from({ length: 70 }, () => ({
    x: Math.random() * W,
    y: Math.random() * (layout.surfaceY * 0.85),
    r: Math.random() * 1.4 + 0.2,
    tw: Math.random() * Math.PI * 2 // twinkle phase
  }));

  // -------------------- State --------------------
  /** A rising magma blob inside the conduit/chamber. */
  function makeMagmaBlob() {
    return {
      x: layout.chamberCenterX + (Math.random() - 0.5) * layout.chamberRadiusX * 0.8,
      y: layout.chamberCenterY + (Math.random() - 0.3) * layout.chamberRadiusY * 0.6,
      r: 6 + Math.random() * 5,
      vy: 0,
      // 'forming' = swirling in chamber, 'rising' = traveling up the conduit
      phase: "forming",
      life: 0,
      hue: 18 + Math.random() * 18 // 18-36deg => orange/red
    };
  }

  /** Particle for ash plume and lava bomb arcs. */
  function makeParticle(x, y, kind) {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * (kind === "ash" ? 1.0 : 0.7);
    const speed = kind === "ash"
      ? 3 + Math.random() * 4
      : 5 + Math.random() * 5;
    return {
      x, y,
      vx: Math.cos(angle) * speed + (Math.random() - 0.5) * 1.5,
      vy: Math.sin(angle) * speed,
      life: 0,
      maxLife: kind === "ash" ? 90 + Math.random() * 60 : 60 + Math.random() * 30,
      r: kind === "ash" ? 2 + Math.random() * 3 : 2.5 + Math.random() * 2.5,
      kind
    };
  }

  /** A lava flow rivulet that slides down a side of the cone after an eruption. */
  function makeLavaFlow(side) {
    const dir = side === "L" ? -1 : 1;
    return {
      x: layout.chamberCenterX + dir * 4,
      y: state.cone.peakY + 4,
      dir,
      progress: 0,         // 0..1 along its path
      length: 0.45 + Math.random() * 0.45,
      width: 6 + Math.random() * 4,
      life: 0,
      maxLife: 220,
      points: []           // trail samples for drawing
    };
  }

  const state = {
    running: false,
    pressure: 0.5,          // slider 0..1
    pressureBuild: 0,       // 0..1, fills then triggers eruption
    eruptionFrame: 0,       // ticks remaining of eruption animation
    eruptions: 0,
    stageIndex: 0,          // 0..4 mapped to steps
    time: 0,
    magma: [],
    particles: [],
    lavaFlows: [],
    cone: {
      // Cone is drawn as a stack of "lava layers".
      // Each layer is described by a half-width and a color.
      baseHalfWidth: 110,   // width at the surface
      layers: [],           // {halfWidth, height, color, age}
      peakY: layout.surfaceY // current top of the cone
    },
    spawnCooldown: 0
  };

  const STAGE_TEXT = [
    "Mantle melting produces magma",
    "Magma rises through the crust",
    "Pressure builds in the magma chamber",
    "Eruption adds lava layers",
    "Repeated eruptions build the volcano cone"
  ];

  // -------------------- Helpers --------------------
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /** Returns the current cone half-width at a given y. */
  function coneHalfWidthAt(y) {
    // Linear taper from base half-width at surfaceY to 0 at peakY.
    const { baseHalfWidth, peakY } = state.cone;
    const total = layout.surfaceY - peakY;
    if (total <= 0) return baseHalfWidth * 0.1;
    const t = clamp((layout.surfaceY - y) / total, 0, 1);
    // Slight curve so the cone feels stratovolcano-shaped.
    return baseHalfWidth * Math.pow(1 - t, 0.85);
  }

  function setStage(idx) {
    if (state.stageIndex === idx) return;
    state.stageIndex = idx;
    statusPill.textContent = STAGE_TEXT[idx];
    [...stepsList.children].forEach((li, i) => {
      li.classList.toggle("active", i === idx);
    });
  }

  // -------------------- Cone / eruption logic --------------------
  function addLavaLayer() {
    // Each eruption adds a new thin layer that grows the cone vertically.
    // Color cycles through warm tones to look stratified.
    const palette = [
      "#7a2e22", "#5e2418", "#8a3a25", "#6d2a1d",
      "#a04a2e", "#4d1c12", "#7a3424"
    ];
    const color = palette[state.cone.layers.length % palette.length];
    const height = 4 + Math.random() * 2.4;

    // New layer is slightly narrower than the current top of the cone.
    const prevTopHalf = state.cone.layers.length > 0
      ? state.cone.layers[state.cone.layers.length - 1].halfWidth
      : state.cone.baseHalfWidth;
    const halfWidth = Math.max(7, prevTopHalf - (1.5 + Math.random() * 2.5));

    state.cone.layers.push({
      halfWidth,
      height,
      color,
      age: 0
    });
    state.cone.peakY -= height;

    // Push the conduit's top up so the crater follows the cone peak.
    layout.conduitTopY = state.cone.peakY + 6;

    // Slight base widening too — repeated flows broaden the volcano.
    state.cone.baseHalfWidth += 0.6;
  }

  function triggerEruption() {
    state.eruptions++;
    state.eruptionFrame = 70; // duration of plume burst
    eruptionCountEl.textContent = state.eruptions;

    // Burst of ash + lava bomb particles from the crater.
    const cx = layout.chamberCenterX;
    const cy = state.cone.peakY + 2;
    const bombCount = 18 + Math.floor(state.pressure * 18);
    const ashCount  = 30 + Math.floor(state.pressure * 35);
    for (let i = 0; i < bombCount; i++) state.particles.push(makeParticle(cx, cy, "bomb"));
    for (let i = 0; i < ashCount;  i++) state.particles.push(makeParticle(cx, cy, "ash"));

    // Two lava flows on each side.
    state.lavaFlows.push(makeLavaFlow("L"));
    state.lavaFlows.push(makeLavaFlow("R"));

    // Each eruption deposits a new lava layer.
    addLavaLayer();
    layerCountEl.textContent = state.cone.layers.length;
    coneHeightEl.textContent =
      Math.round((layout.surfaceY - state.cone.peakY) * 1.5) + " m";

    setStage(3);
    // After a moment, reflect that repeated eruptions are building the cone.
    setTimeout(() => {
      if (state.eruptions >= 2) setStage(4);
    }, 900);
  }

  // -------------------- Update --------------------
  function update(dt) {
    state.time += dt;
    const p = state.pressure; // 0..1

    // Build pressure proportional to slider value.
    state.pressureBuild += dt * (0.06 + p * 0.18);

    // Spawn new magma blobs in the chamber periodically.
    state.spawnCooldown -= dt;
    if (state.spawnCooldown <= 0 && state.magma.length < 16) {
      state.magma.push(makeMagmaBlob());
      state.spawnCooldown = 0.35 + (1 - p) * 0.6;
    }

    // Determine current stage (purely visual — eruption overrides).
    if (state.eruptionFrame > 0) {
      // Eruption stage handled in triggerEruption.
    } else if (state.pressureBuild > 0.65) {
      setStage(2);
    } else if (state.magma.some(b => b.phase === "rising")) {
      setStage(1);
    } else {
      setStage(state.eruptions >= 2 ? 4 : 0);
    }

    // Trigger eruption when pressure is full and at least one rising blob
    // has reached near the crater (or just based on pressure if blobs lag).
    if (state.pressureBuild >= 1) {
      triggerEruption();
      state.pressureBuild = 0;
    }

    // Update magma blobs.
    for (let i = state.magma.length - 1; i >= 0; i--) {
      const b = state.magma[i];
      b.life += dt;

      if (b.phase === "forming") {
        // Swirl gently in the chamber; drift toward the conduit center as
        // pressure rises.
        const dx = layout.chamberCenterX - b.x;
        const dy = (layout.chamberCenterY - layout.chamberRadiusY * 0.4) - b.y;
        const swirl = Math.sin(b.life * 1.7 + i) * 0.4;
        b.x += (dx * 0.01 + swirl) * (0.4 + p);
        b.y += dy * 0.01 * (0.4 + p);

        // Promote to "rising" when pressure builds enough or by chance with
        // higher slider values.
        if (state.pressureBuild > 0.45 && Math.random() < 0.012 + p * 0.04) {
          b.phase = "rising";
          b.x = layout.chamberCenterX + (Math.random() - 0.5) * 4;
          b.vy = -(0.6 + p * 1.4);
        }
      } else if (b.phase === "rising") {
        b.vy -= 0.015 * (0.4 + p); // accelerate upward (buoyancy)
        b.y  += b.vy;
        // Tiny lateral wobble so the conduit looks alive.
        b.x += Math.sin(b.life * 6 + i) * 0.4;

        // If it reaches the crater, it contributes to an eruption and is
        // recycled.
        if (b.y < layout.conduitTopY + 4) {
          state.particles.push(makeParticle(b.x, b.y, "bomb"));
          state.magma.splice(i, 1);
          continue;
        }
      }
    }

    // Update particles.
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const pt = state.particles[i];
      pt.life += dt * 60; // life counted in frames
      pt.x += pt.vx;
      pt.y += pt.vy;
      pt.vy += pt.kind === "ash" ? 0.04 : 0.18; // gravity
      pt.vx *= pt.kind === "ash" ? 0.995 : 0.992;

      // Remove when expired or below ground.
      if (pt.life > pt.maxLife || pt.y > layout.surfaceY + 60) {
        state.particles.splice(i, 1);
      }
    }

    // Update lava flows (drape down the cone surface).
    for (let i = state.lavaFlows.length - 1; i >= 0; i--) {
      const f = state.lavaFlows[i];
      f.life += 1;
      f.progress = Math.min(1, f.progress + 0.012 * (0.7 + p));

      // Walk down the cone: starting at peak, sliding outward and downward.
      const t = f.progress;
      const startY = state.cone.peakY;
      const endY   = layout.surfaceY;
      const y = lerp(startY, endY, t);
      const halfW = coneHalfWidthAt(y);
      // Place the flow on the actual cone surface for its side.
      f.x = layout.chamberCenterX + f.dir * halfW * Math.min(1, t * 1.2);
      f.y = y;

      f.points.push({ x: f.x, y: f.y, age: 0 });
      if (f.points.length > 60) f.points.shift();

      for (const pp of f.points) pp.age++;

      if (f.progress >= 1 && f.life > f.maxLife) {
        state.lavaFlows.splice(i, 1);
      }
    }

    // Age existing layers (so freshly added ones glow then cool).
    for (const layer of state.cone.layers) layer.age += dt;

    if (state.eruptionFrame > 0) state.eruptionFrame--;
  }

  // -------------------- Drawing --------------------
  function drawSky() {
    const sky = ctx.createLinearGradient(0, 0, 0, layout.surfaceY);
    sky.addColorStop(0, "#06081a");
    sky.addColorStop(0.5, "#0c1230");
    sky.addColorStop(1, "#1a1733");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, layout.surfaceY);

    // Stars
    for (const s of stars) {
      const a = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(state.time * 1.6 + s.tw));
      ctx.fillStyle = `rgba(255,255,255,${a.toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Soft horizon glow above the volcano (eruption flush)
    const glow = ctx.createRadialGradient(
      layout.chamberCenterX, layout.surfaceY,
      40,
      layout.chamberCenterX, layout.surfaceY,
      W * 0.45
    );
    const intensity = state.eruptionFrame > 0 ? 0.25 : 0.08;
    glow.addColorStop(0, `rgba(255, 130, 70, ${intensity})`);
    glow.addColorStop(1, "rgba(255, 130, 70, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, layout.surfaceY);
  }

  function drawCrust() {
    const g = ctx.createLinearGradient(0, layout.surfaceY, 0, layout.crustBottom);
    g.addColorStop(0, "#5a4334");
    g.addColorStop(0.5, "#48342a");
    g.addColorStop(1, "#2f2118");
    ctx.fillStyle = g;
    ctx.fillRect(0, layout.surfaceY, W, layout.crustBottom - layout.surfaceY);

    // Subtle horizontal sediment lines.
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1;
    for (let y = layout.surfaceY + 14; y < layout.crustBottom; y += 18) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y + Math.sin(y * 0.13) * 4);
      ctx.stroke();
    }
  }

  function drawMantle() {
    const g = ctx.createLinearGradient(0, layout.crustBottom, 0, layout.mantleBottom);
    g.addColorStop(0, "#6e1f15");
    g.addColorStop(0.5, "#a5301e");
    g.addColorStop(1, "#c25237");
    ctx.fillStyle = g;
    ctx.fillRect(0, layout.crustBottom, W, layout.mantleBottom - layout.crustBottom);

    // Heat shimmer streaks (mantle convection feel).
    for (let i = 0; i < 6; i++) {
      const cx = (i + 0.5) * (W / 6) + Math.sin(state.time * 0.6 + i) * 30;
      const cy = layout.crustBottom + 30 + Math.sin(state.time * 0.4 + i) * 20;
      const rg = ctx.createRadialGradient(cx, cy, 5, cx, cy, 90);
      rg.addColorStop(0, "rgba(255, 180, 90, 0.22)");
      rg.addColorStop(1, "rgba(255, 180, 90, 0)");
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(cx, cy, 90, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawChamber() {
    const { chamberCenterX: cx, chamberCenterY: cy,
            chamberRadiusX: rx, chamberRadiusY: ry } = layout;

    // Outer glow
    const glow = ctx.createRadialGradient(cx, cy, 4, cx, cy, rx * 1.3);
    glow.addColorStop(0, "rgba(255,160,80,0.55)");
    glow.addColorStop(1, "rgba(255,160,80,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * 1.3, ry * 1.6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body
    const grad = ctx.createRadialGradient(cx, cy - ry * 0.4, ry * 0.3, cx, cy, rx);
    grad.addColorStop(0, "#fff0a8");
    grad.addColorStop(0.35, "#ffb14b");
    grad.addColorStop(0.7, "#ff5a2b");
    grad.addColorStop(1, "#7a1505");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();

    // Pressure pulse (subtle ripple based on pressureBuild).
    const pulse = state.pressureBuild;
    ctx.strokeStyle = `rgba(255,220,160,${0.35 + pulse * 0.4})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * (0.92 + pulse * 0.06),
                       ry * (0.92 + pulse * 0.06), 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawConduit() {
    const cx = layout.chamberCenterX;
    const top = layout.conduitTopY;
    const bottom = layout.chamberCenterY - layout.chamberRadiusY * 0.4;
    const w = layout.conduitWidth;

    // Outer rocky wall
    ctx.fillStyle = "#1d130d";
    ctx.beginPath();
    ctx.moveTo(cx - w / 2 - 2, bottom);
    ctx.lineTo(cx + w / 2 + 2, bottom);
    ctx.lineTo(cx + w / 2 + 2, top);
    ctx.lineTo(cx - w / 2 - 2, top);
    ctx.closePath();
    ctx.fill();

    // Inner glowing magma column
    const grad = ctx.createLinearGradient(0, top, 0, bottom);
    grad.addColorStop(0, "#ffd166");
    grad.addColorStop(0.4, "#ff7a3d");
    grad.addColorStop(1, "#a0260f");
    ctx.fillStyle = grad;
    ctx.fillRect(cx - w / 2, top, w, bottom - top);

    // Soft glow on either side of the conduit.
    const glow = ctx.createLinearGradient(cx - w * 1.5, 0, cx + w * 1.5, 0);
    glow.addColorStop(0, "rgba(255,120,60,0)");
    glow.addColorStop(0.5, "rgba(255,160,90,0.22)");
    glow.addColorStop(1, "rgba(255,120,60,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(cx - w * 1.5, top, w * 3, bottom - top);
  }

  function drawCone() {
    const cx = layout.chamberCenterX;
    const surfaceY = layout.surfaceY;

    // Original ground line behind the cone (so it sits cleanly).
    // The cone is drawn from the bottom layer up.
    let y = surfaceY;
    let prevHalf = state.cone.baseHalfWidth;

    // Base shadow under the cone.
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(cx, surfaceY + 4, prevHalf + 14, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    for (let i = 0; i < state.cone.layers.length; i++) {
      const layer = state.cone.layers[i];
      const newHalf = layer.halfWidth;
      const newY = y - layer.height;

      // Trapezoid for this layer.
      ctx.beginPath();
      ctx.moveTo(cx - prevHalf, y);
      ctx.lineTo(cx + prevHalf, y);
      ctx.lineTo(cx + newHalf,  newY);
      ctx.lineTo(cx - newHalf,  newY);
      ctx.closePath();

      // Fresh layers glow warm; older layers fade to dark stone.
      const freshness = Math.max(0, 1 - layer.age / 4); // 0..1
      const baseColor = layer.color;
      ctx.fillStyle = baseColor;
      ctx.fill();

      if (freshness > 0) {
        ctx.fillStyle = `rgba(255, 140, 60, ${0.45 * freshness})`;
        ctx.fill();
      }

      // Thin highlight along the upper edge (lava crust line).
      ctx.strokeStyle = `rgba(255, 200, 120, ${0.18 + 0.5 * freshness})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(cx - newHalf, newY);
      ctx.lineTo(cx + newHalf, newY);
      ctx.stroke();

      y = newY;
      prevHalf = newHalf;
    }

    // Crater rim — only meaningful once a cone has actually formed.
    if (state.cone.layers.length > 0) {
      const peakY = state.cone.peakY;
      const craterHalf = Math.max(8, coneHalfWidthAt(peakY) + 2);
      ctx.fillStyle = "#1c0e07";
      ctx.beginPath();
      ctx.ellipse(cx, peakY, craterHalf, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      const crGlow = ctx.createRadialGradient(cx, peakY, 1, cx, peakY, craterHalf);
      crGlow.addColorStop(0, "rgba(255,200,90,0.9)");
      crGlow.addColorStop(1, "rgba(255,90,30,0)");
      ctx.fillStyle = crGlow;
      ctx.beginPath();
      ctx.ellipse(cx, peakY, craterHalf - 1, 4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawMagmaBlobs() {
    for (const b of state.magma) {
      const grad = ctx.createRadialGradient(b.x, b.y, 1, b.x, b.y, b.r * 1.6);
      grad.addColorStop(0, "#fff2b0");
      grad.addColorStop(0.4, `hsl(${b.hue + 10}, 95%, 60%)`);
      grad.addColorStop(1, `hsla(${b.hue}, 95%, 35%, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 1.6, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = `hsl(${b.hue + 12}, 95%, 65%)`;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawLavaFlows() {
    for (const f of state.lavaFlows) {
      // Draw the trail as a soft polyline that fades with age.
      for (let i = 0; i < f.points.length; i++) {
        const pt = f.points[i];
        const a = clamp(1 - pt.age / 180, 0, 1);
        const heat = clamp(1 - pt.age / 80, 0, 1);
        const color = heat > 0.3
          ? `rgba(255, ${Math.round(120 + heat * 100)}, 60, ${a})`
          : `rgba(120, 50, 30, ${a})`;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, f.width * (0.6 + heat * 0.4), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawParticles() {
    for (const p of state.particles) {
      const t = p.life / p.maxLife;
      if (p.kind === "ash") {
        const a = (1 - t) * 0.6;
        ctx.fillStyle = `rgba(120, 120, 140, ${a})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (1 + t * 1.6), 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Lava bomb: bright, leaves a faint trail.
        ctx.fillStyle = `rgba(255, ${180 - t * 100}, ${60 - t * 40}, ${1 - t})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // -------------------- Labels --------------------
  // A small leader-line + pill label drawn over the scene.
  function drawLabel(text, x, y, anchorX, anchorY, side = "right") {
    ctx.save();
    ctx.font = "600 12.5px Inter, system-ui, sans-serif";
    const padX = 8, padY = 5;
    const metrics = ctx.measureText(text);
    const w = metrics.width + padX * 2;
    const h = 22;

    // Pill background
    const bx = side === "right" ? x : x - w;
    const by = y - h / 2;
    ctx.fillStyle = "rgba(10, 12, 22, 0.78)";
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1;
    roundRect(ctx, bx, by, w, h, 11);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#ecf0ff";
    ctx.textBaseline = "middle";
    ctx.fillText(text, bx + padX, y + 0.5);

    // Leader line
    ctx.strokeStyle = "rgba(255, 210, 150, 0.7)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    const startX = side === "right" ? bx : bx + w;
    ctx.moveTo(startX, y);
    ctx.lineTo(anchorX, anchorY);
    ctx.stroke();

    // Anchor dot
    ctx.fillStyle = "#ffd166";
    ctx.beginPath();
    ctx.arc(anchorX, anchorY, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y,     x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x,     y + h, r);
    ctx.arcTo(x,     y + h, x,     y,     r);
    ctx.arcTo(x,     y,     x + w, y,     r);
    ctx.closePath();
  }

  function drawLabels() {
    const cx = layout.chamberCenterX;

    // Mantle melting (lower-left, points into mantle).
    // Use "left" alignment so the pill sits to the left of x and the
    // leader line starts at the pill's right edge, heading outward.
    drawLabel("Mantle melting",
      W * 0.17, layout.crustBottom + (layout.mantleBottom - layout.crustBottom) * 0.55,
      W * 0.24, layout.crustBottom + (layout.mantleBottom - layout.crustBottom) * 0.55,
      "left");

    // Magma chamber (right of chamber)
    drawLabel("Magma chamber",
      W * 0.74, layout.chamberCenterY,
      cx + layout.chamberRadiusX * 0.6, layout.chamberCenterY,
      "right");

    // Crust (upper-left, points into crust)
    drawLabel("Crust",
      W * 0.12, layout.surfaceY + (layout.crustBottom - layout.surfaceY) * 0.4,
      W * 0.22, layout.surfaceY + (layout.crustBottom - layout.surfaceY) * 0.4,
      "left");

    // Magma conduit (left of conduit)
    drawLabel("Magma conduit",
      W * 0.20, (layout.conduitTopY + layout.chamberCenterY) / 2 + 20,
      cx - layout.conduitWidth, (layout.conduitTopY + layout.chamberCenterY) / 2 + 20,
      "left");

    // Volcano cone (right of cone)
    drawLabel("Volcano cone",
      W * 0.74, layout.surfaceY - 30,
      cx + state.cone.baseHalfWidth * 0.65, layout.surfaceY - 14,
      "right");

    // Lava layers (left of cone, points into a mid layer)
    if (state.cone.layers.length > 0) {
      const midLayerY = (layout.surfaceY + state.cone.peakY) / 2;
      drawLabel("Lava layers",
        W * 0.20, midLayerY,
        cx - coneHalfWidthAt(midLayerY) * 0.6, midLayerY,
        "left");
    }

    // Eruption (above the crater, only when erupting)
    if (state.eruptionFrame > 0) {
      drawLabel("Eruption!",
        cx + 80, state.cone.peakY - 90,
        cx, state.cone.peakY - 30,
        "right");
    }
  }

  // -------------------- Main render --------------------
  function render() {
    ctx.clearRect(0, 0, W, H);
    drawSky();
    drawCrust();
    drawMantle();
    drawChamber();
    drawConduit();
    drawMagmaBlobs();
    drawCone();
    drawLavaFlows();
    drawParticles();
    drawLabels();
  }

  // -------------------- Loop --------------------
  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    if (state.running) update(dt);
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // -------------------- UI wiring --------------------
  function setRunning(r) {
    state.running = r;
    playLabel.textContent = r ? "Pause" : "Start";
    playIcon.textContent = r ? "❚❚" : "▶";
    playBtn.classList.toggle("btn-primary", true);
  }

  playBtn.addEventListener("click", () => setRunning(!state.running));

  resetBtn.addEventListener("click", () => {
    state.magma.length = 0;
    state.particles.length = 0;
    state.lavaFlows.length = 0;
    state.cone.layers.length = 0;
    state.cone.baseHalfWidth = 110;
    state.cone.peakY = layout.surfaceY;
    layout.conduitTopY = layout.surfaceY;
    state.pressureBuild = 0;
    state.eruptionFrame = 0;
    state.eruptions = 0;
    state.time = 0;
    eruptionCountEl.textContent = "0";
    layerCountEl.textContent = "0";
    coneHeightEl.textContent = "0 m";
    setStage(0);
    seedStarterCone();
  });

  pressureSlider.addEventListener("input", (e) => {
    const v = +e.target.value;
    state.pressure = v / 100;
    pressureValue.textContent = v + "%";
  });

  // Pre-populate a small starter cone so the volcano + crater are visible
  // from the moment the page loads. Subsequent eruptions still grow it.
  function seedStarterCone() {
    const palette = ["#3a2017", "#4a2820", "#5e2418", "#6d2a1d"];
    let halfWidth = state.cone.baseHalfWidth;
    for (let i = 0; i < 4; i++) {
      const height = 7 + Math.random() * 2;
      halfWidth -= 12 + Math.random() * 4;
      state.cone.layers.push({
        halfWidth,
        height,
        color: palette[i % palette.length],
        age: 999 // already cool
      });
      state.cone.peakY -= height;
    }
    layout.conduitTopY = state.cone.peakY + 6;
    layerCountEl.textContent = state.cone.layers.length;
    coneHeightEl.textContent =
      Math.round((layout.surfaceY - state.cone.peakY) * 1.5) + " m";
  }

  // Initial UI sync.
  setStage(0);
  state.pressure = +pressureSlider.value / 100;
  pressureValue.textContent = pressureSlider.value + "%";
  seedStarterCone();
})();
