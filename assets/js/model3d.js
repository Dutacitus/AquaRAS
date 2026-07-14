/*
 * 参数化 3D 车间模型 (Three.js r128)
 * 真实化重构：养殖池阵列 + 锥形排水 + 提升泵 + MBBR 生物滤池(高位) +
 * CO₂ 脱气塔(高位) + 转鼓微滤机 + 紫外 + 设备/泵房 + 污泥处理
 * 并显示四类管线：水体(循环/补水) / 气体(纯氧/CO₂排放) / 污水(污泥) / 电路(桥架)
 * 考虑水体与设备落差（重力排水、泵提升、高位回水堰）；含流向动画与图例。
 */
window.RAS = window.RAS || {};

RAS.model3d = (function () {
  let scene, camera, renderer, controls, container, rafId;
  let root = null;
  let autoRotate = true;
  let legendEl = null;
  const flows = [];                 // 流向动画标记
  let layers = {};                  // 管线图层（可按类型显隐）
  const state = { water: true, gas: true, sludge: true, elec: true };

  // 管线配色（与图例一致，主题无关，保证辨识度）
  const COL = {
    water: 0x2f9be0,    // 循环水体（蓝）
    makeup: 0x7fd4ff,   // 补新水（浅青）
    gas: 0x2fe0a0,      // 纯氧气体（青绿）
    co2: 0x9aa7b4,      // CO₂ 排放（灰）
    sludge: 0x9c5a32,   // 污水/污泥（棕）
    elec: 0xf4c430,     // 电路/桥架（黄）
  };

  const THEMES = {
    light: { bg: 0xeef2f7, floor: 0xd7e0ea, tank: 0xb9c4d0, water: 0x2f80ed, bio: 0x7fb069, eq: 0x9aa7b4, steel: 0x8a97a6 },
    dark:  { bg: 0x0b1220, floor: 0x121b2b, tank: 0x223047, water: 0x1e88e5, bio: 0x4caf50, eq: 0x2a3a4f, steel: 0x394a5e },
  };
  const Y_BRIDGE = 6.4;   // 地上综合管桥标高（与地下管廊分层呼应；模块级常量，供 build 与图例共用）

  function init(el) {
    container = el;
    const w = el.clientWidth || 800;
    const h = el.clientHeight || 500;

    scene = new THREE.Scene();
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    el.appendChild(renderer.domElement);

    camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 3000);
    camera.position.set(60, 55, 60);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2.02;
    controls.minDistance = 20;
    controls.maxDistance = 320;

    // 灯光：环境 + 主平行光 + 冷色补光 + 半球光（更真实）
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const dir = new THREE.DirectionalLight(0xffffff, 0.95);
    dir.position.set(40, 90, 30); scene.add(dir);
    const dir2 = new THREE.DirectionalLight(0x9ec5ff, 0.35);
    dir2.position.set(-40, 50, -40); scene.add(dir2);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 0.45));

    // 图例（创建一次，build 时更新内容）
    legendEl = document.createElement("div");
    legendEl.className = "model-legend";
    el.appendChild(legendEl);

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
    flows.length = 0;
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

  /* ---------- 基础图元 ---------- */
  function mat(color, opt) {
    opt = opt || {};
    return new THREE.MeshStandardMaterial({
      color, roughness: opt.rough != null ? opt.rough : 0.6,
      metalness: opt.metal != null ? opt.metal : 0.25,
      transparent: opt.opacity != null && opt.opacity < 1,
      opacity: opt.opacity != null ? opt.opacity : 1,
      emissive: opt.emissive != null ? opt.emissive : 0x000000,
      emissiveIntensity: opt.emissiveIntensity != null ? opt.emissiveIntensity : 0,
      side: opt.side || THREE.FrontSide,
    });
  }
  function box(w, h, d, color, opt) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opt));
    return m;
  }
  function cyl(rt, rb, h, color, seg, opt) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 24, 1, !!(opt && opt.open)), mat(color, opt));
    return m;
  }

  /* ---------- 管线（带弯头的真实走向） ---------- */
  function tube(points, color, radius, opt) {
    opt = opt || {};
    const pts = points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    const curve = new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.15);
    const len = curve.getLength();
    const seg = Math.max(6, Math.min(120, Math.round(len * 2.2)));
    const geo = new THREE.TubeGeometry(curve, seg, radius, 9, false);
    const m = new THREE.Mesh(geo, mat(color, { rough: 0.35, metal: 0.45, opacity: opt.opacity }));
    return m;
  }
  function addTube(layerName, points, color, radius, opt) {
    const m = tube(points, color, radius, opt);
    m.userData.flow = opt && opt.flow ? opt.flow : null;
    layers[layerName].add(m);
    return m;
  }

  /* ---------- 流向动画标记 ---------- */
  function addFlow(layerName, points, color, count, speed, radius) {
    const pts = points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    const closed = !!points._closed;
    const curve = new THREE.CatmullRomCurve3(pts, closed, "catmullrom", 0.15);
    const geo = new THREE.SphereGeometry(radius || 0.32, 12, 12);
    const mlist = [];
    for (let i = 0; i < count; i++) {
      const s = new THREE.Mesh(geo, mat(color, { emissive: color, emissiveIntensity: 0.9, rough: 0.3 }));
      layers[layerName].add(s);
      mlist.push(s);
    }
    flows.push({ curve, meshes: mlist, speed, t: Math.random(), span: 1 / count });
  }

  /* ---------- 标签 ---------- */
  function makeLabel(text, x, y, z, color) {
    const canvas = document.createElement("canvas");
    canvas.width = 320; canvas.height = 72;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "rgba(15,23,42,0.82)";
    roundRect(ctx, 0, 0, 320, 72, 14); ctx.fill();
    ctx.fillStyle = color || "#e2e8f0";
    ctx.font = "bold 30px sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(text, 160, 38);
    const tex = new THREE.CanvasTexture(canvas);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    spr.scale.set(16, 3.6, 1);
    spr.position.set(x, y, z);
    return spr;
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ============================================================= */
  function build(design, themeName) {
    if (!scene) return;
    clear();
    const T = THEMES[themeName] || THEMES.dark;
    scene.background = new THREE.Color(T.bg);

    root = new THREE.Group();
    // 图层
    layers = { struct: new THREE.Group(), water: new THREE.Group(), gas: new THREE.Group(), sludge: new THREE.Group(), elec: new THREE.Group() };
    Object.values(layers).forEach((g) => root.add(g));

    const D = design.culture.tankD;
    const H = design.culture.tankH;
    const cols = design.culture.cols;
    const rows = design.culture.rows;
    const gap = D * 1.85;
    const totalW = cols * gap;
    const totalL = rows * gap;
    const r = D / 2;

    // 高程定义（落差核心）
    const yWS = H * 0.82;            // 池内水面
    const yTankTop = H;
    const yBio = 3.6;                // 生物滤池(高位)高度
    const yDeg = 4.6;                // 脱气塔高度
    const zFront = -totalL / 2 - 1.2;     // 养殖区前(南)排水侧
    const zBio = totalL / 2 + D * 1.1;    // 生物滤池(北)
    const zDeg = zBio + 5.5;              // 脱气塔
    const xEq = totalW / 2 + Math.max(D * 1.8, 14);  // 设备/泵房(东)

    /* ---------- 地下管廊分层参数（真实施工：正交路由 + 分层 + 从地下走） ---------- */
    // 各管线在管廊内的垂直分层（负值=地坪以下），避免不同介质管路同深交叉
    const Yd = { drain: -0.8, ret: -1.15, gas: -1.5, sludge: -1.85, elec: -2.2 };
    const yTbot = -2.7;                   // 管廊底
    const xW = -totalW / 2 - 2.4;         // 西管廊(排水收集 + 污泥, N-S 主干)
    const xE = totalW / 2 + 2.4;          // 东管廊(气体 + 电缆 + 设备, N-S 主干)
    const zN = totalL / 2 + 2.4;          // 北管廊(回水配水, E-W 主干)
    const zS = -totalL / 2 - 2.4;         // 南管廊(微滤/泵房接口, E-W 主干)

    /* ---------- 地面（半透明，可见地下管廊） + 网格 ---------- */
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(totalW + 60, totalL + 70), mat(T.floor, { rough: 0.9, opacity: 0.16, side: THREE.DoubleSide }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = 0;
    layers.struct.add(floor);
    const grid = new THREE.GridHelper(Math.max(totalW, totalL) + 60, Math.round((Math.max(totalW, totalL) + 60) / 6), 0x000000, 0x000000);
    grid.material.opacity = 0.08; grid.material.transparent = true; grid.position.y = 0.02;
    layers.struct.add(grid);

    /* ---------- 养殖池阵列 ---------- */
    const tankMat = mat(T.tank, { rough: 0.45, metal: 0.45, side: THREE.DoubleSide });
    const waterMat = mat(T.water, { rough: 0.15, metal: 0.1, opacity: 0.72 });
    const surfMat = mat(0xbfe3ff, { rough: 0.1, metal: 0.2, opacity: 0.5, emissive: 0x16324f, emissiveIntensity: 0.25 });
    const tankPos = [];
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const x = -totalW / 2 + gap / 2 + i * gap;
        const z = -totalL / 2 + gap / 2 + j * gap;
        tankPos.push([x, z]);
        const wall = cyl(r, r * 0.95, H, T.tank, 36, { open: true, rough: 0.4, metal: 0.5 });
        wall.position.set(x, H / 2, z); layers.struct.add(wall);
        const bottom = new THREE.Mesh(new THREE.CircleGeometry(r * 0.95, 36), tankMat);
        bottom.rotation.x = -Math.PI / 2; bottom.position.set(x, 0.06, z); layers.struct.add(bottom);
        // 水体
        const water = cyl(r * 0.93, r * 0.9, yWS, T.water, 36, { rough: 0.15, metal: 0.1, opacity: 0.72 });
        water.position.set(x, yWS / 2 + 0.08, z); layers.struct.add(water);
        // 水面亮面
        const surf = new THREE.Mesh(new THREE.CircleGeometry(r * 0.9, 36), surfMat);
        surf.rotation.x = -Math.PI / 2; surf.position.set(x, yWS + 0.12, z); layers.struct.add(surf);
        // 池中心排水立管在"管线"段统一生成（垂直落入地下排水管廊）
      }
    }

    /* ---------- 转鼓微滤机（前侧，低位） ---------- */
    const drumUnits = design.solids.units;
    const drumW = Math.min(6, totalW / Math.max(drumUnits, 1) * 0.7);
    const drumMat = mat(0xc7d2dd, { rough: 0.4, metal: 0.6 });
    for (let k = 0; k < drumUnits; k++) {
      const x = -totalW / 2 + (k + 0.5) * (totalW / drumUnits);
      const dz = zFront - 2.2;
      const drum = cyl(drumW * 0.5, drumW * 0.5, 2.4, 0xc7d2dd, 28, { rough: 0.4, metal: 0.6 });
      drum.rotation.z = Math.PI / 2; drum.position.set(x, 1.2, dz); layers.struct.add(drum);
      const frame = box(drumW + 0.8, 2.6, drumW + 0.8, T.eq, { rough: 0.7, metal: 0.3 });
      frame.position.set(x, 1.3, dz); layers.struct.add(frame);
    }

    /* ---------- 生物滤池 MBBR（北，高位塔） ---------- */
    const bf = design.biofilter;
    const rb = Math.max(1.3, Math.min(3.0, Math.cbrt(bf.unitVol) * 0.55));
    for (let b = 0; b < bf.units; b++) {
      const x = -totalW / 2 + (b + 0.5) * (totalW / bf.units);
      const shell = cyl(rb, rb, yBio, T.bio, 30, { rough: 0.55, metal: 0.2, opacity: 0.92 });
      shell.position.set(x, yBio / 2, zBio); layers.struct.add(shell);
      // 内部填料提示
      const media = cyl(rb * 0.82, rb * 0.82, yBio * 0.8, 0x8fd06a, 24, { rough: 0.8, opacity: 0.5 });
      media.position.set(x, yBio * 0.45, zBio); layers.struct.add(media);
      // 顶部进水堰 + 底部出水
      const topMan = cyl(rb * 1.15, rb * 1.15, 0.3, T.steel, 24, { rough: 0.5, metal: 0.5 });
      topMan.position.set(x, yBio + 0.15, zBio); layers.struct.add(topMan);
      const bot = cyl(rb * 0.5, rb * 0.5, 0.4, T.steel, 20, { rough: 0.5, metal: 0.5 });
      bot.position.set(x, 0.2, zBio); layers.struct.add(bot);
    }

    /* ---------- CO₂ 脱气塔（北，更高位） ---------- */
    const degR = 1.3;
    const degShell = cyl(degR, degR, yDeg, 0x6fb1c9, 28, { rough: 0.5, metal: 0.25, opacity: 0.92 });
    degShell.position.set(0, yDeg / 2, zDeg); layers.struct.add(degShell);
    // 填料层
    for (let p = 1; p <= 5; p++) {
      const disc = cyl(degR * 0.92, degR * 0.92, 0.12, 0xbfe2ef, 24, { rough: 0.7, opacity: 0.6 });
      disc.position.set(0, (yDeg * p) / 6, zDeg); layers.struct.add(disc);
    }

    /* ---------- 紫外消毒（回水线上，设备侧低位） ---------- */
    const uvX = xEq - 6;
    const uv = cyl(0.7, 0.7, 3.2, 0x3a4a5e, 24, { rough: 0.4, metal: 0.6 });
    uv.rotation.z = Math.PI / 2; uv.position.set(uvX, 1.0, 0); layers.struct.add(uv);
    const uvCap = box(0.5, 1.6, 1.6, 0x9fb0c0, { rough: 0.5, metal: 0.5 });
    uvCap.position.set(uvX, 1.0, 0); layers.struct.add(uvCap);

    /* ---------- 设备/泵房（东） ---------- */
    const eqW = 12, eqD = Math.min(totalL + 18, 44), eqH = 6.2;
    const eqHouse = box(eqW, eqH, eqD, T.eq, { rough: 0.7, metal: 0.3 });
    eqHouse.position.set(xEq, eqH / 2, 0); layers.struct.add(eqHouse);
    const roof = box(eqW + 0.6, 0.4, eqD + 0.6, T.steel, { rough: 0.6, metal: 0.4 });
    roof.position.set(xEq, eqH + 0.2, 0); layers.struct.add(roof);
    // 提升泵（泵坑，低）
    const pumpMat = mat(0x3b556f, { rough: 0.4, metal: 0.6 });
    for (let p = 0; p < 2; p++) {
      const px = xEq - 4 + p * 3;
      const volute = cyl(0.9, 0.9, 1.0, 0x3b556f, 20, { rough: 0.4, metal: 0.6 });
      volute.rotation.z = Math.PI / 2; volute.position.set(px, 0.9, 3); layers.struct.add(volute);
      const motor = cyl(0.5, 0.5, 1.4, 0x2a3a4f, 18, { rough: 0.5, metal: 0.6 });
      motor.position.set(px, 1.9, 3); layers.struct.add(motor);
    }
    // 纯氧发生器
    const o2gen = box(3, 2.4, 2.6, 0x4a6b7a, { rough: 0.5, metal: 0.4 });
    o2gen.position.set(xEq, 1.2, -eqD / 2 + 3); layers.struct.add(o2gen);
    // 自控柜
    const ctl = box(2.2, 3.2, 1.2, 0x2f3b4a, { rough: 0.5, metal: 0.3 });
    ctl.position.set(xEq, 1.6, eqD / 2 - 2); layers.struct.add(ctl);
    const screen = box(1.4, 0.9, 0.1, 0x0b1220, { rough: 0.3, emissive: 0x123, emissiveIntensity: 0.6 });
    screen.position.set(xEq, 2.2, eqD / 2 - 1.35); layers.struct.add(screen);

    /* ---------- 污泥处理（西北角，低位） ---------- */
    const zSludge = zBio + 1.5, xSludge = -totalW / 2 - 9;
    const sump = box(4, 2.4, 4, 0x6b5847, { rough: 0.8, metal: 0.2 });
    sump.position.set(xSludge, 1.2, zSludge); layers.struct.add(sump);
    const press = box(3, 1.6, 5, 0x7a6650, { rough: 0.7, metal: 0.3 });
    press.position.set(xSludge - 4.5, 0.9, zSludge); layers.struct.add(press);

    /* ================= 管线（真实施工：正交路由 + 地下管廊 + 分层） ================= */
    const rMain = Math.max(0.28, Math.min(0.72, design.hydraulics.recircFlowH / 360));
    const rDrop = 0.2;

    // 管廊盖板（标识走向；地面半透明可见下层）
    function trenchCover(x1, x2, z, w, op) {
      const c = box(Math.abs(x2 - x1), 0.06, w, 0x0b1220, { rough: 0.9, opacity: op != null ? op : 0.3 });
      c.position.set((x1 + x2) / 2, 0.05, z); layers.struct.add(c);
    }
    function trenchCoverZ(z1, z2, x, w, op) {
      const c = box(w, 0.06, Math.abs(z2 - z1), 0x0b1220, { rough: 0.9, opacity: op != null ? op : 0.3 });
      c.position.set(x, 0.05, (z1 + z2) / 2); layers.struct.add(c);
    }

    // 地上综合管桥（设备接口专用；正交走线，与地下管廊呼应）
    // 沿一段 (x1,z1)->(x2,z2) 在 Y_BRIDGE 标高铺设桥架：底板 + 双侧导轨 + 等距吊柱
    const rackColor = 0x55657a, railColor = 0x6b7c92;
    function rackRun(x1, z1, x2, z2) {
      const dx = x2 - x1, dz = z2 - z1, len = Math.hypot(dx, dz);
      if (len < 0.01) return;
      const ang = -Math.atan2(dz, dx);
      const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
      const px = -dz / len, pz = dx / len;          // 垂直于走向的单位向量
      // 底板
      const deck = box(len, 0.16, 1.15, rackColor, { rough: 0.7, metal: 0.45 });
      deck.position.set(cx, Y_BRIDGE, cz); deck.rotation.y = ang; layers.struct.add(deck);
      // 双侧导轨
      [-0.46, 0.46].forEach((off) => {
        const rail = box(len, 0.22, 0.12, railColor, { rough: 0.6, metal: 0.5 });
        rail.position.set(cx + px * off, Y_BRIDGE + 0.16, cz + pz * off);
        rail.rotation.y = ang; layers.struct.add(rail);
      });
      // 等距吊柱（地面 → 桥架）
      const n = Math.max(1, Math.round(len / 5));
      for (let s = 0; s <= n; s++) {
        const t = s / n, hx = x1 + dx * t, hz = z1 + dz * t;
        const post = box(0.18, Y_BRIDGE, 0.18, rackColor, { rough: 0.7, metal: 0.4 });
        post.position.set(hx, Y_BRIDGE / 2, hz); layers.struct.add(post);
      }
    }

    // 池心坐标表（用于逐池立管）
    const tankXZ = [];
    for (let i = 0; i < cols; i++)
      for (let j = 0; j < rows; j++)
        tankXZ.push([-totalW / 2 + gap / 2 + i * gap, -totalL / 2 + gap / 2 + j * gap]);
    // 首座生物滤池列中心 x（桥架 N-S 走向对齐）
    const xb0 = -totalW / 2 + 0.5 * (totalW / bf.units);
    const xbLast = -totalW / 2 + (bf.units - 0.5) * (totalW / bf.units);

    /* ---- 水体（排水收集：西管廊 + 逐排横管；回水配水：北管廊 + 逐列立管） ---- */
    // 逐排排水横管（E-W, 地下, 深度 drain）
    for (let j = 0; j < rows; j++) {
      const z = -totalL / 2 + gap / 2 + j * gap;
      addTube("water", [[xW, Yd.drain, z], [totalW / 2 + 0.5, Yd.drain, z]], COL.water, rMain * 0.5);
    }
    // 西管廊（N-S 排水主干）
    addTube("water", [[xW, Yd.drain, zN], [xW, Yd.drain, zS]], COL.water, rMain * 0.7);
    // 南管廊（E-W）把西管廊接到东设备侧
    addTube("water", [[xW, Yd.drain, zS], [xE, Yd.drain, zS]], COL.water, rMain * 0.7);
    // 东竖管廊（N-S, 靠设备段）
    addTube("water", [[xE, Yd.drain, zS], [xE, Yd.drain, 3]], COL.water, rMain * 0.6);
    // 设备侧地下横管 → 提升泵进口
    addTube("water", [[xE, Yd.drain, 3], [xEq - 5.5, Yd.drain, 3]], COL.water, rMain * 0.6);
    // 提升泵（泵坑）→ 地上综合管桥 → 生物滤池顶（设备接口，规整桥架走线）
    // 竖向立管：泵坑 → 桥架标高
    addTube("water", [[xEq - 5.5, Yd.drain, 3], [xEq - 5.5, 1.4, 3], [xEq - 5.5, Y_BRIDGE, 3]], COL.water, rMain * 0.6);
    // 桥架 E-W：泵侧 → 首座滤池列
    addTube("water", [[xEq - 5.5, Y_BRIDGE, 3], [xb0, Y_BRIDGE, 3]], COL.water, rMain);
    // 桥架 N-S：滤池列 → 生物滤池排
    addTube("water", [[xb0, Y_BRIDGE, 3], [xb0, Y_BRIDGE, zBio]], COL.water, rMain);
    // 桥架沿滤池排 E-W 分支接入各滤池顶（立管入池）
    for (let b = 0; b < bf.units; b++) {
      const xb = -totalW / 2 + (b + 0.5) * (totalW / bf.units);
      addTube("water", [[xb0, Y_BRIDGE, zBio], [xb, Y_BRIDGE, zBio], [xb, yBio + 0.6, zBio], [xb, yBio + 0.15, zBio]], COL.water, rMain);
    }
    // 生物滤池 → 脱气塔（溢流经桥架汇管，规整正交走线）
    // 各滤池溢流立管上桥 → 西端桥架干管汇集
    for (let b = 0; b < bf.units; b++) {
      const xb = -totalW / 2 + (b + 0.5) * (totalW / bf.units);
      addTube("water", [[xb, yBio + 0.15, zBio], [xb, Y_BRIDGE, zBio], [xb, Y_BRIDGE, zBio]], COL.water, rMain * 0.55);
    }
    addTube("water", [[xb0, Y_BRIDGE, zBio], [-totalW / 2, Y_BRIDGE, zBio]], COL.water, rMain * 0.55);
    addTube("water", [[-totalW / 2, Y_BRIDGE, zBio], [-totalW / 2, Y_BRIDGE, zDeg]], COL.water, rMain * 0.55);
    addTube("water", [[-totalW / 2, Y_BRIDGE, zDeg], [0, Y_BRIDGE, zDeg], [0, yDeg + 0.15, zDeg]], COL.water, rMain * 0.55);
    // 脱气塔 → 紫外（桥架：南 → 东 → 立管入地接回水管廊）
    addTube("water", [
      [0, yDeg + 0.15, zDeg], [0, Y_BRIDGE, zDeg], [0, Y_BRIDGE, 0], [uvX, Y_BRIDGE, 0],
      [uvX, 1.0, 0], [uvX, 1.0, zN], [uvX, Yd.ret, zN]
    ], COL.water, rMain * 0.55);
    // 北回水管廊（E-W, 地下, 深度 ret）
    addTube("water", [[-totalW / 2 - 0.5, Yd.ret, zN], [totalW / 2 + 0.5, Yd.ret, zN]], COL.water, rMain * 0.7);
    // 逐列回水立管（N-S, 地下）→ 各池（向上进入池内）
    for (let i = 0; i < cols; i++) {
      const x = -totalW / 2 + gap / 2 + i * gap;
      addTube("water", [[x, Yd.ret, zN], [x, Yd.ret, zS]], COL.water, rMain * 0.45);
    }
    // 各池回水入口（立管：地下 → 池沿上方 → 拐入池内落入水面之下，明确接在对应养殖池上，不再悬空）
    for (const [x, z] of tankXZ)
      addTube("water", [
        [x, Yd.ret, z], [x, H + 0.3, z], [x + r * 0.5, H + 0.3, z], [x + r * 0.5, yWS - 0.2, z]
      ], COL.water, rDrop);
    // 各池排水出口（立管：池底 → 地下排水管廊）
    for (const [x, z] of tankXZ)
      addTube("water", [[x, 0.1, z], [x, Yd.drain, z]], COL.water, rDrop);
    // 补水（新水）从设备侧接入北回水管廊
    addTube("water", [[xEq, 0.6, -eqD / 2 - 1], [xEq, Yd.ret, -eqD / 2 - 1], [xEq, Yd.ret, zN], [totalW / 2 + 0.5, Yd.ret, zN]], COL.makeup, rMain * 0.5);

    /* ---- 气体（纯氧）：东管廊 + 逐排横管 + 各池氧气锥 ---- */
    addTube("gas", [[xE, Yd.gas, zS], [xE, Yd.gas, zN]], COL.gas, 0.16);
    for (let j = 0; j < rows; j++) {
      const z = -totalL / 2 + gap / 2 + j * gap;
      addTube("gas", [[xW, Yd.gas, z], [xE, Yd.gas, z]], COL.gas, 0.16);
    }
    // 纯氧发生器 → 东管廊（立管下地）
    addTube("gas", [[xEq, 1.2, -eqD / 2 + 3], [xEq, Yd.gas, -eqD / 2 + 3], [xE, Yd.gas, -eqD / 2 + 3]], COL.gas, 0.16);
    // 各池氧气锥（立管：地下 → 池底）
    for (const [x, z] of tankXZ) {
      addTube("gas", [[x, Yd.gas, z], [x, 0.5, z]], COL.gas, 0.14);
      const cone = cyl(0.45, 0.28, 0.9, 0x2fe0a0, 16, { rough: 0.3, metal: 0.4, opacity: 0.9 });
      cone.position.set(x, 0.6, z); layers.gas.add(cone);
    }
    // CO₂ 排放（脱气塔顶 → 高空排气，地上特殊立管；底部没入塔顶，明确接在脱气塔上，不再悬空）
    addTube("gas", [[0, yDeg - 0.3, zDeg], [0, yDeg + 1.4, zDeg], [0, yDeg + 1.6, zDeg], [0, yDeg + 1.6, zDeg + 1.2]], COL.co2, 0.2);

    /* ---- 污水（污泥）：西管廊(污泥层) + 微滤反洗/滤池排泥 → 污泥池 → 脱水 ---- */
    addTube("sludge", [[xW, Yd.sludge, zS], [xW, Yd.sludge, zSludge]], COL.sludge, 0.2);
    for (let k = 0; k < drumUnits; k++) {
      const x = -totalW / 2 + (k + 0.5) * (totalW / drumUnits);
      addTube("sludge", [[x, 0.5, zFront - 2.2], [x, Yd.sludge, zFront - 2.2], [x, Yd.sludge, zS], [xW, Yd.sludge, zS]], COL.sludge, 0.2);
    }
    for (let b = 0; b < bf.units; b++) {
      const xb = -totalW / 2 + (b + 0.5) * (totalW / bf.units);
      addTube("sludge", [[xb, 0.2, zBio], [xb, Yd.sludge, zBio], [xW, Yd.sludge, zBio]], COL.sludge, 0.2);
    }
    addTube("sludge", [[xW, Yd.sludge, zSludge], [xSludge, Yd.sludge, zSludge]], COL.sludge, 0.24);
    addTube("sludge", [[xSludge, 0.8, zSludge], [xSludge - 4.5, 0.8, zSludge]], COL.sludge, 0.24);

    /* ---- 电路：东管廊(电缆层) + 逐排线槽 + 各池传感器/泵/滤池 ---- */
    addTube("elec", [[xE, Yd.elec, zS], [xE, Yd.elec, zN]], COL.elec, 0.1);
    for (let j = 0; j < rows; j++) {
      const z = -totalL / 2 + gap / 2 + j * gap;
      addTube("elec", [[xW, Yd.elec, z], [xE, Yd.elec, z]], COL.elec, 0.1);
    }
    // 自控柜 → 东电缆管廊
    addTube("elec", [[xEq, 1.6, eqD / 2 - 2], [xEq, Yd.elec, eqD / 2 - 2], [xE, Yd.elec, eqD / 2 - 2]], COL.elec, 0.1);
    // 各池传感器（立管：地下 → 池顶）
    for (const [x, z] of tankXZ) {
      addTube("elec", [[x, Yd.elec, z], [x, yTankTop + 0.3, z]], COL.elec, 0.1);
      const sbox = box(0.5, 0.5, 0.5, 0x1f2937, { rough: 0.5 });
      sbox.position.set(x + r * 0.7, yTankTop + 0.3, z); layers.elec.add(sbox);
    }
    // 泵/滤池供电立管
    addTube("elec", [[xEq - 4, Yd.elec, 3], [xEq - 4, 3.2, 3]], COL.elec, 0.1);
    for (let b = 0; b < bf.units; b++) {
      const xb = -totalW / 2 + (b + 0.5) * (totalW / bf.units);
      addTube("elec", [[xb, Yd.elec, zBio], [xb, yBio * 0.6, zBio]], COL.elec, 0.1);
    }

    /* ---- 管廊盖板（地面可见走向） ---- */
    for (let j = 0; j < rows; j++) {
      const z = -totalL / 2 + gap / 2 + j * gap;
      trenchCover(xW, xE, z, 1.7, 0.26);
    }
    trenchCoverZ(zS, zN, xW, 1.7, 0.26);
    trenchCoverZ(zS, zN, xE, 1.7, 0.26);
    trenchCover(-totalW / 2 - 0.5, totalW / 2 + 0.5, zN, 1.7, 0.26);

    /* ---- 地上综合管桥（设备接口专用；与地下管廊正交呼应） ---- */
    rackRun(xEq - 5.5, 3, xb0, 3);          // 泵侧 → 首座滤池列 (E-W)
    rackRun(xb0, 3, xb0, zBio);             // 滤池列 (N-S)
    rackRun(-totalW / 2, zBio, xbLast, zBio); // 滤池排 (E-W，含供水支与溢流汇)
    rackRun(-totalW / 2, zBio, -totalW / 2, zDeg); // 西端干管 (N-S)
    rackRun(-totalW / 2, zDeg, 0, zDeg);    // 脱气塔前 (E-W)
    rackRun(0, zDeg, 0, 0);                  // 脱气塔 → 紫外 (N-S)
    rackRun(0, 0, uvX, 0);                   // 紫外前 (E-W)

    /* ================= 流向动画（沿真实路由：地下管廊 + 地上综合管桥） ================= */
    const x0 = tankXZ[Math.floor(tankXZ.length / 2)][0];
    const z0 = tankXZ[Math.floor(tankXZ.length / 2)][1];
    const loop = [
      [x0, 0.1, z0], [x0, Yd.drain, z0], [xW, Yd.drain, z0], [xW, Yd.drain, zS],
      [xE, Yd.drain, zS], [xE, Yd.drain, 3], [xEq - 5.5, Yd.drain, 3], [xEq - 5.5, 1.4, 3],
      [xEq - 5.5, Y_BRIDGE, 3], [xb0, Y_BRIDGE, 3], [xb0, Y_BRIDGE, zBio],
      [xb0, yBio + 0.6, zBio], [xb0, yBio + 0.15, zBio],
      [xb0, Y_BRIDGE, zBio], [-totalW / 2, Y_BRIDGE, zBio], [-totalW / 2, Y_BRIDGE, zDeg],
      [0, Y_BRIDGE, zDeg], [0, yDeg + 0.15, zDeg], [0, 0.4, zDeg],
      [0, Y_BRIDGE, zDeg], [0, Y_BRIDGE, 0], [uvX, Y_BRIDGE, 0], [uvX, 1.0, 0],
      [uvX, 1.0, zN], [uvX, Yd.ret, zN],
      [x0, Yd.ret, zN], [x0, Yd.ret, z0],
      [x0, H + 0.3, z0], [x0 + r * 0.5, H + 0.3, z0], [x0 + r * 0.5, yWS - 0.2, z0],
      [x0, 0.1, z0],
    ];
    loop._closed = true;
    addFlow("water", loop, COL.water, 6, 0.012, 0.34);
    // 气体流向（发生器 → 东管廊 → 池底氧气锥）
    const gasPath = [
      [xEq, 1.2, -eqD / 2 + 3], [xEq, Yd.gas, -eqD / 2 + 3], [xE, Yd.gas, -eqD / 2 + 3],
      [xE, Yd.gas, z0], [x0, Yd.gas, z0], [x0, 0.5, z0],
    ];
    addFlow("gas", gasPath, COL.gas, 3, 0.03, 0.26);
    // 污泥流向（微滤 → 西管廊 → 污泥池）
    const sludgePath = [
      [tankXZ[0][0], 0.5, zFront - 2.2], [tankXZ[0][0], Yd.sludge, zFront - 2.2],
      [tankXZ[0][0], Yd.sludge, zS], [xW, Yd.sludge, zS], [xW, Yd.sludge, zSludge],
      [xSludge, Yd.sludge, zSludge], [xSludge, 0.8, zSludge], [xSludge - 4.5, 0.8, zSludge],
    ];
    addFlow("sludge", sludgePath, COL.sludge, 2, 0.02, 0.24);

    /* ================= 标签 ================= */
    root.add(makeLabel(`养殖池 ${design.culture.tankCount} 个`, 0, yTankTop + 4.5, -totalL / 2, "#e2e8f0"));
    root.add(makeLabel(`MBBR 生物滤池 ×${bf.units} (顶 +${yBio}m)`, 0, yBio + 2.6, zBio, "#bfe9c8"));
    root.add(makeLabel(`CO₂ 脱气塔 (+${yDeg}m)`, 0, yDeg + 2.2, zDeg, "#cdd8e3"));
    root.add(makeLabel(`转鼓微滤机 ×${drumUnits}`, 0, 4.2, zFront - 2.2, "#e2e8f0"));
    root.add(makeLabel(`设备/泵房`, xEq, 8.2, 0, "#e2e8f0"));
    root.add(makeLabel(`污泥处理`, xSludge, 4.0, zSludge, "#e8c9a8"));
    root.add(makeLabel(`北回水管廊 (地下 -${Math.abs(Yd.ret)}m)`, 0, 1.2, zN, "#bfe3ff"));
    root.add(makeLabel(`地上综合管桥 (+${Y_BRIDGE}m)`, xb0, Y_BRIDGE + 1.6, zBio, "#cbd5e1"));
    root.add(makeLabel(`西排水管廊 / 东气电管廊 (地下)`, 0, 0.9, -totalL / 2 - 6, "#94a3b8"));
    root.add(makeLabel(`← 水体(地下+桥架) │ 气体(地下) │ 污水(地下) │ 电路(地下) →`, 0, 0.5, -totalL / 2 - 9, "#94a3b8"));

    scene.add(root);

    // 应用图层显隐
    Object.keys(state).forEach((k) => { layers[k].visible = state[k]; });

    // 相机归位
    controls.target.set(0, 2.4, 0);
    const dist = Math.max(totalW, totalL, yDeg) * 1.15 + 34;
    camera.position.set(dist * 0.75, dist * 0.62, dist * 0.78);
    controls.update();

    updateLegend();
  }

  function updateLegend() {
    if (!legendEl) return;
    const items = [
      ["水体(循环)", COL.water], ["补水(新水)", COL.makeup], ["气体(纯氧)", COL.gas],
      ["CO₂ 排放", COL.co2], ["污水(污泥)", COL.sludge], ["电路(桥架)", COL.elec],
    ];
    legendEl.innerHTML = `<div class="ml-title">管线图例</div>` + items.map((it) =>
      `<div class="ml-item"><span class="ml-sw" style="background:#${it[1].toString(16).padStart(6, "0")}"></span>${it[0]}</div>`
    ).join("") + `<div class="ml-note">● 流动光点表示流向 · 全线正交：水体/气/污/电走地下管廊分层；设备接口经地上综合管桥(标高 +${Y_BRIDGE}m)规整走线</div>`;
  }

  /* ---------- 动画 ---------- */
  function animate() {
    rafId = requestAnimationFrame(animate);
    for (const f of flows) {
      f.t = (f.t + f.speed) % 1;
      for (let i = 0; i < f.meshes.length; i++) {
        const tt = (f.t + i * f.span) % 1;
        const p = f.curve.getPointAt(tt);
        f.meshes[i].position.copy(p);
      }
    }
    if (controls) {
      controls.autoRotate = autoRotate;
      controls.autoRotateSpeed = 0.7;
      controls.update();
    }
    renderer.render(scene, camera);
  }

  function setAutoRotate(v) { autoRotate = v; }
  function setLayer(name, vis) {
    state[name] = !!vis;
    if (layers[name]) layers[name].visible = !!vis;
  }
  function dispose() {
    if (rafId) cancelAnimationFrame(rafId);
    window.removeEventListener("resize", onResize);
    clear();
    if (renderer) renderer.dispose();
  }

  return { init, build, setAutoRotate, setLayer, dispose };
})();
