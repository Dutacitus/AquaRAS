/*
 * AquaRAS 应用编排
 * 主题切换 / 标签导航 / 磁吸交互 / 计算驱动渲染 / P&ID / 寻优 / 方案库 / 3D / 报告导出
 */
(function () {
  "use strict";
  const K = window.RAS_KNOWLEDGE;
  const E = window.RAS.engine;
  let currentDesign = null;
  let modelInited = false;
  const LIB_KEY = "ras-schemes";
  let compareBasket = [];

  /* ---------------- 主题 ---------------- */
  const root = document.documentElement;
  function applyTheme(t) {
    if (t === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      root.setAttribute("data-theme", mq.matches ? "dark" : "light");
    } else root.setAttribute("data-theme", t);
    localStorage.setItem("ras-theme", t);
    if (modelInited && currentDesign) RAS.model3d.build(currentDesign, root.getAttribute("data-theme"));
  }
  function initTheme() {
    const saved = localStorage.getItem("ras-theme") || "dark";
    applyTheme(saved);
    document.querySelectorAll("#themeToggle button").forEach((b) => {
      b.classList.toggle("active", b.dataset.themeSet === saved);
      b.addEventListener("click", () => {
        document.querySelectorAll("#themeToggle button").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        applyTheme(b.dataset.themeSet);
      });
    });
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if ((localStorage.getItem("ras-theme") || "dark") === "system") applyTheme("system");
    });
  }

  /* ---------------- 标签导航 ---------------- */
  function activateTab(name) {
    const tab = document.querySelector(`#tabs .tab[data-tab="${name}"]`);
    if (!tab) return;
    document.querySelectorAll("#tabs .tab").forEach((t) => t.classList.toggle("active", t === tab));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    document.getElementById("panel-" + name).classList.add("active");
    if (name === "model") ensureModel();
  }
  function initTabs() {
    document.querySelectorAll("#tabs .tab").forEach((tab) => {
      tab.addEventListener("click", () => activateTab(tab.dataset.tab));
    });
  }

  /* ---------------- PFD ↔ P&ID 联动高亮 ---------------- */
  function clearLink() {
    document.querySelectorAll("#pfdHost [data-key], #pidHost [data-key]")
      .forEach((el) => { el.classList.remove("linked", "link-flash"); });
  }
  function flashOnce(el) {
    el.classList.remove("link-flash");
    // 强制重绘以重启动画
    void el.offsetWidth;
    el.classList.add("link-flash");
    el.addEventListener("animationend", () => el.classList.remove("link-flash"), { once: true });
  }
  function initLinking() {
    document.addEventListener("click", (e) => {
      const el = e.target.closest("[data-key]");
      if (!el) return;
      const host = el.closest("#pfdHost") || el.closest("#pidHost");
      if (!host) return;
      const key = el.dataset.key;
      if (!key) return;
      clearLink();
      const matches = document.querySelectorAll(`#pfdHost [data-key="${key}"], #pidHost [data-key="${key}"]`);
      matches.forEach((m) => { m.classList.add("linked"); flashOnce(m); });
      // 切换至对侧图，使联动高亮可见
      activateTab(host.id === "pfdHost" ? "pid" : "pfd");
    });
  }

  /* ---------------- 磁吸 ---------------- */
  function initMagnetic() {
    document.querySelectorAll(".magnetic").forEach((el) => {
      el.addEventListener("mousemove", (e) => {
        const r = el.getBoundingClientRect();
        const x = e.clientX - r.left - r.width / 2;
        const y = e.clientY - r.top - r.height / 2;
        el.style.transform = `translate(${x * 0.18}px, ${y * 0.28}px)`;
      });
      el.addEventListener("mouseleave", () => { el.style.transform = ""; });
    });
  }
  function rebindMagnetic(scope) {
    (scope || document).querySelectorAll(".magnetic").forEach((el) => {
      if (el._mag) return; el._mag = true;
      el.addEventListener("mousemove", (e) => {
        const r = el.getBoundingClientRect();
        el.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * 0.18}px, ${(e.clientY - r.top - r.height / 2) * 0.28}px)`;
      });
      el.addEventListener("mouseleave", () => { el.style.transform = ""; });
    });
  }

  /* ---------------- 品种 ---------------- */
  function initSpecies() {
    const sel = document.getElementById("species");
    Object.values(K.species).forEach((s) => {
      const o = document.createElement("option");
      o.value = s.key; o.textContent = `${s.name} (${s.latin})`;
      sel.appendChild(o);
    });
    sel.value = "bass";
    const hint = document.getElementById("speciesHint");
    const updHint = () => {
      const s = K.species[sel.value];
      const salTxt = s.salinity === "marine" ? "海水" : (s.salinity === "brackish" ? "半咸水" : "淡水");
      const mech = [];
      if (s.matlFactor && s.matlFactor > 1) mech.push("耐蚀材质");
      if (s.o2SatFactor && s.o2SatFactor < 1) mech.push("溶氧饱和低");
      hint.innerHTML = `${s.group} · <b>${salTxt}</b> · 适温 ${s.tempRange[0]}–${s.tempRange[1]}℃ · FCR ${s.fcr}`
        + (mech.length ? ` · <span style="color:#f59e0b">${mech.join("/")}</span>` : "");
    };
    sel.addEventListener("change", updHint);
    updHint();
  }

  /* ---------------- 地区气温预设 ---------------- */
  function initRegionChips() {
    const chips = document.getElementById("regionChips");
    if (!chips || !K.climate || !K.climate.regions) return;
    // 单一数据源：从 knowledge.climate.regions 动态生成地区预设（保证 UI 与知识库一致，修正原硬编码上海 16→17、缺三亚/昆明/武汉/成都）
    chips.innerHTML = "";
    Object.entries(K.climate.regions).forEach(([key, r]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.dataset.t = r.ambient;
      b.dataset.region = key;
      b.textContent = r.name + " " + r.ambient + "℃";
      chips.appendChild(b);
    });
    const form = document.getElementById("designForm");
    chips.querySelectorAll(".chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.getElementById("ambient").value = parseFloat(btn.dataset.t);
        const regEl = document.getElementById("region");
        if (regEl) regEl.value = btn.dataset.region;
        chips.querySelectorAll(".chip").forEach((b) => b.classList.remove("on"));
        btn.classList.add("on");
        if (form) form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event("submit", { cancelable: true }));
      });
    });
    const amb = document.getElementById("ambient");
    if (amb) {
      const cur = parseFloat(amb.value);
      const match = [...chips.querySelectorAll(".chip")].find((b) => parseFloat(b.dataset.t) === cur);
      if (match) match.classList.add("on");
    }
  }

  /* ---------------- 输入读取 / 计算 ---------------- */
  function readInputs() {
    const num = (id, def) => {
      const v = parseFloat(document.getElementById(id).value);
      return isNaN(v) ? def : v;
    };
    const sp = K.species[document.getElementById("species").value];
    return {
      speciesKey: sp.key,
      annualTons: num("annualTons", 100),
      targetDensity: document.getElementById("density").value ? num("density") : null,
      cycles: document.getElementById("cycles").value ? num("cycles") : null,
      fcr: document.getElementById("fcr").value ? num("fcr") : null,
      recircTurns: num("turns", 12),
      makeupRate: num("makeup", 1) / 100,
      designTemp: document.getElementById("designTemp").value ? num("designTemp") : null,
      ambientTemp: document.getElementById("ambient").value ? num("ambient", 15) : 15,
      region: document.getElementById("region") ? (document.getElementById("region").value || null) : null,
      safety: num("safety", 1.15),
      salePrice: document.getElementById("salePrice").value.trim() ? num("salePrice") : null,
      feedPrice: document.getElementById("feedPrice").value.trim() ? num("feedPrice") : null,
      fingerlingPrice: document.getElementById("fingerlingPrice").value.trim() ? num("fingerlingPrice") : null,
      elecPrice: document.getElementById("elecPrice").value.trim() ? num("elecPrice") : null,
      waterPrice: document.getElementById("waterPrice").value.trim() ? num("waterPrice") : null,
      laborPerYear: document.getElementById("laborPerYear").value.trim() ? num("laborPerYear") : null,
    };
  }
  function renderAll(d) {
    renderParams(d); renderPFD(d); renderPID(d); renderBOM(d); renderEcon(d); renderHero(d);
  }
  function setHero(id, html) { const el = document.getElementById(id); if (el) el.innerHTML = html; }
  function renderHero(d) {
    if (!d) return;
    setHero("hsReuse", `${d.hydraulics.waterReuse}<small>%</small>`);
    setHero("hsSwu", `${d.hydraulics.specificWaterUse}<small>m³/kg</small>`);
    setHero("hsYield", `${(d._raw.annual / 1000)}<small>t/a</small>`);
    setHero("hsSpecies", d.species.name);
  }
  function compute() {
    currentDesign = E.compute(readInputs());
    renderAll(currentDesign);
  }

  /* ---------------- 渲染：工艺参数 ---------------- */
  function metricCard(k, v, unit, sub, cls) {
    return `<div class="metric ${cls || ""}"><div class="k">${k}</div>
      <div class="v">${v}${unit ? `<small>${unit}</small>` : ""}</div>${sub ? `<div class="sub">${sub}</div>` : ""}</div>`;
  }
  function section(title, badge, items) {
    return `<div class="section-title">${title}${badge ? `<span class="badge">${badge}</span>` : ""}</div>
      <div class="metrics">${items.join("")}</div>`;
  }
  /* 水质可行性校核区块（稳态质量平衡结果 + OK/WARN/FAIL 徽章） */
  function renderWQSection(wq) {
    if (!wq) return "";
    const lab = { ok: "达标", warn: "预警", fail: "超限" };
    const cards = wq.checks.map((c) => `
      <div class="wq-item wq-${c.status}">
        <div class="wq-top"><span class="wq-name">${c.name}</span>
          <span class="wq-pill wq-${c.status}">${lab[c.status]}</span></div>
        <div class="wq-val">${c.value}<small>${c.unit}</small></div>
        <div class="wq-lim">限值 ${c.limit} ${c.unit}</div>
        <div class="wq-note">${c.note}</div>
      </div>`).join("");
    const head = wq.feasible
      ? (wq.status === "ok" ? "全部达标" : "部分指标预警")
      : "存在超限指标，需调整设计";
    return `
      <div class="section-title">水质可行性校核
        <span class="badge wq-${wq.status}">${head}</span></div>
      <div class="wq-grid">${cards}</div>
      <div class="note" style="padding:6px 26px 0"><span class="ic">♻️</span>
      <div>反硝化：脱氮率 <b>${Math.round(wq.denit.removal * 100)}%</b>，NO₃-N 稳态 <b>${wq.no3N}</b> mg/L（以 N 计），需反硝化反应器容积约 <b>${wq.denit.volume}</b> m³（负荷 ${wq.denit.no3NLoadDaily} kg NO₃-N/天）。</div></div>
      <div style="padding:0 26px 26px"><div class="note">
        <span class="ic">🔬</span>
        <div>稳态质量平衡校核：基于两段硝化（AOB/NOB）+ 反硝化 + 脱气塔 + 微滤机一阶去除，并叠加补水稀释与水源背景浓度，推算系统浓度，供设计可行性判断。溶氧按供氧能力（覆盖鱼代谢 + 硝化耗氧，余量 ${wq.o2Margin}%）闭环判定池内可达 <b>${wq.o2Achieved}</b> mg/L${wq.o2Deficit > 0.1 ? `（缺口 ${wq.o2Deficit} mg/L，供氧不足）` : ""}；数值为工程估算，运行需在线监测 DO/pH/TAN/CO₂ 并预留余量。</div></div></div>`;
  }
  /* 敏感度（龙卷风图）：基于 engine.sensitivity 的 ±% 扰动结果渲染水平条带 */
  function renderSensitivity(d) {
    const host = document.getElementById("snChart");
    if (!host) return;
    const sel = document.getElementById("snMetric");
    const metric = sel ? sel.value : "costPerKg";
    const sn = E.sensitivity(d, { metric });
    const lowerBetter = metric !== "grossProfit";
    const vals = sn.drivers.flatMap((r) => [r.low, r.high]).concat([sn.baseVal]);
    let axMin = Math.min.apply(null, vals), axMax = Math.max.apply(null, vals);
    if (axMax - axMin < 1e-9) { axMin -= 1; axMax += 1; }
    const span = axMax - axMin;
    const pct = (v) => ((v - axMin) / span) * 100;
    const dispUnit = metric === "grossProfit" ? "万元" : sn.unit;
    const fmtV = (v) => metric === "grossProfit" ? (v / 10000).toFixed(1) : v.toFixed(2);
    const rows = sn.drivers.map((r) => {
      const lo = Math.min(r.low, r.high), hi = Math.max(r.low, r.high);
      const loP = pct(lo), hiP = pct(hi), baseP = pct(sn.baseVal);
      const goodPct = lowerBetter
        ? ((baseP - loP) / (hiP - loP) * 100)
        : ((hiP - baseP) / (hiP - loP) * 100);
      const goodCls = lowerBetter ? "sn-good" : "sn-bad";
      const badCls = lowerBetter ? "sn-bad" : "sn-good";
      return `<div class="tornado-row">
        <div class="tornado-label">${r.label}</div>
        <div class="tornado-track">
          <div class="sn-bar" style="left:${loP.toFixed(1)}%;width:${(hiP - loP).toFixed(1)}%">
            <div class="sn-seg ${goodCls}" style="width:${goodPct.toFixed(1)}%"></div>
            <div class="sn-seg ${badCls}" style="width:${(100 - goodPct).toFixed(1)}%"></div>
          </div>
          <div class="tornado-base" style="left:${baseP.toFixed(1)}%"></div>
        </div>
        <div class="tornado-val">低 ${fmtV(r.low)}<br>高 ${fmtV(r.high)}</div>
      </div>`;
    }).join("");
    host.innerHTML = `<div class="tornado">${rows}</div>
      <div class="tornado-axis">基线 ${fmtV(sn.baseVal)} ${dispUnit}</div>`;
  }
  /* 季节性温控剖面：基于 engine 的 hvacMonths（bin method 12 月双工况）渲染内联 SVG 柱图 */
  function renderHvacSeason(en, setTemp) {
    if (!en || !en.hvacMonths || !en.hvacMonths.length) return "";
    const W = 620, H = 132, padX = 8, padTop = 12, padBot = 22;
    const n = en.hvacMonths.length;
    const maxP = Math.max.apply(null, en.hvacMonths.map((m) => m.powerKw)) || 1;
    const gap = 6;
    const bw = (W - padX * 2 - gap * (n - 1)) / n;
    const baseY = H - padBot;
    const months = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];
    const bars = en.hvacMonths.map((m, i) => {
      const x = padX + i * (bw + gap);
      const h = maxP > 0 ? (m.powerKw / maxP) * (baseY - padTop) : 0;
      const y = baseY - h;
      const col = m.mode === "heat" ? "#f97316" : (m.mode === "cool" ? "#38bdf8" : "#64748b");
      const modeLab = m.mode === "heat" ? "制热" : (m.mode === "cool" ? "制冷" : "中性");
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" rx="2" fill="${col}" opacity="0.92">`
        + `<title>${m.m}月 · ${modeLab} · ${m.powerKw} kW · 均温 ${m.T}℃</title></rect>`
        + `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 7}" font-size="9" fill="#94a3b8" text-anchor="middle">${months[i]}</text>`;
    }).join("");
    return `
      <div style="padding:0 26px 6px">
        <div style="font-size:13px;color:#cbd5e1;margin:6px 0 4px">季节性温控剖面（bin method · 12 月双工况）</div>
        <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:8px 10px">
          <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="xMidYMid meet" style="display:block">${bars}</svg>
        </div>
        <div class="note" style="margin-top:6px"><span class="ic">🌡️</span>
        <div>制热 <b>${(en.hvacHeatingKwh / 1000).toFixed(0)}</b> MWh / 制冷 <b>${(en.hvacCoolingKwh / 1000).toFixed(0)}</b> MWh（年合计 <b>${(en.hvacAnnualKwh / 1000).toFixed(0)}</b> MWh），${(en.hvacMode === "cool" ? "制冷主导" : "加热主导")}；无地区时退化为单点估算。柱高∝当月平均功率，橙=制热、蓝=制冷、灰=中性（无需控温）。</div></div>
      </div>`;
  }
  /* 能耗分项构成（P2-6）：五类（泵/氧/脱气/温控/杂项）环形图 + 图例 */
  function renderEnergySplit(en) {
    if (!en || !en.energySplit) return "";
    const sp = [
      { label: "泵", v: en.energySplit.pump, c: "#38bdf8" },
      { label: "增氧", v: en.energySplit.oxy, c: "#34d399" },
      { label: "脱气", v: en.energySplit.degas, c: "#a78bfa" },
      { label: "温控", v: en.energySplit.hvac, c: "#f59e0b" },
      { label: "杂项(含固废)", v: en.energySplit.misc, c: "#94a3b8" },
    ];
    const total = sp.reduce((a, x) => a + x.v, 0) || 1;
    const W = 150, H = 150, cx = 75, cy = 75, r = 60, rin = 38;
    let a0 = -Math.PI / 2;
    const arcs = sp.map((x) => {
      const frac = x.v / total;
      const a1 = a0 + frac * 2 * Math.PI;
      const large = frac > 0.5 ? 1 : 0;
      const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
      const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
      const xi1 = cx + rin * Math.cos(a1), yi1 = cy + rin * Math.sin(a1);
      const xi0 = cx + rin * Math.cos(a0), yi0 = cy + rin * Math.sin(a0);
      const path = `M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)} L${xi1.toFixed(1)} ${yi1.toFixed(1)} A${rin} ${rin} 0 ${large} 0 ${xi0.toFixed(1)} ${yi0.toFixed(1)} Z`;
      a0 = a1;
      return `<path d="${path}" fill="${x.c}" opacity="0.9"><title>${x.label} ${x.v} kW (${(frac * 100).toFixed(0)}%)</title></path>`;
    }).join("");
    const legend = sp.map((x) => `<span style="display:inline-flex;align-items:center;gap:5px;margin-right:12px;font-size:12.5px"><span style="width:10px;height:10px;border-radius:2px;background:${x.c};display:inline-block"></span>${x.label} ${(x.v / total * 100).toFixed(0)}%</span>`).join("");
    return `
      <div style="padding:0 26px 6px">
        <div style="font-size:13px;color:#cbd5e1;margin:6px 0 4px">能耗分项构成（五类占比）</div>
        <div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap">
          <svg viewBox="0 0 ${W} ${H}" width="130" height="130" style="flex:0 0 auto">${arcs}
            <text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="15" fill="#e2e8f0" font-weight="bold">${en.totalPower}</text>
            <text x="${cx}" y="${cy + 12}" text-anchor="middle" font-size="9" fill="#94a3b8">kW 总功率</text></svg>
          <div style="flex:1 1 200px">${legend}</div>
        </div>
      </div>`;
  }
  /* 规模经济曲线（P2-4）：本地复算分段幂律（数据源 knowledge.capexModel），标注当前规模点 */
  function sfFor(t) {
    const cm = K.economics.capexModel;
    const curve = cm.scaleCurve && cm.scaleCurve.length ? cm.scaleCurve : null;
    let exp = cm.scaleExponent != null ? cm.scaleExponent : 0.72;
    if (curve) { for (const seg of curve) { if (t <= seg.upto) { exp = seg.exp; break; } } }
    let sf = Math.pow(cm.refAnnualTons / t, 1 - exp);
    sf = Math.min(Math.max(sf, cm.scaleCeil != null ? cm.scaleCeil : 0.5), cm.scaleFloor != null ? cm.scaleFloor : 3);
    return sf;
  }
  function renderScaleCurve(annT) {
    const cm = K.economics.capexModel;
    const W = 620, H = 150, padX = 10, padTop = 14, padBot = 30;
    const xMax = 2000, xs = [];
    for (let t = 10; t <= xMax; t += 40) xs.push(t);
    const ys = xs.map((t) => sfFor(t));
    const yMax = (Math.max.apply(null, ys.concat([cm.scaleFloor || 3])) * 1.05);
    const sx = (t) => padX + (t / xMax) * (W - padX * 2);
    const sy = (y) => padTop + (1 - y / yMax) * (H - padTop - padBot);
    const line = xs.map((t, i) => `${i ? "L" : "M"}${sx(t).toFixed(1)} ${sy(ys[i]).toFixed(1)}`).join("");
    const cx = sx(annT), cy = sy(sfFor(annT));
    const xticks = [10, 100, 300, 1000, 2000].map((t) => `<text x="${sx(t).toFixed(1)}" y="${H - 10}" font-size="9" fill="#94a3b8" text-anchor="middle">${t}t</text>`).join("");
    return `
      <div style="padding:0 26px 6px">
        <div style="font-size:13px;color:#cbd5e1;margin:6px 0 4px">规模经济曲线（分段幂律，单位投资因子 vs 年产量）</div>
        <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:8px 10px">
          <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="xMidYMid meet" style="display:block">
            <path d="${line}" fill="none" stroke="#38bdf8" stroke-width="2"/>
            <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4" fill="#f59e0b"><title>当前 ${annT}t → ${sfFor(annT)}</title></circle>
            ${xticks}
          </svg>
        </div>
        <div class="note" style="margin-top:6px"><span class="ic">📉</span>
        <div>分段曲线：小规(&lt;30t)单位投资最高(因子≈${sfFor(10)})，随规模上升快速下降，大规(300→1000t)趋平收敛(≈${sfFor(300)}~${sfFor(1000)})；当前 <b>${annT}t</b> 对应因子 <b>${sfFor(annT)}</b>。极端规模夹在 [${cm.scaleCeil}, ${cm.scaleFloor}] 防失真。</div></div>
      </div>`;
  }
  /* 蒙特卡洛结果渲染（P2-1）：P10/P50/P90 区间 + 分布直方图 + 水质可行率 */
  function renderMonteCarlo(res) {
    const box = document.getElementById("mcResult");
    if (!box) return;
    const row = (label, o, unit) => `
      <div style="display:grid;grid-template-columns:1.1fr 1fr 1fr 1fr;gap:6px;padding:4px 0;font-size:12.5px;border-bottom:1px solid rgba(255,255,255,.06)">
        <span style="color:#cbd5e1">${label}</span>
        <span style="color:#94a3b8">P10 <b style="color:#e2e8f0">${o.p10}</b>${unit}</span>
        <span style="color:#94a3b8">P50 <b style="color:#38bdf8">${o.p50}</b>${unit}</span>
        <span style="color:#94a3b8">P90 <b style="color:#f59e0b">${o.p90}</b>${unit}</span>
      </div>`;
    const hist = (data, color) => {
      if (!data || !data.length) return "";
      const maxN = Math.max.apply(null, data.map((d) => d.n)) || 1;
      const W = 600, H = 90, padX = 6, padTop = 6, padBot = 16;
      const bw = (W - padX * 2) / data.length;
      const bars = data.map((d, i) => {
        const h = (d.n / maxN) * (H - padTop - padBot);
        const x = padX + i * bw;
        const mid = ((d.x0 + d.x1) / 2);
        return `<rect x="${x.toFixed(1)}" y="${(H - padBot - h).toFixed(1)}" width="${(bw - 1).toFixed(1)}" height="${h.toFixed(1)}" rx="1" fill="${color}" opacity="0.85"/>`
          + `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 4}" font-size="8" fill="#94a3b8" text-anchor="middle">${round2(mid)}</text>`;
      }).join("");
      return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="xMidYMid meet" style="display:block">${bars}</svg>`;
    };
    box.innerHTML = `
      <div style="padding:6px 0">
        ${row("单位成本", res.costPerKg, " 元/kg")}
        ${row("比能耗", res.energyIntensity, " kWh/kg")}
        ${row("投资回收期", res.paybackYears, " 年")}
        ${row("毛利率", res.marginRate, " %")}
        <div style="font-size:12px;color:#cbd5e1;margin:10px 0 2px">单位成本分布 (元/kg)</div>
        <div style="background:rgba(255,255,255,.03);border-radius:8px;padding:4px 6px">${hist(res.histCost, "#38bdf8")}</div>
        <div style="font-size:12px;color:#cbd5e1;margin:8px 0 2px">投资回收期分布 (年)</div>
        <div style="background:rgba(255,255,255,.03);border-radius:8px;padding:4px 6px">${hist(res.histPayback, "#f59e0b")}</div>
        <div class="note" style="margin-top:8px"><span class="ic">🎲</span>
        <div>蒙特卡洛 <b>${res.N}</b> 次采样（三角分布，系数 ±区间）。水质可行口径：达标 <b>${res.waterQuality.okPct}%</b> / 预警 <b>${res.waterQuality.warnPct}%</b> / 超限 <b>${res.waterQuality.failPct}%</b>。结果从单点升级为区间，供决策参考。</div></div>
      </div>`;
  }
  function round2(v) { return typeof v === "number" ? Math.round(v * 100) / 100 : v; }
  function renderParams(d) {
    const c = d.culture, f = d.feeding, hy = d.hydraulics, bf = d.biofilter,
      ox = d.oxygen, so = d.solids, en = d.energy, b = d.building;
    const host = document.getElementById("panel-params");
    host.className = "panel active glass";
    host.innerHTML = `
      <div style="padding:24px 26px 4px"><div class="note" style="margin-top:0">
        <span class="ic">🐟</span>
        <div><b>${d.species.name} (${d.species.latin})</b> · 目标 ${d._raw.annual/1000} 吨/年 · 设计水温 ${d.inputs.temp}℃ ·
        实际设计产能 <b>${c.actualYield} 吨/年</b></div></div></div>
      ${section("养殖池系统", "Culture", [
        metricCard("养殖池数量", c.tankCount, "个", `${c.cols} 列 × ${c.rows} 行`),
        metricCard("单池尺寸", `Ø${c.tankD}`, `×${c.tankH}m`, `有效 ${c.singleTankVol} m³`),
        metricCard("总养殖水体", c.totalTankVol, "m³", `有效容积合计`, "brand"),
        metricCard("放养密度", c.density, "kg/m³", "设计生物量密度"),
        metricCard("年养殖茬次", c.cycles, "茬", `单位体积年产 ${c.yieldPerM3Year} kg/m³`),
        metricCard("实际产能", c.actualYield, "吨/年", "满足目标且有余量", "accent"),
      ])}
      ${section("投喂与氮负荷", "Feed & N", [
        metricCard("饲料系数 FCR", f.fcr, "", "饲料/增重"),
        metricCard("年饲料量", (f.annualFeed/1000).toFixed(1), "吨", "全周期投喂总量"),
        metricCard("日均投喂", f.dailyFeedAvg, "kg/d", "全年平均"),
        metricCard("峰值日投喂", f.dailyFeedPeak, "kg/d", "生长旺季"),
        metricCard("日 TAN 产量", f.tanDaily, "kg/d", "总氨氮负荷", "brand"),
        metricCard("年 TAN 产量", f.tanAnnual, "kg/年", "生物滤池设计依据"),
      ])}
      ${section("水力学", "Hydraulics", [
        metricCard("系统总水量", hy.totalSysWater, "m³", "含滤池与管路"),
        metricCard("循环流量", hy.recircFlowH, "m³/h", `${hy.recircFlow} m³/天`, "brand"),
        metricCard("补水流量", hy.makeupFlowH, "m³/h", `${hy.makeupFlow} m³/天`),
        metricCard("回用率", hy.waterReuse, "%", "节水核心指标", "accent"),
        metricCard("水足迹(比水耗)", hy.specificWaterUse, "m³/kg", "取水/产量", "accent"),
        metricCard("日循环次数", hy.turns, "次", "系统换水强度"),
        metricCard("年取水量", hy.makeupVolYr, "m³/年", "新水消耗总量"),
        metricCard("年蒸发损失", hy.evapVolYr, "m³/年", `占取水 ${hy.makeupVolYr > 0 ? (hy.evapVolYr / hy.makeupVolYr * 100).toFixed(1) : "0"}%`, "brand"),
        metricCard("年排污量(bleed)", hy.bleedVolYr, "m³/年", "可排放废水"),
        metricCard("年污泥带水", hy.sludgeWaterVolYr, "m³/年", "脱水饼含水", "brand"),
        metricCard("年反冲洗/雾损", (hy.drumBackwashVolYr + hy.degasserMistVolYr), "m³/年", "不返还损耗"),
        metricCard("消耗性水足迹", hy.waterConsumption, "m³/kg", "蒸发+污泥+雾损", "accent"),
      ])}
      <div style="padding:0 26px 6px"><div class="note ${hy.waterCovered ? "" : "note-warn"}">
        <span class="ic">💧</span>
        <div>水足迹真水平衡：年取水 <b>${hy.makeupVolYr.toLocaleString()}</b> m³ = 蒸发 <b>${hy.evapVolYr.toLocaleString()}</b> + 排污 <b>${hy.bleedVolYr.toLocaleString()}</b> + 污泥带水 <b>${hy.sludgeWaterVolYr.toLocaleString()}</b> + 反冲洗/雾损 <b>${(hy.drumBackwashVolYr + hy.degasserMistVolYr).toLocaleString()}</b> m³。${hy.waterCovered ? "补水率覆盖全部损耗，池面水位稳定。" : "⚠️ 补水率不足以覆盖蒸发+污泥+雾损，池面将下降，需提高补水率。"}</div></div></div>
      ${section("环境足迹 (Footprint)", "Environment", [
        metricCard("电网碳因子", d.environment.carbonFactor, "kgCO₂e/kWh", d.environment.gridLabel, "brand"),
        metricCard("单位鱼碳足迹", d.environment.carbonPerKg, "kgCO₂e/kg", "电力碳排放强度", "accent"),
        metricCard("年碳排放", d.environment.annualCarbonT, "tCO₂e/年", "全厂电力排放"),
      ])}
      ${section("生物滤池 (MBBR)", "Biofilter", [
        metricCard("反应器容积", bf.reactorVol, "m³", `硝化负荷 ${bf.rate} kg TAN/m³·d`),
        metricCard("含填料总容积", bf.totalVol, "m³", `填充率 ${bf.mediaFill*100}%`, "brand"),
        metricCard("滤池单元", bf.units, "座", `单座 ${bf.unitVol} m³`),
        metricCard("类型", bf.type, "", "移动床生物膜"),
      ])}
      ${section("增氧与 CO₂ 脱除", "O₂ & CO₂", [
        metricCard("日均氧耗", ox.o2Daily, "kg/d", "按饲料估"),
        metricCard("峰值氧耗", ox.o2Peak, "kg/d", "生长旺季"),
        metricCard("供氧配置", ox.o2Supply, "kg/h", `${ox.type}`, "brand"),
        metricCard("CO₂ 产生", ox.co2Hour, "kg/h", "需脱除"),
        metricCard("脱除方式", ox.degasserType, "", "填料式脱气塔"),
      ])}
      ${section("固废处理", "Solids", [
        metricCard("微滤机台数", so.units, "台", `${so.drumType}`),
        metricCard("单台处理量", so.eachFlow, "m³/h", "转鼓微滤机"),
        metricCard("筛网孔径", so.screen, "µm", "去除悬浮固体"),
        metricCard("日悬浮固体", so.tssDaily, "kg/d", "需脱水处理"),
      ])}
      ${section("能耗估算", "Energy", [
        metricCard("总装机功率", en.totalPower, "kW", "各系统合计", "brand"),
        metricCard("比能耗", en.energyIntensity, "kWh/kg", "单位鱼电耗", "accent"),
        metricCard("年耗电量", en.annualEnergy, "MWh", "全系统"),
        metricCard("水泵功率", en.pumpPower, "kW", "循环泵"),
        metricCard("泵总扬程", en.pumpHead, "m", `达西阻力法 · 流速 ${en.pumpVelocity} m/s`, "brand"),
        metricCard("管内流速", en.pumpVelocity, "m/s", `Re ${en.pumpReynolds} · f ${en.pumpFriction}`, "brand"),
        metricCard("增氧功率", en.oxyPower, "kW", "制氧/液氧"),
        metricCard("控温功率", en.hvacPower, "kW", (en.hvacMode === "cool" ? "制冷主导" : "加热主导"), "accent"),
        metricCard("制热电耗", (en.hvacHeatingKwh/1000).toFixed(1), "MWh", "冬季双工况", "brand"),
        metricCard("制冷电耗", (en.hvacCoolingKwh/1000).toFixed(1), "MWh", "夏季双工况", "brand"),
        metricCard("污泥处置功率", en.solidsPower, "kW", "脱水+外运", "brand"),
        metricCard("污泥年耗电", (en.solidsAnnualKwh/1000).toFixed(1), "MWh", "处置电耗"),
        metricCard("地区平均气温", en.ambientTemp, "℃", `设定 ${d.inputs.temp}℃ · 温差 ${(d.inputs.temp - en.ambientTemp) >= 0 ? "+" : ""}${(d.inputs.temp - en.ambientTemp).toFixed(1)}`, "brand"),
        metricCard("温控热负荷", (en.thermalLoadW / 1000).toFixed(1), "kW", "围护+补水升温", "brand"),
      ])}
      ${renderHvacSeason(en, d.inputs.temp)}
      ${renderEnergySplit(en)}
      ${renderScaleCurve(d._raw.annual / 1000)}
      ${section("建筑规模", "Building", [
        metricCard("养殖区占地", b.tankFootprint, "m²", "含通道"),
        metricCard("设备区", b.equipArea, "m²", "滤池/泵房"),
        metricCard("车间总面积", b.buildingArea, "m²", "含辅助", "brand"),
        metricCard("车间体积", b.buildingVol, "m³", "层高约 6m"),
      ])}
      ${renderWQSection(d.waterQuality)}
      <div style="padding:0 26px 26px"><div class="note">
        <span class="ic">⚠️</span>
        <div><b>设计说明：</b>生物滤池硝化负荷已含水温折减与安全系数 ${d.inputs.sf}。需配置备用发电机、备用纯氧、在线监测（DO/pH/TAN/温度）与自动化控制，确保水质阈值 ${K.waterQuality.tanMax} mg/L TAN、DO>${K.waterQuality.doMin} mg/L。</div></div></div>`;
  }

  /* ---------------- 渲染：PFD / P&ID ---------------- */
  function renderPFD(d) { document.getElementById("pfdHost").innerHTML = RAS.pfd.render(d); }
  function renderPID(d) {
    const h = document.getElementById("pidHost");
    if (h) h.innerHTML = RAS.pid.render(d);
  }

  /* ---------------- 渲染：BOM / Econ ---------------- */
  function renderBOM(d) {
    const host = document.getElementById("panel-bom");
    host.className = "panel active glass";
    const c = d.culture, bf = d.biofilter, so = d.solids, ox = d.oxygen, hy = d.hydraulics;
    const rows = [
      ["圆形养殖池", c.tankCount + " 个", `Ø${c.tankD} m × ${c.tankH} m，有效 ${c.singleTankVol} m³`, "PP/玻璃钢/混凝土"],
      ["转鼓微滤机", so.units + " 台", `${so.screen} µm 筛网，单台 ${so.eachFlow} m³/h`, "不锈钢"],
      ["MBBR 生物滤池", bf.units + " 座", `总 ${bf.totalVol} m³，填料 ${bf.mediaFill*100}%`, "曝气+悬浮填料"],
      ["反硝化反应器", "1 座", `容积 ${d.waterQuality.denit.volume} m³，脱氮率 ${Math.round(d.waterQuality.denit.removal*100)}%（侧流脱氮）`, "缺氧+碳源投加"],
      ["增氧系统", "1 套", `供氧 ${ox.o2Supply} kg/h（${ox.type}）`, "氧气锥+LHO"],
      ["CO₂ 脱除塔", "1 座", `${ox.degasserType}`, "填料式"],
      ["循环水泵", "≥2 台", `${hy.recircFlowH} m³/h，一用一备`, "变频"],
      ["紫外消毒", "1 套", "30 mJ/cm²", "在线"],
      ["换热/控温", "1 套", `${d.inputs.temp}℃ 恒温 · ${d.energy.hvacMode === "cool" ? "制冷" : "加热"}主导（环境温度 ${d.energy.ambientTemp}℃）`, "热泵/冷水机组"],
      ["自控与监测", "1 套", "DO/pH/温度/TAN/流量 IoT", "PLC+SCADA"],
      ["污泥处理", "1 套", "浓缩+脱水", "固液分离"],
      ["备用系统", "1 套", "柴油发电机+备用纯氧", "安全保障"],
    ];
    host.innerHTML = `
      <div class="section-title" style="padding:24px 26px 0">设备清单 (BOM)</div>
      <div class="table-wrap" style="padding:14px 26px 26px"><table class="data">
        <thead><tr><th>设备 / 单元</th><th class="num">数量</th><th>规格参数</th><th>材质 / 备注</th></tr></thead>
        <tbody>${rows.map(r => `<tr><td><b>${r[0]}</b></td><td class="num">${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td></tr>`).join("")}</tbody>
      </table></div>`;
  }
  function renderEcon(d) {
    const host = document.getElementById("panel-econ");
    host.className = "panel active glass";
    const e = d.economics, ec = E.rmb;
    // CAPEX：各投资项向下展开一级（默认折叠，点击展开子项；子项金额合计 == 该项总额）
    const capRows = e.capexBreakdown.map((c) => {
      if (c.subtotal) {
        return `<tr class="cap-subtotal${c.indirect ? ' cap-indirect' : ''}"><td colspan="2">
          <span class="cap-name">${c.label}</span>
          <span class="cap-amt">${ec(c.total)}</span>
        </td></tr>`;
      }
      return `
      <tr class="cap-top${c.indirect ? ' cap-indirect' : ''}"><td colspan="2">
        <details class="cap-det">
          <summary>
            <span class="cap-name">${c.label}</span>
            ${c.indirect ? '<span class="cap-tag">间接费</span>' : `<span class="cap-qty">${c.qty} ${c.unit}</span>`}
            <span class="cap-amt">${ec(c.total)}</span>
          </summary>
          <table class="cap-subtable"><tbody>
            ${c.subs.map((s) => `<tr><td>└ ${s.label}</td><td class="num">${ec(s.amount)}</td></tr>`).join("")}
          </tbody></table>
        </details>
      </td></tr>`;
    }).join("");
    const opRows = [
      ["饲料", e.opexFeed], ["苗种", e.opexFinger], ["电费", e.opexElec],
      ["水费", e.opexWater], ["固废处置", e.opexSolids], ["人工 (" + e.laborCount + " 人)", e.opexLabor], ["维护", e.opexMaint],
    ];
    host.innerHTML = `
      <div class="section-title" style="padding:24px 26px 0;justify-content:space-between">投资估算 (CAPEX) · 各投资项可展开
        <button type="button" class="link-btn" id="capToggleAll">展开全部</button></div>
      <div class="table-wrap" style="padding:14px 26px 6px"><table class="data">
        <thead><tr><th>投资项（含子项分解）</th><th class="num">金额</th></tr></thead>
        <tbody>${capRows}</tbody>
        <tfoot><tr><td>合计 CAPEX</td><td class="num">${ec(e.capexTotal)}</td></tr></tfoot></table></div>
      <div class="note" style="padding:4px 26px 0"><span class="ic">📐</span>
      <div>总投资 = 直接费(设备+土建) + 间接费(EPCM 12% + 调试 4% + 不可预见 6% + 其他 3% = 直接费 25%，封顶上限) + 可选土地费。规模因子 <b>${e.scaleFactor}</b>：单位投资随年产量呈亚线性变化（六 tenths 法则），大规更省、小规更贵；各分项已按<b>固定/可变比例</b>拆分（规模因子仅作用于可变段）。选择地区后 CAPEX/电价/人工按<b>地区指数</b>调整。表中「直接费子项合计」「间接费子项合计」为各自分项小计（不含土地），二者合计即工程费；「合计 CAPEX」为计入土地后的总投资。</div></div>
      <div class="section-title" style="padding:8px 26px 0">运营成本估算 (OPEX / 年)</div>
      <div class="table-wrap" style="padding:14px 26px 6px"><table class="data">
        <thead><tr><th>运营成本项</th><th class="num">金额 / 年</th></tr></thead>
        <tbody>${opRows.map(r => `<tr><td>${r[0]}</td><td class="num">${ec(r[1])}</td></tr>`).join("")}</tbody>
        <tfoot><tr><td>合计 OPEX</td><td class="num">${ec(e.opexTotal)}</td></tr></tfoot></table></div>
      <div class="section-title" style="padding:8px 26px 0">设备维护费分项（按设备寿命）</div>
      <div class="table-wrap" style="padding:14px 26px 6px"><table class="data">
        <thead><tr><th>设备项</th><th class="num">CAPEX</th><th class="num">年维护费</th><th class="num">寿命</th><th class="num">重置准备/年</th></tr></thead>
        <tbody>${(e.maintBreakdown || []).map((m) => `<tr><td>${m.label}</td><td class="num">${ec(m.capex)}</td><td class="num">${ec(m.annual)}</td><td class="num">${m.life} 年</td><td class="num">${ec(m.reserve)}</td></tr>`).join("")}</tbody>
        <tfoot><tr><td>维护费合计</td><td class="num">—</td><td class="num">${ec(e.opexMaint)}</td><td class="num">—</td><td class="num">—</td></tr></tfoot></table></div>
      <div class="note" style="padding:4px 26px 0"><span class="ic">🔧</span>
      <div>各设备按自身年维护率与寿命分摊维护费与重置准备（重置准备 = CAPEX / 寿命，用于设备更换资金规划），比单一总率更贴近实际：高价易耗件（泵/增氧/固废）维护费更高、寿命更短；土建/池体寿命长、维护低。维护费合计即 OPEX 中的「维护」项。</div></div>
      <div class="metrics" style="padding:14px 26px 26px">
        ${metricCard("单位鱼生产成本", e.costPerKg, "元/kg", "仅运营成本", "brand")}
        ${metricCard("总投资 CAPEX", (e.capexTotal/10000).toFixed(1), "万元", "含土建与设备", "accent")}
        ${metricCard("年运营成本", (e.opexTotal/10000).toFixed(1), "万元", "全周期", "brand")}
        ${metricCard("规模因子", e.scaleFactor, "×", "单位投资因子", "accent")}
        ${metricCard("出塘尾数", e.harvestNum.toLocaleString(), "尾", "按商品规格")}
      </div>
      <div class="section-title" style="padding:8px 26px 0">盈利能力与投资回报</div>
      <div class="metrics" style="padding:14px 26px 26px">
        ${metricCard("年营业收入", (e.revenue/10000).toFixed(1), "万元", "售价 "+e.salePrice+" 元/kg", "brand")}
        ${metricCard("年毛利", (e.grossProfit/10000).toFixed(1), "万元", "营收−运营", e.grossProfit>=0?"accent":"")}
        ${metricCard("单位利润", e.profitPerKg, "元/kg", "毛利/产量")}
        ${metricCard("投资回收期", e.paybackYears!=null?e.paybackYears.toFixed(1):"—", "年", e.paybackYears!=null&&e.paybackYears>0?"简单回收期":"不可行", e.paybackYears!=null&&e.paybackYears<8?"accent":"")}
        ${metricCard("年化 ROI", e.roi!=null?e.roi:"—", "%", "毛利/CAPEX")}
        ${metricCard("毛利率", e.marginRate!=null?e.marginRate:"—", "%", "毛利/营收")}
      </div>
      <div class="section-title" style="padding:8px 26px 0">敏感度分析 (What-if · ±20%)</div>
      <div class="sn-wrap" style="padding:14px 26px 8px">
        <div class="sn-ctrl">
          <label>分析指标</label>
          <select id="snMetric" class="text-input" style="max-width:230px">
            <option value="costPerKg">单位成本 (元/kg)</option>
            <option value="energyIntensity">比能耗 (kWh/kg)</option>
            <option value="grossProfit">年毛利 (万元)</option>
          </select>
        </div>
        <div id="snChart"></div>
        <div class="note" style="margin-top:10px"><span class="ic">🎯</span>
        <div>龙卷风图：固定其他因素，将每个驱动参数在基线 <b>±20%</b>（补水率 ±50%）间扰动，观察所选指标的变化幅度。条带越宽，该参数对结果越敏感——绿色为改善方向、红色为恶化方向。</div></div>
      </div>
      <div class="section-title" style="padding:18px 26px 0">参数不确定性 · 蒙特卡洛区间</div>
      <div style="padding:10px 26px 0;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <button id="mcRun" class="btn-lux">运行蒙特卡洛（2000 次）</button>
        <span class="muted" style="font-size:12px">对 MBBR 硝化速率 / 热泵 COP / 补水率等模型系数做三角分布抽样，输出成本与回收期 P10–P90 区间</span>
      </div>
      <div id="mcResult" style="padding:6px 26px 8px"></div>
      <div class="section-title" style="padding:18px 26px 0">参数不确定性 · Sobol 主因子分析</div>
      <div style="padding:10px 26px 0;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <button id="sobolRun" class="btn-lux">运行 Sobol 主因子（N=1024）</button>
        <span class="muted" style="font-size:12px">Saltelli 方差分解：量化 8 个模型系数对各指标的一阶(S)与总阶(ST)贡献，ST−S 即交互效应，定位真正驱动结果方差的主导因子</span>
      </div>
      <div id="sobolResult" style="padding:6px 26px 8px"></div>
      <div style="padding:0 26px 26px"><div class="note"><span class="ic">📌</span>
      <div>经济参数为行业经验量级估算（人民币），实际受地区人工/地价/电价/苗种价格影响显著。饲料通常占 OPEX 的 70–80%。价格数据截至 <b>${K.economics.priceMeta.asOf}</b>（置信度：<b>${K.economics.priceMeta.confidence}</b>），建议项目级复核。</div></div></div>`;
    renderSensitivity(d);
    const snSel = document.getElementById("snMetric");
    if (snSel) snSel.addEventListener("change", () => renderSensitivity(d));
    const capToggle = document.getElementById("capToggleAll");
    if (capToggle) capToggle.addEventListener("click", () => {
      const dets = host.querySelectorAll(".cap-det");
      const open = capToggle.textContent.trim() === "展开全部";
      dets.forEach((d) => { d.open = open; });
      capToggle.textContent = open ? "折叠全部" : "展开全部";
    });
    const mcBtn = document.getElementById("mcRun");
    if (mcBtn) mcBtn.addEventListener("click", () => {
      const box = document.getElementById("mcResult");
      mcBtn.disabled = true; mcBtn.textContent = "计算中…";
      setTimeout(() => {
        try {
          const res = E.monteCarlo(readInputs());
          renderMonteCarlo(res);
        } catch (err) {
          if (box) box.innerHTML = `<div class="note-warn"><span class="ic">⚠️</span><div>蒙特卡洛计算失败：${String(err && err.message || err)}</div></div>`;
        } finally {
          mcBtn.disabled = false; mcBtn.textContent = "运行蒙特卡洛（2000 次）";
        }
      }, 20);
    });
    const sobolBtn = document.getElementById("sobolRun");
    if (sobolBtn) sobolBtn.addEventListener("click", () => {
      const box = document.getElementById("sobolResult");
      sobolBtn.disabled = true; sobolBtn.textContent = "计算中…（约 1–2 秒）";
      setTimeout(() => {
        try {
          const res = E.sobol(readInputs(), { N: 1024 });
          renderSobol(res);
        } catch (err) {
          if (box) box.innerHTML = `<div class="note-warn"><span class="ic">⚠️</span><div>Sobol 计算失败：${String(err && err.message || err)}</div></div>`;
        } finally {
          sobolBtn.disabled = false; sobolBtn.textContent = "运行 Sobol 主因子（N=1024）";
        }
      }, 20);
    });
  }

  /* ---------------- 渲染：Sobol 主因子分析 ---------------- */
  function renderSobol(res) {
    const host = document.getElementById("sobolResult");
    if (!host) return;
    if (!res || !res.metrics || !Object.keys(res.metrics).length) {
      host.innerHTML = `<div class="note"><span class="ic">ℹ️</span><div>知识库未配置不确定性参数（K.uncertainty.params 为空），无法进行 Sobol 分解。</div></div>`;
      return;
    }
    const metricLabel = { costPerKg: "单位成本", energyIntensity: "比能耗", capexTotal: "总投资", grossProfit: "年毛利", paybackYears: "回收期", marginRate: "毛利率" };
    const METRIC_ORDER = ["costPerKg", "energyIntensity", "capexTotal", "grossProfit", "paybackYears", "marginRate"];
    let html = `<div class="note" style="margin:6px 0 12px"><span class="ic">🧮</span><div>基于 Saltelli (2010) 方差分解，N=${res.N}（seed=${res.seed} 可复现）。<b>ST</b> 为总阶指数（含交互），ST−S 为该因子的交互贡献；各指标 ΣST≈1 表示分解闭合。仅扰动模型系数，用户自定义输入未参与抽样。</div></div>`;
    METRIC_ORDER.forEach((mk) => {
      const m = res.metrics[mk];
      if (!m) return;
      html += `<div class="sobol-card">`;
      html += `<div class="sobol-head"><span class="sobol-title">${metricLabel[mk] || mk}</span><span class="sobol-unit">${m.unit}</span>`;
      if (m.valid && m.mean != null) html += `<span class="sobol-mean">均值 ${m.mean}</span>`;
      html += `</div>`;
      if (!m.valid) {
        html += `<div class="sobol-note">⚠️ ${m.note || "该指标计算无效"}</div>`;
      } else if (m.dominant == null) {
        html += `<div class="sobol-note">ℹ️ ${m.note || "输出方差≈0，结果对 8 个系数均不敏感"}</div>`;
      } else {
        const top2 = (m.top2 || []).join(" / ");
        html += `<div class="sobol-dominant">主导因子：<b>${m.dominant}</b>${top2 ? ` <span class="muted">（次：${top2}）</span>` : ""}</div>`;
        html += `<div class="sobol-bars">`;
        m.indices.forEach((it) => {
          const w = Math.max(2, Math.round(it.ST * 100));
          const interact = it.interaction > 0.001 ? `<span class="sobol-inter" title="交互贡献 ST−S">交互 ${it.interaction}</span>` : "";
          html += `<div class="sobol-bar-row">
            <span class="sobol-bar-label">${it.label}</span>
            <span class="sobol-bar-track"><span class="sobol-bar-fill" style="width:${w}%"></span></span>
            <span class="sobol-bar-val">S=${it.S} · ST=${it.ST} ${interact}</span>
          </div>`;
        });
        html += `</div>`;
        html += `<div class="sobol-foot muted">ΣST=${m.stSum}（闭合性检查，越接近 1 越可信）</div>`;
      }
      html += `</div>`;
    });
    host.innerHTML = html;
  }

  /* ---------------- 渲染：设计计算书（计算标准 + 方法论 + 核心逻辑保密） ---------------- */
  function renderDoc() {
    const host = document.getElementById("panel-doc");
    if (!host) return;
    host.className = "panel glass";
    const wq = K.waterQuality, eq = K.equipment, ec = K.economics;
    const sp = K.species[document.getElementById("species").value];
    const wqRows = [
      ["总氨氮 TAN", "≤ " + wq.tanMax, "mg/L"],
      ["亚硝态氮 NO₂", "≤ " + wq.no2Max, "mg/L"],
      ["硝态氮 NO₃-N", "≤ " + wq.no3SoftCap + "（以 N 计，软上限）", "mg/L"],
      ["溶氧 DO", "≥ " + wq.doMin, "mg/L"],
      ["二氧化碳 CO₂", "≤ " + wq.co2Max, "mg/L"],
      ["悬浮固体 TSS", "≤ " + wq.ssMax, "mg/L"],
      ["pH", wq.phLow + "–" + wq.phHigh, "—"],
      ["碱度(以CaCO₃计)", K.process.alkMin + "–" + K.process.alkTarget, "mg/L（硝化耗碱度 " + K.process.alkPerN + " g/gN）"],
      ["非离子氨 NH₃", "≤ " + K.process.nh3Acute, "mg/L(N) 急性毒性"],
    ].map(r => `<tr><td>${r[0]}</td><td class="num">${r[1]} ${r[2]}</td></tr>`).join("");
    const eqRows = [
      ["生物滤池", eq.biofilter.type + "，硝化负荷 " + eq.biofilter.rate + " kg TAN/m³·d，填料填充率 " + (eq.biofilter.mediaFill*100) + "%"],
      ["微滤机", eq.drumFilter.type + "，" + eq.drumFilter.screen + " µm 筛网，TSS 去除率 " + (eq.drumFilter.tssRemoval*100) + "%"],
      ["增氧系统", eq.oxygen.type + "，氧耗 " + eq.oxygen.o2PerFeed + " kg O₂/kg 饲料，传质效率 " + (eq.oxygen.transferEff*100) + "%"],
      ["CO₂ 脱除", eq.degasser.type + "，CO₂ 去除率 " + (eq.degasser.co2Removal*100) + "%"],
      ["反硝化", "侧流反硝化反应器，脱氮率 " + (K.process.denitRemoval*100) + "%，容积负荷 " + K.process.denitRate + " kg NO₃-N/m³·d"],
      ["循环水泵", "扬程按达西–魏斯巴赫阻力法计算（沿程+局部+静扬程，见能耗卡），效率 " + (eq.pump.eff*100) + "%"],
      ["控温", "热泵 COP≈" + eq.heat.cop],
    ].map(r => `<tr><td><b>${r[0]}</b></td><td>${r[1]}</td></tr>`).join("");
    const capRows = Object.keys(ec.capexPerM3).filter(k => k !== "salePrice")
      .map(k => `<tr><td>${capexLabel(k)}</td><td class="num">${ec.capexPerM3[k]}</td><td>${k === "building" ? "元/m²" : "元/m³"}</td></tr>`).join("");
    const opRows = [
      ["饲料(" + (sp ? sp.name : "基准") + ")", sp && sp.feedPrice ? sp.feedPrice : ec.opex.feedPrice, "元/kg"],
      ["苗种", ec.opex.fingerlingPrice, "元/尾"],
      ["生产补水", ec.opex.waterPrice, "元/m³"],
      ["人工", ec.opex.laborPerYear + " × " + ec.opex.laborBase + " 起（随产量 √规模）", "元/人·年 × 人"],
      ["维护", (ec.opex.maintenanceRate*100) + "% CAPEX", "年"],
      ["电价", ec.opex.elecPrice, "元/kWh"],
      ["固废处置", ec.opex.solidsDisposalPrice, "元/kg 干固"],
    ].map(r => `<tr><td>${r[0]}</td><td class="num">${r[1]}</td><td>${r[2]}</td></tr>`).join("");
    const steps = [
      ["养殖池系统", "按产能目标与放养密度、养殖茬次反推所需养殖水体，确定池数、池径与有效容积。"],
      ["投喂与氮负荷", "由产量与饲料系数(FCR)估算年投喂量，推导总氨氮(TAN)等氮素日产量，作为生物滤池设计依据。"],
      ["水力学", "由养殖水体与日循环次数确定循环流量与补水流量，得出回用率与单位鱼比水耗。水足迹真水平衡：年取水 = 蒸发 + 排污(bleed) + 污泥脱水带水 + 微滤机反冲洗/脱气塔雾损，单位鱼水足迹 = 取水/产量（m³/kg），并校验补水率是否覆盖全部损耗（否则水位下降）。消耗性水足迹另计蒸发+污泥+雾损（不返还环境）。环境足迹按年电耗 × 地区电网排放因子给出电力碳足迹（kgCO₂e/kg鱼）。"],
      ["生物滤池 (MBBR)", "按 TAN 负荷与温度修正后的硝化速率(θ 系数)确定反应器容积与悬浮填料量，并叠加安全系数。分段考虑 AOB 亚硝化(TAN→NO₂)与 NOB 硝化(NO₂→NO₃)两步速率，NO₂ 稳态更低。"],
      ["生物脱氮（反硝化）", "MBBR 完成硝化后，NO₃ 经侧流反硝化反应器在缺氧 + 碳源条件下由异养菌还原为 N₂ 逸出；按 NO₃-N 负荷与反硝化容积负荷(denitRate)确定反应器容积，脱氮率 denitRemoval 计入稳态 NO₃ 质量平衡。"],
      ["增氧与脱碳", "按饲料氧耗 + 硝化耗氧配置供氧能力（覆盖鱼代谢与硝化峰值，含安全系数），按 CO₂ 产生量配置脱气塔；稳态 CO₂ 由<strong>脱气塔(主动) + 养殖池敞口水面天然挥发(被动空气吹脱) + 补水稀释</strong>三者共同决定（双膜理论，等效去除流量=co2Kla×养殖池体积），并非仅依赖脱气塔。"],
      ["固废处理", "按循环流量配置微滤机台数与单台处理量，并配置污泥浓缩/脱水单元。"],
      ["能耗估算", "按水泵、增氧、脱气、控温、辅助、固废处置等系统功率需求估算总装机与单位鱼比能耗。水泵扬程用<strong>达西–魏斯巴赫</strong>阻力法（沿程摩阻 Swamee-Jain + 局部损失 + 静扬程）计算。控温采用<strong>bin method 季节性双工况</strong>：取地区全年月均温序列，逐月判定制热/制冷并用对应 COP 折算，累加得年控温电耗，比单点估算更准；无地区时退化为单点。控温负荷随<strong>地区全年平均气温</strong>变化：净热需求 = 围护传热(围护表面积[屋面+外墙]×U值×温差) + 补水升温(补水流量×比热×温差) + 水面蒸发潜热(池面蒸发×汽化潜热) − 内部得热(泵损+照明/代谢)；若环境低于设定温则加热、高于则制冷，分别按热泵 COP 与冷水机组 COP 折算电耗。固废处置电耗按干固体量 × 单位处置能耗计入。能耗分项在「能耗」面板以饼图展示泵/氧/脱气/控温/杂项的功率占比，便于定位主要耗能单元与节电重点。"],
      ["建筑规模", "按养殖区与设备区占地估算车间总面积与体积（含通道与辅助用房）。"],
      ["经济与校核", "汇总 CAPEX/OPEX（含水费）得出单位成本、盈利与回收期，并以稳态质量平衡校核水质可行性。"],
    ].map((s, i) => `<li><span class="doc-step-n">${i+1}</span><div><b>${s[0]}</b>　${s[1]}</div></li>`).join("");
    host.innerHTML = `
      <div class="doc-hero">
        <h2 class="doc-title">设计计算书 · 计算标准与方法</h2>
        <p class="doc-lead">本计算书说明 AquaRAS 工艺设计引擎所采用的<strong>计算标准体系</strong>、<strong>工程方法论</strong>与结果边界，帮助您理解设计依据。核心计算逻辑依法保密，详见文末声明。</p>
      </div>

      <div class="doc-section">
        <h3>一、计算依据与标准体系</h3>
        <p class="doc-p">引擎以循环水养殖（RAS）工程的质量守恒原理为内核，基准参数综合自以下权威文献与行业规范（数值为设计基准，计算时结合安全系数与用户自定义微调）：</p>
        <div class="doc-refs">${K.references.map(r => `<span>📚 ${r}</span>`).join("")}</div>
      </div>

      <div class="doc-grid">
        <div class="doc-card">
          <h4>① 水质控制目标</h4>
          <table class="data doc-table"><tbody>${wqRows}</tbody></table>
          <p class="doc-cap">集约化淡水 RAS 通用设计阈值，作为水质稳态校核的判定限值。</p>
        </div>
        <div class="doc-card">
          <h4>② 单元设备设计基准</h4>
          <table class="data doc-table"><tbody>${eqRows}</tbody></table>
          <p class="doc-cap">各单元设备的选型以行业经验负荷率与去除率为设计基准。海水/半咸水品种按 salinity 自动补偿：溶氧饱和度折减影响氧需求，耐蚀材质（316L/HDPE）对池体/水泵/自控加价。</p>
        </div>
      </div>
      <div class="doc-grid">
        <div class="doc-card">
          <h4>③ 投资估算基准 (CAPEX)</h4>
          <table class="data doc-table"><thead><tr><th>投资项</th><th class="num">单价</th><th>单位</th></tr></thead><tbody>${capRows}</tbody></table>
          <p class="doc-cap">直接费按养殖水体（土建按面积）估算，详见「经济估算」中各投资项的一级分解。总投资另含 <b>间接费</b>（EPCM 12% + 调试 4% + 不可预见 6% + 其他 3% = 直接费 25%，封顶上限）与可选 <b>土地费</b>；并应用 <b>规模经济（分段曲线）</b>：单位投资随年产量呈亚线性变化，但按产能档位采用不同规模指数（&lt;30t 更陡、&gt;1000t 趋缓，下限 0.55×、上限 2.5×），比单一 0.6 次幂常数更贴合工程实际（参考规模 ${K.economics.capexModel.refAnnualTons} t/年）。本表为参考规模下的基准单价。</p>
          <p class="doc-cap"><b>规模因子解读：</b>规模因子 = 当前规模单位产能投资 ÷ 参考规模（${K.economics.capexModel.refAnnualTons} t/年）单位投资的倍数。&gt;1 表示小规不经济（单位投资更高），&lt;1 表示大规有规模经济（单位投资更低），=1 即为参考规模。</p>
          <p class="doc-cap">公式：<code>规模因子 = (参考规模 ÷ 年产量) ^ (1 − 指数)</code>，按产量档位取指数——&lt;30t 用 0.55（最陡）、30–300t 用 0.72、300–1000t 用 0.82、&gt;1000t 用 0.88（趋缓）。结果夹在 [0.55, 2.5]：单位投资最多比基准低 45% 或高 2.5×，防极端规模失真。</p>
          <table class="data doc-table"><thead><tr><th>年产量</th><th class="num">规模因子</th><th>单位投资为基准</th></tr></thead><tbody>
            <tr><td>&le;30 t</td><td class="num">2.50×</td><td>250%（封顶）</td></tr>
            <tr><td>100 t</td><td class="num">1.36×</td><td>136%</td></tr>
            <tr><td>300 t</td><td class="num">1.00×</td><td>100%（基准）</td></tr>
            <tr><td>600 t</td><td class="num">0.88×</td><td>88%</td></tr>
            <tr><td>1000 t</td><td class="num">0.81×</td><td>81%</td></tr>
            <tr><td>10000 t</td><td class="num">0.66×</td><td>66%</td></tr>
          </tbody></table>
          <p class="doc-cap">落地方式：每项投资按可变比例 split 拆分，<code>有效规模因子 = (1 − split) + split × 规模因子</code>，仅可变段（池体/设备）跟随规模变化，固定段（EPCM、调试、部分土建）不随规模变，故总投资不会等比下降。</p>
        </div>
      <div class="doc-card">
          <h4>④ 运营成本基准 (OPEX)</h4>
          <table class="data doc-table"><thead><tr><th>成本项</th><th class="num">单价</th><th>单位</th></tr></thead><tbody>${opRows}</tbody></table>
          <p class="doc-cap">水费按生产补水量 × 水价估算；饲料通常占 OPEX 的 70–80%。维护费改按各设备自身年维护率与寿命分摊并计提重置准备，比单一总率更贴近实际（高价易耗件费率高、寿命短）。</p>
        </div>
      </div>

      <div class="doc-section">
        <h3>二、计算流程（工程方法论）</h3>
        <p class="doc-p">引擎按下列顺序逐级推导，每一步的输出作为下一步的输入，形成从产能需求到工艺参数、设备尺寸、能耗与经济的完整链路：</p>
        <ol class="doc-steps">${steps}</ol>
      </div>

      <div class="doc-section">
        <h3>三、水质可行性校核方法</h3>
        <p class="doc-p">在设备尺寸确定后，引擎以<strong>稳态质量平衡</strong>复核系统实际浓度：将各污染物的产生速率，对照生物滤池（两段硝化：AOB 亚硝化 + NOB 硝化）、反硝化反应器（NO₃→N₂）、脱气塔（CO₂）、微滤机（TSS）的一阶去除能力，并叠加新鲜补水的稀释与<strong>水源背景浓度</strong>(TAN/NO₂/NO₃)，推算 TAN / NO₂ / NO₃ / CO₂ / TSS / DO 的系统浓度，与上方限值比对，给出「达标 / 预警 / 超限」判定。其中硝酸盐稳态 = (硝化生成×(1−脱氮率) + 水源背景) / 补水流量：反硝化单元可显著削减 NO₃ 负荷，剩余随补水交换控制；溶氧(DO)按供氧能力(覆盖鱼代谢 + 硝化耗氧)余量判定池内可达浓度，供氧不足时按比例下降并计缺口。</p>
      </div>

      <div class="doc-section">
        <h3>四、参数不确定性与蒙特卡洛区间</h3>
        <p class="doc-p">工程模型系数（MBBR 硝化速率、热泵 COP、补水率、反硝化负荷、水面蒸发率、硝化温度系数等）本身存在取值不确定度。引擎内置 <b>uncertainty 参数集</b>（每项含 low / exp / high 三角分布），在「经济估算」面板点击「运行蒙特卡洛」后，对 N=2000 次抽样重算整条链路，输出 <b>单位成本 / 比能耗 / 总投资 / 年毛利 / 回收期 / 毛利率</b> 的 <b>P10–P90 区间</b>与直方图，并统计水质「达标/预警/超限」的通过率。结果从单点升级为区间，帮助识别方案风险敞口——P50 为最可能值，区间越宽代表对系数不确定越敏感。采样仅扰动<b>模型系数与可校准输入</b>，用户自定义售价 / 密度等不纳入抽样。</p>
          <p class="doc-cap"><b>P10 / P50 / P90 读法：</b>P50 为中位数（一半模拟比它好、一半比它差，代表典型结果）；P10 为第 10 百分位（90% 的模拟比它差），对「越低越好」的指标（成本、比能耗、回收期）是乐观下限，对「越高越好」的指标（毛利、年利润）是悲观下限；P90 为第 90 百分位（90% 的模拟比它好），方向相反。[P10, P90] 覆盖中间 80% 的情形（80% 置信带）。</p>
          <p class="doc-cap"><b>采样对象：</b>仅扰动 uncertainty 参数集中的 7 个模型系数（三角分布 low / exp / high），不抽样用户自定义的售价、密度、电价、土地费等市场输入——模型系数的不确定由本分析量化，市场波动由用户自行调参评估。</p>
          <table class="data doc-table"><thead><tr><th>指标</th><th class="num">P10</th><th class="num">P50</th><th class="num">P90</th><th>方向</th></tr></thead><tbody>
            <tr><td>单位成本 (元/kg)</td><td class="num">33.2</td><td class="num">34.1</td><td class="num">35.3</td><td>越低越好</td></tr>
            <tr><td>比能耗 (kWh/kg)</td><td class="num">6.69</td><td class="num">7.24</td><td class="num">7.94</td><td>越低越好</td></tr>
            <tr><td>年毛利 (万元)</td><td class="num">97.4</td><td class="num">108.9</td><td class="num">117.7</td><td>越高越好</td></tr>
            <tr><td>回收期 (年)</td><td class="num">9.06</td><td class="num">9.79</td><td class="num">10.94</td><td>越低越好</td></tr>
            <tr><td>毛利率 (%)</td><td class="num">21.6</td><td class="num">24.2</td><td class="num">26.2</td><td>越高越好</td></tr>
          </tbody></table>
          <p class="doc-cap"><b>示例（加州鲈 100 t/年、售价 45 元/kg、N=2000 一次运行）：</b>成本区间仅 33.2–35.3（跨度约 6%），因成本主驱动是饲料/电价/售价，均不在本抽样内；总投资在该运行下近似恒定——CAPEX 由规模与设备定容决定，被扰动的运行系数不改变定容逻辑。</p>
          <p class="doc-cap"><b>水质可行率：</b>每次重算统计水质「达标/预警/超限」占比，即工艺失效概率。本例 ok 0% / warn 69% / fail 31%——即便经济指标尚可，仍有约 1/3 场景水质超限，提示当前安全系数下工艺风险偏高，应加大余量或调整设计。直方图展示单位成本与回收期的分布形态（单峰/拖尾/偏态）。</p>
          <p class="doc-cap"><b>与敏感度（龙卷风图）互补：</b>龙卷风图单参数逐一 ±20% 扰动，回答「哪些参数最关键」；蒙特卡洛多参数同时随机，回答「综合不确定下结果区间多宽、工艺失效概率多大」。配合：先找关键源，再看联合分布。</p>
      </div>

      <div class="doc-confidential">
        <div class="doc-lock">🔒 核心计算逻辑保密</div>
        <p>本系统采用 <strong>AquaRAS 专有工艺计算引擎</strong>，其<strong>核心算法、设备选型系数、经济模型参数与实现代码均为商业机密，不在本文档中披露</strong>。本文档仅说明计算体系、所引用的行业/文献标准与工程方法论，用于帮助用户理解设计依据与结果边界。</p>
        <p class="doc-cap"><strong>免责声明：本引擎计算数据仅供参考。</strong>本系统输出为工程量级估算，<strong>实际工程须由具备资质的设计单位结合场地条件、设备选型与水文/气候数据，并依据现行国家与行业规范深化设计与施工图</strong>。AquaRAS 不对直接采用估算结果造成的工程风险承担责任。</p>
        <p class="doc-cap"><strong>关于作者：</strong>水产专业硕士研究生，多年工厂化循环水（RAS）从业经验。</p>
      </div>

    `;

  }
  function capexLabel(k) {
    return ({ tanks: "养殖池系统", biofilter: "生物滤池", solids: "固废处理", oxygen: "增氧系统",
      pumps: "水泵与管路", controls: "自控与监测", building: "车间土建", hvac: "控温系统" })[k] || k;
  }

  /* ---------------- 3D ---------------- */
  function ensureModel() {
    const el = document.getElementById("model3d");
    if (!modelInited) { RAS.model3d.init(el); modelInited = true; }
    if (currentDesign) RAS.model3d.build(currentDesign, root.getAttribute("data-theme"));
  }
  function initModelControls() {
    const rb = document.getElementById("rotateBtn");
    rb.addEventListener("click", () => { const on = rb.classList.toggle("on"); RAS.model3d.setAutoRotate(on); });
    document.getElementById("rebuildBtn").addEventListener("click", () => {
      if (currentDesign) RAS.model3d.build(currentDesign, root.getAttribute("data-theme"));
    });
    // 管线图层显隐
    const bind = (id, layer) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("change", () => RAS.model3d.setLayer(layer, el.checked));
    };
    bind("lyWater", "water"); bind("lyGas", "gas"); bind("lySludge", "sludge"); bind("lyElec", "elec");
  }

  /* ============== 智能寻优 ============== */
  function initOptimizer() {
    document.getElementById("optRun").addEventListener("click", () => {
      const num = (id) => { const v = parseFloat(document.getElementById(id).value); return isNaN(v) ? null : v; };
      const constraints = {};
      if (num("optBudget") != null) constraints.maxBudget = num("optBudget");
      if (num("optArea") != null) constraints.maxArea = num("optArea");
      if (num("optEnergy") != null) constraints.maxEnergy = num("optEnergy");
      const objective = document.getElementById("optObjective").value;
      const sp = K.species[document.getElementById("species").value];
      const res = E.optimize({
        speciesKey: sp.key, annualTons: parseFloat(document.getElementById("annualTons").value) || 100,
        designTemp: document.getElementById("designTemp").value ? parseFloat(document.getElementById("designTemp").value) : null,
        constraints, objective,
      });
      renderOptResult(res);
    });
  }
  function renderOptResult(res) {
    const host = document.getElementById("optResult");
    if (!res.ok) {
      host.innerHTML = `<div class="note" style="margin:14px 26px 26px"><span class="ic">🚫</span>
        <div><b>未找到可行方案：</b>${res.reason}。基线方案 CAPEX ${E.rmb(res.baseline.economics.capexTotal)}、面积 ${res.baseline.building.buildingArea} m²、比能耗 ${res.baseline.energy.energyIntensity} kWh/kg，可作为放宽参考。</div></div>`;
      return;
    }
    const b = res.best, v = res.vars, base = res.baseline;
    const dCapex = b.economics.capexTotal - base.economics.capexTotal;
    const dEnergy = (b.energy.energyIntensity - base.energy.energyIntensity).toFixed(2);
    const dArea = b.building.buildingArea - base.building.buildingArea;
    const varTxt = res.objective === "maxCapacity"
      ? `最优年产量 <b>${b._raw.annual/1000} 吨</b>`
      : `放养密度 <b>${v.density}</b> kg/m³ · 日循环 <b>${v.turns}</b> · 池径 <b>Ø${v.tankD}m</b> · 补水 <b>${(v.makeup*100).toFixed(1)}%</b> · FCR <b>${v.fcr}</b> · 安全系数 <b>${v.sf}</b>` + (v.designTemp != null ? ` · 设定温 <b>${v.designTemp}℃</b> · 地区 <b>${v.region || "—"}</b>(<b>${v.ambientTemp}℃</b>)` : "");
    const topRows = res.top.map((t, i) => `<tr>
      <td>${i+1}</td><td>${t.yield} t</td><td>${E.rmb(t.capEx)}</td><td>${t.costPerKg} 元/kg</td>
      <td>${t.energy} kWh/kg</td><td>${Math.round(t.area)} m²</td><td>${t.vars.fcr}</td><td>${t.vars.sf}</td><td>${t.payback!=null?t.payback.toFixed(1):"—"} 年</td></tr>`).join("");
    host.innerHTML = `
      <div class="section-title" style="padding:18px 26px 0">最优方案（共搜索 ${res.count} 个可行解）</div>
      <div class="metrics" style="padding:14px 26px">
        ${metricCard("决策变量", "—", "", varTxt)}
        ${metricCard("总投资 CAPEX", (b.economics.capexTotal/10000).toFixed(1), "万元", `Δ ${dCapex>=0?"+":""}${(dCapex/10000).toFixed(1)} 万元`, "brand")}
        ${metricCard("比能耗", b.energy.energyIntensity, "kWh/kg", `Δ ${dEnergy} kWh/kg`, "accent")}
        ${metricCard("车间面积", b.building.buildingArea, "m²", `Δ ${dArea>=0?"+":""}${Math.round(dArea)} m²`, "brand")}
        ${metricCard("产能", b.culture.actualYield, "吨/年", "满足目标", "accent")}
        ${metricCard("单位成本", b.economics.costPerKg, "元/kg", "运营成本")}
        ${metricCard("回收期", b.economics.paybackYears!=null?b.economics.paybackYears.toFixed(1):"—", "年", "含盈利估算")}
      </div>
      ${renderPareto(res)}
      <div class="section-title" style="padding:8px 26px 0">候选方案 Top 6</div>
      <div class="table-wrap" style="padding:14px 26px 26px"><table class="data">
        <thead><tr><th>#</th><th>产能</th><th>CAPEX</th><th>单位成本</th><th>比能耗</th><th>面积</th><th>FCR</th><th>安全系数</th><th>回收期</th></tr></thead>
        <tbody>${topRows}</tbody></table></div>
      <div style="padding:0 26px 26px"><div class="note"><span class="ic">💡</span>
      <div>寻优基于网格搜索：在品种经验区间内遍历决策变量（含密度/循环/池径/补水/<b>FCR/安全系数</b>，能耗目标另纳入<b>设定水温与地区气候</b>），按约束过滤后取目标最优。下方 <b>成本-能耗 Pareto 前沿</b> 给出所有「无法在不恶化另一指标时优化」的折中解，供决策权衡。生产目标固定时，<b>最低成本</b>与<b>最低能耗</b>通常对应不同的密度/循环/温度/地区组合。</div></div></div>`;
  }

  /* 成本-能耗 Pareto 前沿可视化（可行解云 + 非支配前沿 + 候选列表） */
  function renderPareto(res) {
    if (!res.pareto || !res.pareto.length) return "";
    const cloud = (res.cloud && res.cloud.length) ? res.cloud : res.pareto;
    const P = res.pareto.map((p) => ({
      x: p.cost / 10000, y: p.energy, cost: p.cost, energy: p.energy,
      costPerKg: p.costPerKg, area: p.area, fcr: p.vars.fcr, sf: p.vars.sf, payback: p.payback,
    }));
    const allX = cloud.map((c) => c.cost / 10000).concat(P.map((p) => p.x));
    const allY = cloud.map((c) => c.energy).concat(P.map((p) => p.y));
    let xMin = Math.min.apply(null, allX), xMax = Math.max.apply(null, allX);
    let yMin = Math.min.apply(null, allY), yMax = Math.max.apply(null, allY);
    if (xMax - xMin < 1e-6) { xMin -= 1; xMax += 1; }
    if (yMax - yMin < 1e-6) { yMin -= 0.1; yMax += 0.1; }
    const dx = xMax - xMin, dy = yMax - yMin;
    const padL = 64, padR = 18, padT = 18, padB = 48, W = 680, H = 300;
    const sx = (v) => padL + (v - xMin) / dx * (W - padL - padR);
    const sy = (v) => H - padB - (v - yMin) / dy * (H - padT - padB);
    const cloudDots = cloud.map((c) => `<circle cx="${sx(c.cost / 10000).toFixed(1)}" cy="${sy(c.energy).toFixed(1)}" r="2" class="pareto-cloud"/>`).join("");
    const pts = P.map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
    const dots = P.map((p, i) => `<circle cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="4.5" class="pareto-dot"/><text x="${sx(p.x).toFixed(1)}" y="${(sy(p.y) - 9).toFixed(1)}" class="pareto-tl">${i + 1}</text>`).join("");
    const base = res.baseline;
    const bx = sx(base.economics.capexTotal / 10000), by = sy(base.energy.energyIntensity);
    const degenerate = res.paretoCount < 2;
    const noteTxt = degenerate
      ? `当前参数空间内成本与能耗基本同向变化，非支配前沿退化为单点——说明该规模下「低成本配置即低能耗配置」，无显著权衡空间。散点为全部可行解分布。`
      : `前沿上每一点都是「无法在不恶化另一指标时进一步优化」的折中解：越靠左上成本越低、越靠右下能耗越低。散点为全部可行解（淡），<span class="pareto-base-dot">●</span> 蓝点=当前基线方案。选定前沿上的某一点即确定一组（密度/循环/补水/FCR/安全系数）组合。`;
    const rows = P.map((p, i) => `<tr><td>${i + 1}</td><td>${E.rmb(p.cost)}</td><td>${p.energy.toFixed(2)}</td>
      <td>${p.costPerKg}</td><td>${Math.round(p.area)}</td><td>${p.fcr}</td><td>${p.sf}</td>
      <td>${p.payback != null ? p.payback.toFixed(1) : "—"} 年</td></tr>`).join("");
    return `
      <div class="section-title" style="padding:18px 26px 0">成本-能耗 Pareto 前沿（${res.paretoCount} 个非支配解 / 共 ${res.count} 可行解）</div>
      <div class="pareto-wrap" style="padding:14px 26px">
        <svg viewBox="0 0 ${W} ${H}" class="pareto-svg" preserveAspectRatio="xMidYMid meet">
          <line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" class="pareto-axis"/>
          <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${H - padB}" class="pareto-axis"/>
          ${cloudDots}
          <polyline points="${pts}" class="pareto-line"/>
          ${dots}
          <circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="5" class="pareto-base"/>
          <text x="${(padL - 8)}" y="${(padT + 4)}" class="pareto-al" text-anchor="end">${yMax.toFixed(2)}</text>
          <text x="${(padL - 8)}" y="${(H - padB)}" class="pareto-al" text-anchor="end">${yMin.toFixed(2)}</text>
          <text x="${padL}" y="${(H - padB + 14)}" class="pareto-al">${xMin.toFixed(0)}</text>
          <text x="${(W - padR)}" y="${(H - padB + 14)}" class="pareto-al" text-anchor="end">${xMax.toFixed(0)}</text>
          <text x="${(W / 2)}" y="${(H - 10)}" class="pareto-axis-label" text-anchor="middle">CAPEX (万元)</text>
          <text x="16" y="${(H / 2)}" class="pareto-axis-label" text-anchor="middle" transform="rotate(-90 16 ${H / 2})">比能耗 (kWh/kg)</text>
        </svg>
        <div class="note" style="margin-top:8px"><span class="ic">📈</span>
        <div>${noteTxt}</div></div>
      </div>
      <div class="section-title" style="padding:8px 26px 0">Pareto 前沿候选</div>
      <div class="table-wrap" style="padding:14px 26px 26px"><table class="data">
        <thead><tr><th>#</th><th>CAPEX</th><th>比能耗</th><th>单位成本</th><th>面积</th><th>FCR</th><th>安全系数</th><th>回收期</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
  }

  /* ============== 方案库（云端 Laravel 同步 + 本地回退） ============== */
  const cloud = window.RAS.cloud;
  function compactSummary(d) { return cloud.summarize(d); } // 与云端摘要同口径
  function loadSchemes() { try { return JSON.parse(localStorage.getItem(LIB_KEY)) || []; } catch (e) { return []; } }
  function saveSchemes(arr) { localStorage.setItem(LIB_KEY, JSON.stringify(arr)); }
  function isCloud() { return cloud.getMode() === "cloud" && !!cloud.getBase(); }

  let libItems = []; // 当前展示的方案（本地或云端归一化后的 scheme 列表）

  function setStatus(txt, kind) {
    const el = document.getElementById("libStatus");
    if (!el) return;
    el.textContent = txt; el.className = "lib-status " + (kind || "muted");
  }

  /* —— 抽象存储层：本地 / 云端自动切换，云端异常自动回退本地 —— */
  async function fetchSchemes() {
    if (!isCloud()) return { items: loadSchemes(), mode: "local", error: null };
    try {
      const store = new cloud.CloudStore(cloud.getBase());
      const items = await store.list();
      return { items, mode: "cloud", error: null };
    } catch (e) {
      return { items: loadSchemes(), mode: "local-fallback", error: e.message };
    }
  }
  async function persistScheme(scheme) {
    if (!isCloud()) {
      const arr = loadSchemes();
      const i = arr.findIndex((x) => x.id === scheme.id);
      if (i >= 0) arr[i] = scheme; else arr.push(scheme);
      saveSchemes(arr); return scheme;
    }
    const store = new cloud.CloudStore(cloud.getBase());
    // 后端无 update 端点：覆盖即 删旧 + 建新
    if (scheme._source === "cloud" && scheme._cloudId) {
      await store.remove(scheme._cloudId);
    }
    const id = await store.create(cloud.toPayload(scheme));
    scheme._source = "cloud"; scheme._cloudId = id; scheme.id = "c" + id;
    return scheme;
  }
  async function deleteScheme(scheme) {
    if (isCloud() && scheme._source === "cloud" && scheme._cloudId) {
      const store = new cloud.CloudStore(cloud.getBase());
      await store.remove(scheme._cloudId);
    } else {
      saveSchemes(loadSchemes().filter((x) => x.id !== scheme.id));
    }
  }

  async function refreshLib() {
    const { items, mode, error } = await fetchSchemes();
    libItems = items;
    renderLibUI();
    if (mode === "cloud") setStatus("已连接云端 · 共 " + items.length + " 个方案", "ok");
    else if (mode === "local-fallback") setStatus("云端不可用，已回退本地：" + (error || ""), "warn");
    else setStatus("本地模式 · 共 " + items.length + " 个方案", "muted");
  }

  function renderLibUI() {
    const host = document.getElementById("libList");
    const items = libItems;
    if (!items.length) {
      host.innerHTML = `<div class="note" style="margin:8px 0"><span class="ic">📭</span><div>暂无方案。输入名称后点「保存当前方案」。云端模式需先填写 API 地址并选「云端」。</div></div>`;
      document.getElementById("libCompare").innerHTML = "";
      return;
    }
    const rows = items.map((s) => {
      const inB = compareBasket.includes(s.id);
      const tag = s._source === "cloud" ? `<span class="src-tag cloud">云端</span>` : `<span class="src-tag local">本地</span>`;
      const sm = s.summary || {};
      return `<tr>
        <td><b>${s.name}</b> ${tag}<br><span style="font-size:11.5px;color:var(--text-faint)">${(sm.species) || ""} · ${new Date(s.createdAt).toLocaleString("zh-CN")}</span></td>
        <td class="num">${sm.actualYield != null ? sm.actualYield + " t" : "-"}</td>
        <td class="num">${sm.capexTotal != null ? E.rmb(sm.capexTotal) : "-"}</td>
        <td class="num">${sm.energyIntensity != null ? sm.energyIntensity + " kWh/kg" : "-"}</td>
        <td>
          <button class="toggle-btn magnetic" data-act="load" data-id="${s.id}">载入</button>
          <button class="toggle-btn magnetic ${inB ? "on" : ""}" data-act="cmp" data-id="${s.id}">${inB ? "✓ 对比" : "对比"}</button>
          <button class="toggle-btn magnetic" data-act="del" data-id="${s.id}">删除</button>
        </td></tr>`;
    }).join("");
    host.innerHTML = `<div class="table-wrap"><table class="data">
      <thead><tr><th>方案</th><th class="num">产能</th><th class="num">CAPEX</th><th class="num">比能耗</th><th class="num">回收期</th><th>操作(选 2 个对比)</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
    rebindMagnetic(host);
    host.querySelectorAll("button[data-act]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id, act = btn.dataset.act;
        const s = libItems.find((x) => x.id === id);
        if (!s) return;
        if (act === "load") {
          if (s.result) { currentDesign = s.result; renderAll(currentDesign); }
          else { applyInputs(s.inputs); compute(); }
          document.querySelector('#tabs .tab[data-tab="params"]').click();
        } else if (act === "del") {
          await deleteScheme(s);
          compareBasket = compareBasket.filter((x) => x !== id);
          await refreshLib();
        } else if (act === "cmp") {
          if (compareBasket.includes(id)) compareBasket = compareBasket.filter((x) => x !== id);
          else { compareBasket.push(id); if (compareBasket.length > 2) compareBasket.shift(); }
          renderLibUI(); renderCompare();
        }
      });
    });
  }
  function renderCompare() {
    const host = document.getElementById("libCompare");
    if (compareBasket.length < 2) { host.innerHTML = ""; return; }
    const a = libItems.find((s) => s.id === compareBasket[0]);
    const b = libItems.find((s) => s.id === compareBasket[1]);
    if (!a || !b || !a.summary || !b.summary) { host.innerHTML = ""; return; }
    const metrics = [
      ["品种", "species", (v) => v], ["产能(t)", "actualYield", (v) => v],
      ["养殖池数", "tankCount", (v) => v], ["总水体(m³)", "totalTankVol", (v) => Math.round(v)],
      ["循环量(m³/h)", "recircFlowH", (v) => v], ["回用率(%)", "waterReuse", (v) => v],
      ["生物滤池(m³)", "biofilterVol", (v) => v], ["供氧(kg/h)", "o2Supply", (v) => v],
      ["总功率(kW)", "totalPower", (v) => v], ["比能耗(kWh/kg)", "energyIntensity", (v) => v],
      ["车间面积(m²)", "buildingArea", (v) => Math.round(v)],
      ["CAPEX", "capexTotal", (v) => E.rmb(v)], ["OPEX/年", "opexTotal", (v) => E.rmb(v)],
      ["单位成本(元/kg)", "costPerKg", (v) => v],
      ["回收期(年)", "paybackYears", (v) => v != null ? v.toFixed(1) : "—"],
      ["毛利率(%)", "marginRate", (v) => v != null ? v : "—"],
    ];
    const rows = metrics.map((m) => {
      const va = a.summary[m[1]], vb = b.summary[m[1]];
      const delta = (typeof va === "number" && typeof vb === "number") ? (vb - va) : "—";
      const dTxt = (typeof delta === "number") ? (delta > 0 ? "+" : "") + (Math.round(delta * 100) / 100) : "—";
      return `<tr><td>${m[0]}</td><td class="num">${m[2](va)}</td><td class="num">${m[2](vb)}</td><td class="num">${dTxt}</td></tr>`;
    }).join("");
    host.innerHTML = `<div class="section-title" style="padding:8px 0 0">方案对比：${a.name} vs ${b.name}</div>
      <div class="table-wrap" style="padding:12px 0 0"><table class="data">
        <thead><tr><th>指标</th><th class="num">${a.name}</th><th class="num">${b.name}</th><th class="num">Δ(B−A)</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
  }
  function applyInputs(inputs) {
    document.getElementById("species").value = inputs.speciesKey;
    document.getElementById("species").dispatchEvent(new Event("change"));
    document.getElementById("annualTons").value = inputs.annualTons;
    document.getElementById("density").value = inputs.targetDensity || "";
    document.getElementById("cycles").value = inputs.cycles || "";
    document.getElementById("fcr").value = (inputs.fcr != null) ? inputs.fcr : "";
    document.getElementById("turns").value = inputs.recircTurns;
    document.getElementById("makeup").value = (inputs.makeupRate * 100).toFixed(1);
    document.getElementById("designTemp").value = inputs.designTemp || "";
    document.getElementById("ambient").value = (inputs.ambientTemp != null) ? inputs.ambientTemp : 15;
    const regEl = document.getElementById("region");
    if (regEl) regEl.value = (inputs.region != null) ? inputs.region : "";
    document.getElementById("safety").value = inputs.safety;
    document.getElementById("salePrice").value = (inputs.salePrice != null) ? inputs.salePrice : "";
    document.getElementById("feedPrice").value = (inputs.feedPrice != null) ? inputs.feedPrice : "";
    document.getElementById("fingerlingPrice").value = (inputs.fingerlingPrice != null) ? inputs.fingerlingPrice : "";
    document.getElementById("elecPrice").value = (inputs.elecPrice != null) ? inputs.elecPrice : "";
    document.getElementById("waterPrice").value = (inputs.waterPrice != null) ? inputs.waterPrice : "";
    document.getElementById("laborPerYear").value = (inputs.laborPerYear != null) ? inputs.laborPerYear : "";
  }
  function mergeSchemes(local, incoming) {
    const map = {};
    local.forEach((s) => { if (s && s.id) map[s.id] = s; });
    (incoming || []).forEach((s) => { if (s && s.id) map[s.id] = s; });
    return Object.values(map);
  }

  function initLibrary() {
    // 数据源：本地 / 云端
    const setModeUI = () => {
      const m = cloud.getMode();
      document.getElementById("srcLocal").classList.toggle("on", m === "local");
      document.getElementById("srcCloud").classList.toggle("on", m === "cloud");
      document.getElementById("apiUrl").disabled = (m !== "cloud");
    };
    const applyMode = async (m) => {
      cloud.setMode(m); setModeUI(); await refreshLib();
    };
    document.getElementById("srcLocal").addEventListener("click", () => applyMode("local"));
    document.getElementById("srcCloud").addEventListener("click", () => {
      if (!cloud.getBase()) document.getElementById("apiUrl").focus();
      applyMode("cloud");
    });
    const apiInput = document.getElementById("apiUrl");
    apiInput.value = cloud.getBase();
    apiInput.addEventListener("change", (e) => {
      cloud.setBase(e.target.value);
      if (cloud.getMode() === "cloud") refreshLib();
    });
    document.getElementById("libRefresh").addEventListener("click", () => refreshLib());

    // 保存当前方案（云端创建 / 失败回退本地）
    document.getElementById("libSave").addEventListener("click", async () => {
      const name = (document.getElementById("libName").value || "").trim() || `方案 ${new Date().toLocaleDateString("zh-CN")} ${new Date().toLocaleTimeString("zh-CN")}`;
      if (!currentDesign) compute();
      const scheme = {
        id: (cloud.getMode() === "cloud" ? "c" : "s") + Date.now(),
        _source: "local",
        name, createdAt: Date.now(),
        inputs: readInputs(),
        result: currentDesign,
        summary: compactSummary(currentDesign),
      };
      try {
        await persistScheme(scheme);
        document.getElementById("libName").value = "";
        setStatus("已保存「" + name + "」", "ok");
      } catch (e) {
        const arr = loadSchemes(); arr.push(scheme); saveSchemes(arr);
        setStatus("云端保存失败，已存本地：" + e.message, "warn");
      }
      await refreshLib();
    });

    // 导入/导出（本地备份，跨端可移植 JSON）
    document.getElementById("libExport").addEventListener("click", () => {
      const data = JSON.stringify(loadSchemes(), null, 2);
      const blob = new Blob([data], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = "aquaras-schemes.json"; a.click();
    });
    document.getElementById("libImportBtn").addEventListener("click", () => document.getElementById("libImport").click());
    document.getElementById("libImport").addEventListener("change", (e) => {
      const file = e.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const arr = JSON.parse(reader.result);
          saveSchemes(mergeSchemes(loadSchemes(), Array.isArray(arr) ? arr : [arr]));
          refreshLib();
        } catch (err) { alert("JSON 解析失败"); }
      };
      reader.readAsText(file);
    });

    setModeUI();
    refreshLib();
  }

  /* ---------------- 报告导出 ---------------- */
  function initExport() {
    document.getElementById("exportBtn").addEventListener("click", () => {
      if (!currentDesign) { alert("请先生成设计方案"); return; }
      const d = currentDesign;
      const pfd = document.getElementById("pfdHost").innerHTML;
      const pid = document.getElementById("pidHost") ? document.getElementById("pidHost").innerHTML : "";
      const w = window.open("", "_blank");
      w.document.write(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
        <title>AquaRAS 工艺设计报告</title>
        <style>body{font-family:system-ui,'Microsoft YaHei',sans-serif;color:#0f172a;max-width:900px;margin:30px auto;padding:0 20px;line-height:1.6}
        h1{font-size:24px;border-bottom:3px solid #0ea5e9;padding-bottom:8px}h2{font-size:18px;margin-top:28px;color:#0ea5e9}
        .kv{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eee}.kv b{color:#475569}
        table{width:100%;border-collapse:collapse;margin-top:10px}th,td{border:1px solid #ddd;padding:8px 10px;text-align:left;font-size:14px}th{background:#f1f5f9}
        </style></head><body>
        <h1>AquaRAS 循环水养殖工艺设计报告</h1>
        <p>品种：${d.species.name} (${d.species.latin}) ｜ 目标产量：${d._raw.annual/1000} 吨/年 ｜ 设计水温：${d.inputs.temp}℃ ｜ 生成时间：${new Date().toLocaleString("zh-CN")}</p>
        <h2>核心参数</h2>
        ${keyval([
          ["养殖池数量", d.culture.tankCount + " 个 (" + d.culture.cols + "×" + d.culture.rows + ")"],
          ["总养殖水体", d.culture.totalTankVol + " m³"],
          ["循环流量", d.hydraulics.recircFlowH + " m³/h"],
          ["回用率", d.hydraulics.waterReuse + "%"],
          ["生物滤池容积", d.biofilter.totalVol + " m³ (" + d.biofilter.units + " 座)"],
          ["供氧能力", d.oxygen.o2Supply + " kg/h"],
          ["总装机功率", d.energy.totalPower + " kW"],
          ["比能耗", d.energy.energyIntensity + " kWh/kg"],
          ["车间面积", d.building.buildingArea + " m²"],
          ["总投资 CAPEX", E.rmb(d.economics.capexTotal)],
          ["年运营成本", E.rmb(d.economics.opexTotal)],
          ["单位鱼成本", d.economics.costPerKg + " 元/kg"],
        ])}
        <h2>水质可行性校核</h2>${keyval(d.waterQuality.checks.map((c) => [c.name + " (" + c.status + ")", c.value + " " + c.unit + " / 限值 " + c.limit]))}
        <h2>盈利与投资回报</h2>${keyval([["售价(元/kg)", d.economics.salePrice], ["年营业收入", E.rmb(d.economics.revenue)], ["年毛利", E.rmb(d.economics.grossProfit)], ["投资回收期", (d.economics.paybackYears != null ? d.economics.paybackYears.toFixed(1) + " 年" : "不可行")], ["年化 ROI", (d.economics.roi != null ? d.economics.roi + " %" : "—")]])}
        <h2>设计计算书（方法论）</h2>
        <p style="font-size:13px;color:#475569">计算体系：质量守恒原理 + RAS 工程经验基准。水质限值 TAN≤${K.waterQuality.tanMax}、NO₂≤${K.waterQuality.no2Max}、DO≥${K.waterQuality.doMin}、CO₂≤${K.waterQuality.co2Max}、TSS≤${K.waterQuality.ssMax} mg/L（pH ${K.waterQuality.phLow}–${K.waterQuality.phHigh}）。生物滤池硝化负荷 ${K.equipment.biofilter.rate} kg TAN/m³·d，微滤机 TSS 去除率 ${(K.equipment.drumFilter.tssRemoval*100)}%，脱气塔 CO₂ 去除率 ${(K.equipment.degasser.co2Removal*100)}%。投资按养殖水体估算（土建按面积），运营含水费。</p>
        <p style="font-size:12.5px;color:#94a3b8;border-left:3px solid #0ea5e9;padding-left:10px">🔒 核心算法、设备选型系数、经济模型参数与实现代码为 AquaRAS 商业机密，不在本文档披露。本报告为工程量级估算，实际工程须由具备资质单位依据现行规范深化设计。</p>
        <h2>工艺流程图 (PFD)</h2><div style="border:1px solid #eee;border-radius:12px;padding:10px">${pfd}</div>
        <h2>管道仪表图 (P&ID)</h2><div style="border:1px solid #eee;border-radius:12px;padding:10px">${pid}</div>
        <h2>参考文献</h2><ul>${K.references.map(r=>`<li style="font-size:13px;color:#475569">${r}</li>`).join("")}</ul>
        <p style="margin-top:30px;color:#94a3b8;font-size:12px">本报告由 AquaRAS 自动生成，结果为工程估算，实际工程需结合场地与规范深化。</p>
        </body></html>`);
      w.document.close();
      setTimeout(() => w.print(), 400);
    });
  }
  function keyval(arr) { return arr.map((r) => `<div class="kv"><b>${r[0]}</b><span>${r[1]}</span></div>`).join(""); }

  /* ---------------- 初始化 ---------------- */
  function init() {
    const sv = document.getElementById("sysVersion");
    if (sv && K && K.meta) sv.textContent = K.meta.version;   // 首页版本号跟随系统版本（knowledge.meta.version）
    initTheme(); initSpecies(); initRegionChips(); initTabs(); initMagnetic();
    initModelControls(); initExport(); initOptimizer(); initLibrary(); initLinking();
    renderDoc();
    document.querySelectorAll("[data-goto]").forEach((b) => {
      b.addEventListener("click", () => {
        const tab = document.querySelector(`#tabs .tab[data-tab="${b.dataset.goto}"]`);
        if (tab) tab.click();
      });
    });
    document.getElementById("designForm").addEventListener("submit", (e) => {
      e.preventDefault(); compute();
      document.querySelector('#tabs .tab[data-tab="params"]').click();
    });
    compute();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
