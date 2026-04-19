/**
 * scene-preloader.js
 * Full-screen 3D preloader — particles, rings, brand reveal.
 * Uses Three.js via import map (bare specifier 'three').
 */
import * as THREE from 'three';

export function createPreloader(onComplete) {
  const overlay = document.createElement('div');
  overlay.id    = 'preloader';
  overlay.innerHTML = `
    <canvas id="preloader-canvas"></canvas>
    <div id="preloader-brand">
      <div id="preloader-logo-ring"></div>
      <div id="preloader-title">FunnelScope</div>
      <div id="preloader-sub">Initialising experience…</div>
      <div id="preloader-bar"><div id="preloader-fill"></div></div>
    </div>
  `;
  document.body.prepend(overlay);

  // ── Renderer ────────────────────────────────────────────────
  const canvas   = document.getElementById('preloader-canvas');
  const W        = window.innerWidth;
  const H        = window.innerHeight;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(W, H);
  renderer.setClearColor(0x05050f, 1);

  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, W / H, 0.1, 1000);
  camera.position.z = 30;

  // ── Particle field ──────────────────────────────────────────
  const PARTICLE_COUNT = 1200;
  const positions      = new Float32Array(PARTICLE_COUNT * 3);
  const colors         = new Float32Array(PARTICLE_COUNT * 3);
  const sizes          = new Float32Array(PARTICLE_COUNT);

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    positions[i * 3]     = (Math.random() - 0.5) * 120;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 120;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 80;
    const t              = Math.random();
    colors[i * 3]        = 0.35 + t * 0.35;
    colors[i * 3 + 1]    = 0.15 + t * 0.20;
    colors[i * 3 + 2]    = 0.85 + t * 0.15;
    sizes[i]             = 0.3 + Math.random() * 1.2;
  }

  const particleGeo = new THREE.BufferGeometry();
  particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  particleGeo.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
  particleGeo.setAttribute('size',     new THREE.BufferAttribute(sizes, 1));

  const particleMat = new THREE.ShaderMaterial({
    uniforms: {
      time:    { value: 0.0 },
      opacity: { value: 1.0 }
    },
    vertexShader: `
      attribute float size;
      attribute vec3  color;
      varying   vec3  vColor;
      varying   float vAlpha;
      uniform   float time;
      void main() {
        vColor = color;
        vec3 pos = position;
        pos.y += sin(time * 0.4 + position.x * 0.1) * 0.8;
        pos.x += cos(time * 0.3 + position.z * 0.08) * 0.5;
        vec4 mv  = modelViewMatrix * vec4(pos, 1.0);
        gl_PointSize = size * (300.0 / -mv.z);
        gl_Position  = projectionMatrix * mv;
        vAlpha = 0.4 + 0.6 * abs(sin(time * 0.5 + position.x));
      }
    `,
    fragmentShader: `
      varying vec3  vColor;
      varying float vAlpha;
      uniform float opacity;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.1, d) * vAlpha * opacity;
        gl_FragColor = vec4(vColor, a);
      }
    `,
    transparent:  true,
    depthWrite:   false,
    vertexColors: true,
    blending:     THREE.AdditiveBlending
  });

  const particles = new THREE.Points(particleGeo, particleMat);
  scene.add(particles);

  // ── Floating rings ──────────────────────────────────────────
  const rings = [];
  for (let i = 0; i < 3; i++) {
    const geo  = new THREE.TorusGeometry(8 + i * 5, 0.08, 8, 80);
    const mat  = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.4, 0.2, 1.0),
      transparent: true,
      opacity: 0.15 - i * 0.03
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = Math.PI / 3 + i * 0.3;
    mesh.rotation.y = i * 0.8;
    scene.add(mesh);
    rings.push(mesh);
  }

  // ── Resize handler ───────────────────────────────────────────
  const onResize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  };
  window.addEventListener('resize', onResize);

  // ── Render loop ──────────────────────────────────────────────
  let animId;
  const clock = new THREE.Clock();

  function animate() {
    animId = requestAnimationFrame(animate);
    const t = clock.getElapsedTime();
    particleMat.uniforms.time.value = t;
    particles.rotation.y = t * 0.04;
    particles.rotation.x = Math.sin(t * 0.02) * 0.1;
    rings.forEach((r, i) => {
      r.rotation.z = t * (0.15 + i * 0.07);
      r.rotation.x = t * (0.08 - i * 0.03);
    });
    renderer.render(scene, camera);
  }
  animate();

  // ── Progress bar ─────────────────────────────────────────────
  const fill = document.getElementById('preloader-fill');
  let prog   = 0;
  const interval = setInterval(() => {
    prog = Math.min(prog + Math.random() * 8, 90);
    if (fill) fill.style.width = prog + '%';
  }, 120);

  // ── Dismiss ──────────────────────────────────────────────────
  function dismiss() {
    clearInterval(interval);
    if (fill) { fill.style.transition = 'width 0.3s'; fill.style.width = '100%'; }

    setTimeout(() => {
      overlay.style.transition = 'opacity 0.7s ease';
      overlay.style.opacity    = '0';
      particleMat.uniforms.opacity.value = 0;

      setTimeout(() => {
        cancelAnimationFrame(animId);
        window.removeEventListener('resize', onResize);
        renderer.dispose();
        particleGeo.dispose();
        particleMat.dispose();
        overlay.remove();
        onComplete?.();
      }, 700);
    }, 300);
  }

  const MIN_DISPLAY_MS = 1800;
  const startedAt      = Date.now();

  return {
    complete() {
      const elapsed = Date.now() - startedAt;
      const delay   = Math.max(0, MIN_DISPLAY_MS - elapsed);
      setTimeout(dismiss, delay);
    }
  };
}
