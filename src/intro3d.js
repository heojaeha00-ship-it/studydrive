// 소개 화면의 3D 배경 (three.js를 앱에 포함해 외부 CDN 없이 동작)
import { Scene, PerspectiveCamera, WebGLRenderer, AmbientLight, DirectionalLight, PointLight, GridHelper, Group, BufferGeometry, BufferAttribute, PointsMaterial, Points, AdditiveBlending, TorusGeometry, MeshStandardMaterial, Mesh, IcosahedronGeometry, OctahedronGeometry, Color, Clock, CanvasTexture } from 'three';

export function start(el) {
  let renderer;
  try { renderer = new WebGLRenderer({ antialias: true, alpha: true }); } catch { return () => {}; }
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const scene = new Scene();
  const camera = new PerspectiveCamera(60, 1, 0.1, 1000);
  camera.position.z = 30;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  el.appendChild(renderer.domElement);

  scene.add(new AmbientLight(0x404080, 0.7));
  const dl = new DirectionalLight(0xffffff, 1); dl.position.set(5, 10, 7); scene.add(dl);
  const p1 = new PointLight(0x38bdf8, 1.6, 70); p1.position.set(-12, 6, 6); scene.add(p1);
  const p2 = new PointLight(0x818cf8, 1.3, 70); p2.position.set(12, -6, 6); scene.add(p2);

  // 격자 제거

  const group = new Group(); scene.add(group);
  const C = { sky: new Color(0x38bdf8), indigo: new Color(0x818cf8), emerald: new Color(0x34d399), amber: new Color(0xfbbf24), rose: new Color(0xfb7185), cyan: new Color(0x22d3ee), purple: new Color(0xc084fc) };

  const N = 520, pos = new Float32Array(N * 3), col = new Float32Array(N * 3), pick = [C.sky, C.indigo, C.emerald];
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 90; pos[i * 3 + 1] = (Math.random() - 0.5) * 56; pos[i * 3 + 2] = (Math.random() - 0.5) * 40 - 10;
    const c = pick[i % 3]; col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g2 = cv.getContext('2d'), gr = g2.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g2.fillStyle = gr; g2.fillRect(0, 0, 64, 64);
  const pg = new BufferGeometry(); pg.setAttribute('position', new BufferAttribute(pos, 3)); pg.setAttribute('color', new BufferAttribute(col, 3));
  group.add(new Points(pg, new PointsMaterial({ size: 1.05, map: new CanvasTexture(cv), vertexColors: true, transparent: true, opacity: 0.7, blending: AdditiveBlending, depthWrite: false })));

  const ringGeo = new TorusGeometry(7, 0.08, 16, 120);
  const ring = (c) => new Mesh(ringGeo, new MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.35, transparent: true, opacity: 0.75 }));
  const r1 = ring(C.sky), r2 = ring(C.indigo); r2.rotation.x = Math.PI / 2; group.add(r1, r2);
  const core = new Mesh(new IcosahedronGeometry(4, 2), new MeshStandardMaterial({ color: 0x0f172a, emissive: C.sky, emissiveIntensity: 0.12, wireframe: true, transparent: true, opacity: 0.85 }));
  group.add(core);

  const tint = [C.sky, C.emerald, C.amber, C.purple, C.rose, C.cyan], shapes = [];
  tint.forEach((c, i) => {
    const m = new Mesh(new OctahedronGeometry(1.1, 0), new MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.3, transparent: true, opacity: 0.9 }));
    m.userData = { a: (i / tint.length) * Math.PI * 2, r: 12.5, s: 0.5 + (i % 3) * 0.2 };
    shapes.push(m); group.add(m);
  });

  let tx = 0, ty = 0;
  const onMove = (e) => { tx = (e.clientX / innerWidth - 0.5) * 0.5; ty = (e.clientY / innerHeight - 0.5) * 0.3; };
  addEventListener('pointermove', onMove);
  const resize = () => {
    const w = el.clientWidth || innerWidth, h = el.clientHeight || innerHeight;
    renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    group.position.x = w / h > 1.25 ? 9 : 0; group.position.y = w / h > 1.25 ? 1 : 4; group.scale.setScalar(w / h > 1.25 ? 1 : 0.75);
  };
  addEventListener('resize', resize); resize();

  const clock = new Clock(); let raf = 0, stopped = false;
  const frame = () => {
    if (stopped) return;
    raf = requestAnimationFrame(frame);
    if (document.hidden) return;
    const t = clock.getElapsedTime() * (reduce ? 0 : 1);
    core.rotation.x = t * 0.05; core.rotation.y = t * 0.08; r1.rotation.z = t * 0.12; r2.rotation.x = Math.PI / 2 + t * 0.1;
    shapes.forEach((m) => { const u = m.userData, a = u.a + t * u.s * 0.15; m.position.set(Math.cos(a) * u.r, Math.sin(a) * u.r, 0); m.rotation.x = t * 0.4; m.rotation.y = t * 0.6; });
    group.rotation.y += (tx - group.rotation.y) * 0.04; group.rotation.x += (ty - group.rotation.x) * 0.04;
    renderer.render(scene, camera);
  };
  frame();

  return () => {
    stopped = true; cancelAnimationFrame(raf);
    removeEventListener('pointermove', onMove); removeEventListener('resize', resize);
    renderer.dispose(); el.innerHTML = '';
  };
}
