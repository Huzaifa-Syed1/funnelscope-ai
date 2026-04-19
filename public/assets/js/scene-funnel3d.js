/**
 * scene-funnel3d.js — Premium 3D Funnel Visualisation
 *
 * Vertical glass pillars, colour-coded by drop severity.
 * Particle flow lines between steps.
 * Hover tooltips with step diagnostics.
 * OrbitControls-style mouse drag + auto-rotation.
 * Labels rendered as floating HTML (crisp at any resolution).
 */
import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

// ── Colour palette ───────────────────────────────────────────────
const COL = {
  healthy:  { hex: '#22c55e', three: 0x22c55e, emissive: 0x16a34a, glow: '#22c55e' },
  warning:  { hex: '#f59e0b', three: 0xf59e0b, emissive: 0xd97706, glow: '#f59e0b' },
  critical: { hex: '#ef4444', three: 0xef4444, emissive: 0xdc2626, glow: '#ef4444' },
  worst:    { hex: '#ff1a1a', three: 0xff2020, emissive: 0xff0000, glow: '#ff3333' }
};

function pickSev(step) {
  if (step.isBiggestDrop)                      return 'worst';
  if ((step.dropPct ?? 0) > 60)                return 'critical';
  if ((step.dropPct ?? 0) > 35)                return 'warning';
  return 'healthy';
}

// ── Main class ───────────────────────────────────────────────────
export class Funnel3D {
  constructor(containerId) {
    this._id        = containerId;
    this._meshes    = [];
    this._labels    = [];
    this._particles = [];
    this._flows     = [];
    this._animId    = null;
    this._hovered   = null;
    this._tooltip   = null;
    this._clock     = new THREE.Clock();
    this._mouse     = new THREE.Vector2(-9999, -9999);
    this._raycaster = new THREE.Raycaster();
    this._destroyed = false;
    // Orbit state
    this._isDragging  = false;
    this._prevMouse   = { x: 0, y: 0 };
    this._theta       = 0.3;       // horizontal angle
    this._phi         = 1.1;       // vertical angle
    this._radius      = 26;
    this._autoRotate  = true;
    this._init();
  }

  _init() {
    const container = document.getElementById(this._id);
    if (!container) return;
    container.innerHTML = '';

    const W = container.clientWidth  || 800;
    const H = container.clientHeight || 500;

    // ── Renderer ──────────────────────────────────────────────
    this._renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.setSize(W, H);
    this._renderer.shadowMap.enabled = true;
    this._renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
    container.appendChild(this._renderer.domElement);

    // ── Scene ─────────────────────────────────────────────────
    this._scene = new THREE.Scene();
    this._scene.fog = new THREE.FogExp2(0x05050f, 0.018);

    // ── Camera ────────────────────────────────────────────────
    this._camera = new THREE.PerspectiveCamera(52, W / H, 0.1, 500);
    this._updateCamera();

    // ── Lights ────────────────────────────────────────────────
    this._scene.add(new THREE.AmbientLight(0x111133, 1.5));
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(10, 20, 10);
    dir.castShadow = true;
    this._scene.add(dir);
    this._keyLight = new THREE.PointLight(0x6c47ff, 3, 60);
    this._keyLight.position.set(-5, 15, 8);
    this._scene.add(this._keyLight);

    // ── Grid floor ────────────────────────────────────────────
    const gridHelper = new THREE.GridHelper(50, 25, 0x6c47ff, 0x1a0a3a);
    gridHelper.position.y = -0.01;
    gridHelper.material.opacity = 0.4;
    gridHelper.material.transparent = true;
    this._scene.add(gridHelper);

    // ── Tooltip DOM ───────────────────────────────────────────
    container.style.position = 'relative';
    this._tooltip = document.createElement('div');
    this._tooltip.className = 'f3d-tooltip';
    this._tooltip.hidden    = true;
    container.appendChild(this._tooltip);

    // ── Label container (HTML overlay) ────────────────────────
    this._labelContainer = document.createElement('div');
    this._labelContainer.className = 'f3d-labels';
    container.appendChild(this._labelContainer);

    this._bindEvents(container);
    this._loop();
  }

