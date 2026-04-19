/**
 * scene-landing.js
 * Auto-rotating demo funnel for the landing page hero and dashboard welcome state.
 * No user input required — runs continuously until destroy() is called.
 * Uses Three.js via import map (bare specifier 'three').
 */
import * as THREE from 'three';

const DEMO_STEPS = [
  { label: 'Visitors',  value: 12400 },
  { label: 'Sign-ups',  value: 9200  },
  { label: 'Activated', value: 4700  },
  { label: 'Paid',      value: 1490  },
  { label: 'Retained',  value: 680   }
];

const STEP_COLORS = [0x6c47ff, 0x7c5cff, 0xf59e0b, 0xef4444, 0xff2040];

/**
 * Mount the landing scene onto a <canvas id="{canvasId}">.
 * Returns a destroy() function — call it to stop the loop and free resources.
 */
export function mountLandingScene(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return () => {};

  const W = canvas.clientWidth  || canvas.parentElement?.clientWidth  || 600;
  const H = canvas.clientHeight || canvas.parentElement?.clientHeight || 400;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(W, H);

  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 200);
  camera.position.set(0, 3, 22);
  camera.lookAt(0, 0, 0);

  // ── Lights ───────────────────────────────────────────────────
  scene.add(new THREE.AmbientLight(0x111133, 1.5));

  const keyLight = new THREE.PointLight(0x7c5cff, 4, 60);
  keyLight.position.set(0, 10, 10);
  scene.add(keyLight);

  const rimLight = new THREE.PointLight(0xff6b47, 2, 40);
  rimLight.position.set(-10, -5, 5);
  scene.add(rimLight);

  // ── Demo funnel geometry ──────────────────────────────────────
  const maxVal      = DEMO_STEPS[0].value;
  const SEG_H       = 1.8;
  const startY      = (DEMO_STEPS.length * SEG_H) / 2;
  const funnelGroup = new THREE.Group();
  scene.add(funnelGroup);

  DEMO_STEPS.forEach((step, i) => {
    const prevVal = i > 0 ? DEMO_STEPS[i - 1].value : step.value;
    const wTop    = 1.2 + (prevVal     / maxVal) * 5;
    const wBot    = 1.2 + (step.value  / maxVal) * 5;
    const yCtr    = startY - i * SEG_H - SEG_H / 2;

    const geo = new THREE.CylinderGeometry(wBot / 2, wTop / 2, SEG_H, 40);
    const mat = new THREE.MeshStandardMaterial({
      color:              STEP_COLORS[i],
      emissive:           STEP_COLORS[i],
      emissiveIntensity:  0.18,
      metalness:          0.4,
      roughness:          0.4,
      transparent:        true,
      opacity:            0.82
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y  = yCtr;
    mesh.userData    = { mat, baseEmissive: 0.18, phase: i * 0.7 };
    funnelGroup.add(mesh);
  });

  // ── Orbiting particles ────────────────────────────────────────
  const orbitGeo = new THREE.BufferGeometry();
  const ORBIT_N  = 300;
  const oPos     = new Float32Array(ORBIT_N * 3);
  for (let i = 0; i < ORBIT_N; i++) {
    const a         = Math.random() * Math.PI * 2;
    const r         = 6 + Math.random() * 4;
    oPos[i * 3]     = Math.cos(a) * r;
    oPos[i * 3 + 1] = (Math.random() - 0.5) * 12;
    oPos[i * 3 + 2] = Math.sin(a) * r;
  }
  orbitGeo.setAttribute('position', new THREE.BufferAttribute(oPos, 3));
  const orbitMat = new THREE.PointsMaterial({
    color:       0xa78bfa,
    size:        0.15,
    transparent: true,
    opacity:     0.65,
    blending:    THREE.AdditiveBlending,
    depthWrite:  false
  });
  const orbitPts = new THREE.Points(orbitGeo, orbitMat);
  scene.add(orbitPts);

  // ── Resize ───────────────────────────────────────────────────
  const onResize = () => {
    const w = canvas.clientWidth  || canvas.parentElement?.clientWidth  || 600;
    const h = canvas.clientHeight || canvas.parentElement?.clientHeight || 400;
    if (w === 0 || h === 0) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  };
  window.addEventListener('resize', onResize);

  // ── Render loop ───────────────────────────────────────────────
  let animId;
  let destroyed = false;
  const clock   = new THREE.Clock();

  function animate() {
    if (destroyed) return;
    animId = requestAnimationFrame(animate);
    const t = clock.getElapsedTime();

    funnelGroup.rotation.y  = t * 0.35;
    funnelGroup.position.y  = Math.sin(t * 0.5) * 0.3;

    funnelGroup.children.forEach((mesh) => {
      const d = mesh.userData;
      if (d?.mat) {
        d.mat.emissiveIntensity = d.baseEmissive + 0.12 * Math.sin(t * 1.5 + d.phase);
      }
    });

    orbitPts.rotation.y  = -t * 0.2;
    keyLight.intensity   = 3 + Math.sin(t * 0.8);

    renderer.render(scene, camera);
  }
  animate();

  // ── Destroy ───────────────────────────────────────────────────
  return function destroy() {
    destroyed = true;
    cancelAnimationFrame(animId);
    window.removeEventListener('resize', onResize);
    funnelGroup.children.forEach((m) => {
      m.geometry?.dispose();
      m.material?.dispose();
    });
    orbitGeo.dispose();
    orbitMat.dispose();
    renderer.dispose();
  };
}
