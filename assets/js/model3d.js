/*
 * 参数化 3D 车间模型 (Three.js r128)
 * 依据设计参数生成：养殖池阵列 + 生物滤池组 + 设备/泵房 + 管路 + 水体
 * 支持暗/亮主题与轨道控制、自动旋转。
 */
window.RAS = window.RAS || {};

RAS.model3d = (function () {
  let scene, camera, renderer, controls, container, rafId;
  let root = null;
  let autoRotate = true;

  const THEMES = {
    light: { bg: 0xeef2f7, floor: 0xd7e0ea, tank: 0xb9c4d0, water: 0x2f80ed, bio: 0x7fb069, eq: 0x9aa7b4, pipe: 0x5b6b7b },
    dark:  { bg: 0x0b1220, floor: 0x121b2b, tank: 0x223047, water: 0x1e88e5, bio: 0x4caf50, eq: 0x2a3a4f, pipe: 0x3a4a5e },
  };

  function init(el) {
    container = el;
    const w = el.clientWidth || 800;
    const h = el.clientHeight || 500;

    scene = new THREE.Scene();
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    el.appendChild(renderer.domElement);

    camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 2000);
    camera.position.set(60, 55, 60);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2.05;
    controls.minDistance = 20;
    controls.maxDistance = 220;

    // 灯光
    const amb = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(amb);
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(40, 80, 30);
    scene.add(dir);
    const dir2 = new THREE.DirectionalLight(0x88aaff, 0.3);
    dir2.position.set(-30, 40, -40);
    scene.add(dir2);

    window.addEventListener("resize", onResize);
    animate();
  }

  function onResize() {
    if (!container || !renderer) return;
    const w = container.clientWidth, h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }

  function clear() {
    if (root) {
      scene.remove(root);
      root.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
          else o.material.dispose();
        }
      });
      root = null;
    }
  }

  function build(design, themeName) {
    if (!scene) return;
    clear();
    const T = THEMES[themeName] || THEMES.dark;
    scene.background = new THREE.Color(T.bg);

    root = new THREE.Group();

    const D = design.culture.tankD;
    const H = design.culture.tankH;
    const cols = design.culture.cols;
    const rows = design.culture.rows;
    const gap = D * 1.6;

    const totalW = cols * gap;
    const totalL = rows * gap;

    // —— 地面 ——
    const floorGeo = new THREE.PlaneGeometry(totalW + 40, totalL + 50);
    const floorMat = new THREE.MeshStandardMaterial({ color: T.floor, roughness: 0.95 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, 0);
    root.add(floor);

    const grid = new THREE.GridHelper(Math.max(totalW, totalL) + 40, Math.round((Math.max(totalW, totalL) + 40) / 5), 0x000000, 0x000000);
    grid.material.opacity = 0.08;
    grid.material.transparent = true;
    grid.position.y = 0.02;
    root.add(grid);

    // —— 养殖池阵列 ——
    const tankMat = new THREE.MeshStandardMaterial({ color: T.tank, metalness: 0.5, roughness: 0.4, side: THREE.DoubleSide });
    const waterMat = new THREE.MeshStandardMaterial({ color: T.water, transparent: true, opacity: 0.7, roughness: 0.2, metalness: 0.1 });
    const r = D / 2;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const x = -totalW / 2 + gap / 2 + i * gap;
        const z = -totalL / 2 + gap / 2 + j * gap;
        // 池壁（开口圆柱）
        const wall = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.96, H, 32, 1, true), tankMat);
        wall.position.set(x, H / 2, z);
        root.add(wall);
        // 池底
        const bottom = new THREE.Mesh(new THREE.CircleGeometry(r * 0.96, 32), tankMat);
        bottom.rotation.x = -Math.PI / 2;
        bottom.position.set(x, 0.05, z);
        root.add(bottom);
        // 水体
        const water = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.94, r * 0.92, H * 0.82, 32), waterMat);
        water.position.set(x, H * 0.41 + 0.1, z);
        root.add(water);
      }
    }

    // —— 生物滤池组（后方）——
    const bioMat = new THREE.MeshStandardMaterial({ color: T.bio, roughness: 0.6, metalness: 0.2 });
    const bioZ = totalL / 2 + 12;
    const bioW = Math.min(14, totalW * 0.5);
    for (let b = 0; b < design.biofilter.units; b++) {
      const bx = -totalW / 2 + (b + 0.5) * (totalW / design.biofilter.units);
      const bh = 2.4;
      const box = new THREE.Mesh(new THREE.BoxGeometry(bioW * 0.8, bh, 6), bioMat);
      box.position.set(bx, bh / 2, bioZ);
      root.add(box);
    }

    // —— 设备/泵房（侧面）——
    const eqX = totalW / 2 + 14;
    const eqMat = new THREE.MeshStandardMaterial({ color: T.eq, roughness: 0.7, metalness: 0.3 });
    const eq = new THREE.Mesh(new THREE.BoxGeometry(10, 6, Math.min(totalL + 20, 40)), eqMat);
    eq.position.set(eqX, 3, 0);
    root.add(eq);
    // 屋顶
    const roof = new THREE.Mesh(new THREE.BoxGeometry(10.6, 0.4, Math.min(totalL + 20, 40) + 0.6), eqMat);
    roof.position.set(eqX, 6.1, 0);
    root.add(roof);

    // —— 管路（从泵房到池区、到生物滤池）——
    const pipeMat = new THREE.MeshStandardMaterial({ color: T.pipe, roughness: 0.5, metalness: 0.6 });
    const pipeY = 0.6;
    function pipe(x1, z1, x2, z2) {
      const dx = x2 - x1, dz = z2 - z1;
      const len = Math.sqrt(dx * dx + dz * dz);
      const g = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, len, 12), pipeMat);
      g.position.set((x1 + x2) / 2, pipeY, (z1 + z2) / 2);
      g.rotation.z = Math.PI / 2;
      g.rotation.y = -Math.atan2(dz, dx);
      root.add(g);
    }
    pipe(eqX - 5, 0, -totalW / 2, bioZ - 3);
    pipe(-totalW / 2, bioZ - 3, -totalW / 2, 0);

    // 标签精灵
    root.add(makeLabel(`养殖池 ${design.culture.tankCount} 个`, 0, H + 4, -totalL / 2));
    root.add(makeLabel(`MBBR 生物滤池 ×${design.biofilter.units}`, 0, 5, bioZ));
    root.add(makeLabel("设备/泵房", eqX, 8, 0));

    scene.add(root);

    // 相机归位
    controls.target.set(0, H, 0);
    const dist = Math.max(totalW, totalL) * 1.1 + 30;
    camera.position.set(dist * 0.7, dist * 0.7, dist * 0.7);
    controls.update();
  }

  function makeLabel(text, x, y, z) {
    const canvas = document.createElement("canvas");
    canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "rgba(15,23,42,0.85)";
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "bold 26px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 128, 32);
    const tex = new THREE.CanvasTexture(canvas);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    spr.scale.set(14, 3.5, 1);
    spr.position.set(x, y, z);
    return spr;
  }

  function animate() {
    rafId = requestAnimationFrame(animate);
    if (controls) {
      controls.autoRotate = autoRotate;
      controls.autoRotateSpeed = 0.8;
      controls.update();
    }
    renderer.render(scene, camera);
  }

  function setAutoRotate(v) { autoRotate = v; }
  function dispose() {
    if (rafId) cancelAnimationFrame(rafId);
    window.removeEventListener("resize", onResize);
    clear();
    if (renderer) renderer.dispose();
  }

  return { init, build, setAutoRotate, dispose };
})();