  // ── Public: render step data array ──────────────────────────
  render(stepData) {
    this._clearScene();
    if (!stepData?.length) return;

    const N       = stepData.length;
    const maxVal  = Math.max(...stepData.map((s) => s.value), 1);
    const spacing = 7;
    const startX  = -((N - 1) * spacing) / 2;
    const MAX_H   = 12;

    stepData.forEach((step, i) => {
      const sev      = pickSev(step);
      const col      = COL[sev];
      const normH    = Math.max(0.4, (step.value / maxVal) * MAX_H);
      const x        = startX + i * spacing;
      const isWorst  = sev === 'worst';

      // ── Glass pillar ────────────────────────────────────────
      const geo = new THREE.BoxGeometry(3.2, normH, 3.2);
      const mat = new THREE.MeshStandardMaterial({
        color:             col.three,
        emissive:          col.emissive,
        emissiveIntensity: isWorst ? 0.5 : 0.2,
        metalness:         0.2,
        roughness:         0.1,
        transparent:       true,
        opacity:           0.75
      });
      const pillar = new THREE.Mesh(geo, mat);
      pillar.position.set(x, normH / 2, 0);
      pillar.castShadow  = true;
      pillar.receiveShadow = true;
      pillar.userData = { step, sev, mat, baseEmissive: isWorst ? 0.5 : 0.2, isWorst };
      this._scene.add(pillar);
      this._meshes.push(pillar);

      // ── Glass edges (wireframe overlay) ─────────────────────
      const edgeGeo = new THREE.EdgesGeometry(geo);
      const edgeMat = new THREE.LineBasicMaterial({
        color: col.three,
        transparent: true,
        opacity: isWorst ? 0.9 : 0.5
      });
      const edges = new THREE.LineSegments(edgeGeo, edgeMat);
      edges.position.copy(pillar.position);
      this._scene.add(edges);
      this._meshes.push(edges);

      // ── Glow point light for worst step ─────────────────────
      if (isWorst) {
        const glowLight = new THREE.PointLight(0xff2020, 4, 12);
        glowLight.position.set(x, normH + 2, 0);
        glowLight.userData = { isGlow: true, phase: 0 };
        this._scene.add(glowLight);
        this._meshes.push(glowLight);
      }

      // ── Top cap glow plane ───────────────────────────────────
      const capGeo = new THREE.PlaneGeometry(3.4, 3.4);
      const capMat = new THREE.MeshBasicMaterial({
        color: col.three, transparent: true, opacity: 0.3,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending
      });
      const cap = new THREE.Mesh(capGeo, capMat);
      cap.rotation.x = -Math.PI / 2;
      cap.position.set(x, normH + 0.02, 0);
      this._scene.add(cap);
      this._meshes.push(cap);

      // ── HTML label (crisp text overlay) ─────────────────────
      this._addLabel(step, i, x, normH, col, sev);

      // ── Flow particles between pillars ───────────────────────
      if (i > 0) {
        const prevStep = stepData[i - 1];
        const prevX    = startX + (i - 1) * spacing;
        const prevH    = Math.max(0.4, (prevStep.value / maxVal) * MAX_H);
        this._addFlow(prevX, prevH, x, normH, col, step.dropPct ?? 0);
      }
    });

    // Adjust camera distance to fit all pillars
    this._radius = 14 + N * 2.5;
    this._updateCamera();
  }

  // ── HTML labels (always-crisp, no texture aliasing) ─────────
  _addLabel(step, i, x3d, h3d, col, sev) {
    const label = document.createElement('div');
    label.className = `f3d-label f3d-label--${sev}`;
    label.dataset.idx = i;
    label.innerHTML = `
      <span class="f3d-label-name">${this._esc(step.label)}</span>
      <span class="f3d-label-value">${Number(step.value ?? 0).toLocaleString()}</span>
      <span class="f3d-label-conv">${(step.convFromPrev ?? 100).toFixed(1)}%</span>
    `;
    label.dataset.x3d = x3d;
    label.dataset.h3d = h3d + 0.5;
    this._labelContainer.appendChild(label);
    this._labels.push({ elem: label, x3d, y3d: h3d + 1.2, z3d: 0 });
  }

