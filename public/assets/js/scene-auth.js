/**
 * scene-auth.js
 * 3D animated background for the login/register page.
 * Floating metallic cubes + neon grid + particle ring + mouse parallax.
 * Uses Three.js via import map (bare specifier 'three').
 */
import * as THREE from 'three';

export function mountAuthScene(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return () => {};

  const W = canvas.clientWidth  || window.innerWidth;
  const H = canvas.clientHeight || window.innerHeight;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(W, H);

  const scene = new THREE.Scene();
  scene.fog   = new THREE.FogExp2(0x05050f, 0.025);

  const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 200);
  camera.position.set(0, 8, 28);
  camera.lookAt(0, 0, 0);

  // ── Grid floor ───────────────────────────────────────────────
  const grid = new THREE.GridHelper(60, 30, 0x6c47ff, 0x1a0a3a);
  grid.position.y = -6;
  scene.add(grid);

  // ── Floating cubes ───────────────────────────────────────────
  const cubes      = [];
  const baseColor  = new THREE.Color(0x6c47ff);
  const emissiveC  = new THREE.Color(0x3a1aaa);

  for (let i = 0; i < 28; i++) {
    const s   = 0.2 + Math.random() * 0.8;
    const geo = new THREE.BoxGeometry(s, s, s);
    const mat = new THREE.MeshStandardMaterial({
      color:       baseColor,
      emissive:    emissiveC,
      metalness:   0.9,
      roughness:   0.1,
      transparent: true,
      opacity:     0.7
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(
      (Math.random() - 0.5) * 40,
      (Math.random() - 0.5) * 20,
      (Math.random() - 0.5) * 20
    );
    mesh.userData = {
      speed: 0.4 + Math.random() * 0.8,
      amp:   1   + Math.random() * 3,
      phase: Math.random() * Math.PI * 2,
      rotX:  (Math.random() - 0.5) * 0.02,
      rotY:  (Math.random() - 0.5) * 0.02
    };
    scene.add(mesh);
    cubes.push(mesh);
  }

  // ── Particle ring ────────────────────────────────────────────
  const ringGeo = new THREE.BufferGeometry();
  const COUNT   = 600;
  const rPos    = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i++) {
    const angle    = (i / COUNT) * Math.PI * 2;
    const r        = 14 + Math.random() * 4;
    rPos[i * 3]     = Math.cos(angle) * r;
    rPos[i * 3 + 1] = (Math.random() - 0.5) * 6;
    rPos[i * 3 + 2] = Math.sin(angle) * r;
  }
  ringGeo.setAttribute('position', new THREE.BufferAttribute(rPos, 3));
  const ringMat = new THREE.PointsMaterial({
    color: 0xa78bfa, size: 0.12,
    transparent: true, opacity: 0.7,
    blending: THREE.AdditiveBlending, depthWrite: false
  });
  scene.add(new THREE.Points(ringGeo, ringMat));

  // ── Lights ───────────────────────────────────────────────────
  scene.add(new THREE.AmbientLight(0x0d0d2b, 2));
  const pLight  = new THREE.PointLight(0x6c47ff, 3, 50);
  pLight.position.set(0, 10, 0);
  scene.add(pLight);
  const pLight2 = new THREE.PointLight(0xff6b47, 1.5, 30);
  pLight2.position.set(-15, -5, 5);
  scene.add(pLight2);

  // ── Mouse parallax ───────────────────────────────────────────
  let mx = 0, my = 0;
  const onMouseMove = (e) => {
    mx = (e.clientX / window.innerWidth  - 0.5) * 2;
    my = (e.clientY / window.innerHeight - 0.5) * 2;
  };
  window.addEventListener('mousemove', onMouseMove);

  // ── Resize ───────────────────────────────────────────────────
  const onResize = () => {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  };
  window.addEventListener('resize', onResize);

  // ── Render loop ───────────────────────────────────────────────
  let animId;
  const clock = new THREE.Clock();

  function animate() {
    animId = requestAnimationFrame(animate);
    const t = clock.getElapsedTime();

    cubes.forEach((c) => {
      const d = c.userData;
      c.position.y += Math.sin(t * d.speed + d.phase) * 0.005 * d.amp;
      c.rotation.x  += d.rotX;
      c.rotation.y  += d.rotY;
    });

    camera.position.x += (mx * 3 - camera.position.x) * 0.03;
    camera.position.y += (-my * 2 + 8 - camera.position.y) * 0.03;
    camera.lookAt(0, 0, 0);

    pLight.position.x = Math.sin(t * 0.5) * 10;
    pLight.position.z = Math.cos(t * 0.4) * 10;

    renderer.render(scene, camera);
  }
  animate();

  // ── Cleanup function ─────────────────────────────────────────
  return function destroy() {
    cancelAnimationFrame(animId);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('resize', onResize);
    renderer.dispose();
    ringGeo.dispose();
    ringMat.dispose();
  };
}