  // ── Flow particle stream between pillars ─────────────────────
  _addFlow(x1, h1, x2, h2, col, dropPct) {
    const count = Math.max(6, Math.round((100 - dropPct) / 8));
    const geo   = new THREE.BufferGeometry();
    const pos   = new Float32Array(count * 3);
    const progresses = new Float32Array(count);

    for (let j = 0; j < count; j++) {
      progresses[j] = Math.random();
      // Positions initialised in loop
      pos[j * 3]     = x1;
      pos[j * 3 + 1] = h1;
      pos[j * 3 + 2] = 0;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

    const mat = new THREE.PointsMaterial({
      color:       col.three,
      size:        0.22,
      transparent: true,
      opacity:     0.85,
      blending:    THREE.AdditiveBlending,
      depthWrite:  false
    });

    const pts = new THREE.Points(geo, mat);
    pts.userData = {
      isFlow: true,
      x1, h1, x2, h2,
      progresses,
      speed: 0.4 + Math.random() * 0.3
    };
    this._scene.add(pts);
    this._flows.push(pts);
    this._meshes.push(pts);
  }

  // ── Update flow particle positions each frame ────────────────
  _animateFlows(dt) {
    this._flows.forEach((pts) => {
      const d   = pts.userData;
      const pos = pts.geometry.attributes.position;
      for (let j = 0; j < d.progresses.length; j++) {
        d.progresses[j] = (d.progresses[j] + dt * d.speed) % 1;
        const t = d.progresses[j];
        // Arc trajectory
        const x = d.x1 + (d.x2 - d.x1) * t;
        const y = d.h1 + (d.h2 - d.h1) * t + Math.sin(t * Math.PI) * 1.5;
        pos.array[j * 3]     = x;
        pos.array[j * 3 + 1] = y;
        pos.array[j * 3 + 2] = (Math.random() - 0.5) * 0.4;
      }
      pos.needsUpdate = true;
    });
  }

  // ── Update HTML labels to follow 3D positions ────────────────
  _updateLabels() {
    if (!this._labelContainer) return;
    const W = this._renderer.domElement.clientWidth;
    const H = this._renderer.domElement.clientHeight;
    const temp = new THREE.Vector3();

    this._labels.forEach(({ elem, x3d, y3d, z3d }) => {
      temp.set(x3d, y3d, z3d);
      temp.project(this._camera);
      const sx = ( temp.x * 0.5 + 0.5) * W;
      const sy = (-temp.y * 0.5 + 0.5) * H;
      elem.style.left      = sx + 'px';
      elem.style.top       = sy + 'px';
      elem.style.transform = 'translate(-50%, -110%)';
      elem.style.display   = temp.z < 1 ? 'flex' : 'none';
    });
  }

  // ── Orbit camera ─────────────────────────────────────────────
  _updateCamera() {
    const x = this._radius * Math.sin(this._phi) * Math.sin(this._theta);
    const y = this._radius * Math.cos(this._phi);
    const z = this._radius * Math.sin(this._phi) * Math.cos(this._theta);
    this._camera.position.set(x, y + 4, z);
    this._camera.lookAt(0, 4, 0);
  }

  // ── Render loop ───────────────────────────────────────────────
  _loop() {
    if (this._destroyed) return;
    this._animId = requestAnimationFrame(() => this._loop());

    const dt = this._clock.getDelta();
    const t  = this._clock.getElapsedTime();

    // Auto-rotation
    if (this._autoRotate && !this._isDragging) {
      this._theta += dt * 0.15;
      this._updateCamera();
    }

    // Key light pulse
    this._keyLight.intensity = 2.5 + Math.sin(t * 1.5) * 0.8;

    // Emissive pulse on worst step + glow lights
    this._meshes.forEach((m) => {
      if (m.userData?.isWorst && m.material) {
        m.material.emissiveIntensity = 0.4 + 0.3 * Math.sin(t * 3);
      }
      if (m.userData?.isGlow) {
        m.intensity = 3 + 2 * Math.sin(t * 3 + m.userData.phase);
      }
    });

    // Flow particles
    this._animateFlows(dt);

    // Raycaster hover
    this._raycaster.setFromCamera(this._mouse, this._camera);
    const hits = this._raycaster.intersectObjects(
      this._meshes.filter((m) => m.userData?.step && m.isMesh)
    );
    const hit = hits[0]?.object ?? null;
    this._onHover(hit);

    // Update label positions
    this._updateLabels();

    this._renderer.render(this._scene, this._camera);
  }

  // ── Hover logic ───────────────────────────────────────────────
  _onHover(hit) {
    if (hit === this._hovered) return;

    if (this._hovered?.userData?.mat) {
      const d = this._hovered.userData;
      d.mat.emissiveIntensity = d.baseEmissive;
      d.mat.opacity           = 0.75;
    }
    this._hovered = hit;
    this._tooltip.hidden = true;

    if (hit?.userData?.step) {
      const d = hit.userData;
      d.mat.emissiveIntensity = Math.min(d.baseEmissive + 0.4, 0.9);
      d.mat.opacity           = 0.95;

      const s = d.step;
      const sevLabels = { healthy: '✅ Good', warning: '⚠️ Warning', critical: '🔴 Critical', worst: '🚨 Biggest Leak' };
      this._tooltip.innerHTML = `
        <div class="tt-title">${this._esc(s.label)}</div>
        <div class="tt-row"><span>Users</span><b>${Number(s.value ?? 0).toLocaleString()}</b></div>
        <div class="tt-row"><span>Drop from prev</span><b class="tt-drop">${(s.dropPct ?? 0).toFixed(1)}%</b></div>
        <div class="tt-row"><span>Conv from top</span><b>${(s.convFromPrev ?? 100).toFixed(1)}%</b></div>
        <div class="tt-status">${sevLabels[d.sev] ?? d.sev}</div>
        ${s.rootCause ? `<div class="tt-cause">${this._esc(s.rootCause)}</div>` : ''}
      `;
      this._tooltip.hidden = false;
    }
  }

  // ── Events ────────────────────────────────────────────────────
  _bindEvents(container) {
    this._onMM = (e) => {
      const rect = container.getBoundingClientRect();
      this._mouse.x    =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
      this._mouse.y    = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
      this._tooltipX   =   e.clientX - rect.left;
      this._tooltipY   =   e.clientY - rect.top;
      if (this._tooltip && !this._tooltip.hidden) {
        this._tooltip.style.left = (this._tooltipX + 14) + 'px';
        this._tooltip.style.top  = (this._tooltipY + 14) + 'px';
      }
      if (this._isDragging) {
        const dx = e.clientX - this._prevMouse.x;
        const dy = e.clientY - this._prevMouse.y;
        this._theta -= dx * 0.008;
        this._phi    = Math.max(0.4, Math.min(1.55, this._phi + dy * 0.006));
        this._updateCamera();
        this._prevMouse = { x: e.clientX, y: e.clientY };
      }
    };
    this._onML  = () => { this._mouse.set(-9999, -9999); this._tooltip.hidden = true; };
    this._onMD  = (e) => { this._isDragging = true; this._autoRotate = false; this._prevMouse = { x: e.clientX, y: e.clientY }; };
    this._onMU  = () => { this._isDragging = false; setTimeout(() => { this._autoRotate = true; }, 2000); };
    this._onRS  = () => {
      const W = container.clientWidth, H = container.clientHeight;
      this._camera.aspect = W / H;
      this._camera.updateProjectionMatrix();
      this._renderer.setSize(W, H);
    };

    container.addEventListener('mousemove',  this._onMM);
    container.addEventListener('mouseleave', this._onML);
    container.addEventListener('mousedown',  this._onMD);
    window.addEventListener('mouseup',       this._onMU);
    window.addEventListener('resize',        this._onRS);
  }

  // ── Cleanup ───────────────────────────────────────────────────
  _clearScene() {
    this._meshes.forEach((m) => {
      this._scene.remove(m);
      m.geometry?.dispose();
      if (Array.isArray(m.material)) m.material.forEach((mt) => mt.dispose());
      else m.material?.dispose();
    });
    this._meshes  = [];
    this._flows   = [];
    this._labels  = [];
    if (this._labelContainer) this._labelContainer.innerHTML = '';
    if (this._tooltip) this._tooltip.hidden = true;
    this._hovered = null;
  }

  destroy() {
    this._destroyed = true;
    cancelAnimationFrame(this._animId);
    const c = document.getElementById(this._id);
    if (c) {
      c.removeEventListener('mousemove',  this._onMM);
      c.removeEventListener('mouseleave', this._onML);
      c.removeEventListener('mousedown',  this._onMD);
    }
    window.removeEventListener('mouseup',  this._onMU);
    window.removeEventListener('resize',   this._onRS);
    this._clearScene();
    this._renderer?.dispose();
  }

  _esc(v) {
    return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
}
