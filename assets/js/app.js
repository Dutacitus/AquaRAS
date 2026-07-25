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
    if (name === "suppliers") { ensureSuppliers(); }
    if (name === "knowledge") { ensureKnowledge(); }
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
      dischargeLevel: (() => { const el = document.getElementById("dischargeLevel"); return el ? parseInt(el.value, 10) : 2; })(),
      tailwaterTech: (() => { const el = document.getElementById("tailwaterTech"); return el ? el.value : "none"; })(),
      pvKWp: document.getElementById("pvKWp").value.trim() ? num("pvKWp") : 0,
      pvFraction: document.getElementById("pvFraction").value.trim() ? num("pvFraction") : 0,
      batteryKWh: document.getElementById("batteryKWh").value.trim() ? num("batteryKWh") : 0,
      // v1.18.0 消毒/水质精制单元开关：UV 默认开，泡沫分离/臭氧默认关
      uv: document.getElementById("uv") ? document.getElementById("uv").checked : true,
      foamFrac: document.getElementById("foamFrac") ? document.getElementById("foamFrac").checked : false,
      ozone: document.getElementById("ozone") ? document.getElementById("ozone").checked : false,
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
      ${wq.bioGrowth && wq.bioGrowth.available ? `<div class="note" style="padding:6px 26px 0"><span class="ic">🐟</span>
      <div><b>鱼生长生物能学耦合（O12）</b>：热生长模型给出 SGR 上限 <b>${wq.bioGrowth.sgrTemp}%/d</b>（温度响应 ${wq.bioGrowth.tempResp}，最适 ${wq.bioGrowth.tempOpt}℃），最小养成 <b>${wq.bioGrowth.daysGrowMin}</b> 天/茬 → 生物最大 <b>${wq.bioGrowth.cyclesMax}</b> 茬/年、生物最大年产量 <b>${(wq.bioGrowth.annualMaxKg/1000).toFixed(1)}</b> t。设定 <b>${wq.bioGrowth.cyclesAssumed}</b> 茬/目标 <b>${(wq.bioGrowth.annualTargetKg/1000).toFixed(1)}</b> t → <b style="color:${wq.bioGrowth.status==='ok'?'#38bdf8':wq.bioGrowth.status==='warn'?'#f59e0b':'#f87171'}">${wq.bioGrowth.status==='ok'?'生物可行':'临界/不可行'}</b>。这是"设计水温↔产量吞吐"的生物约束，与 HVAC 能耗存在权衡。</div></div>` : ""}
      <div style="padding:0 26px 26px"><div class="note">
        <span class="ic">🔬</span>
        <div>稳态质量平衡校核：基于两段硝化（AOB/NOB）+ 反硝化 + 脱气塔 + 微滤机一阶去除，并叠加补水稀释与水源背景浓度，推算系统浓度，供设计可行性判断。溶氧按供氧能力（覆盖鱼代谢 + 硝化耗氧，余量 ${wq.o2Margin}%）闭环判定池内可达 <b>${wq.o2Achieved}</b> mg/L${wq.o2Deficit > 0.1 ? `（缺口 ${wq.o2Deficit} mg/L，供氧不足）` : ""}；数值为工程估算，运行需在线监测 DO/pH/TAN/CO₂ 并预留余量。</div></div></div>`;
  }
  /* 尾水排放合规区块（v1.13.8，对照 DB44/2462-2024 五项限值 + 受纳水域等级选择） */
  function renderTailwater(d) {
    const tw = (d.waterQuality && d.waterQuality.tailwater) || d.compliance;
    if (!tw || !tw.available) return "";
    const tt = d.tailwaterTreatment || { key: "none", name: "无（直排）" };
    const lab = { ok: "达标", fail: "超限" };
    const cards = tw.items.map((it) => `
      <div class="wq-item wq-${it.status}">
        <div class="wq-top"><span class="wq-name">${it.name}</span>
          <span class="wq-pill wq-${it.status}">${lab[it.status]}</span></div>
        <div class="wq-val">${it.value}<small>${it.unit}</small></div>
        <div class="wq-lim">限值 ${it.limitStr} ${it.unit}</div>
      </div>`).join("");
    const lvl = tw.level;
    const selL = (v) => (v === lvl ? " selected" : "");
    const techKey = tt.key || "none";
    const techOpts = Object.entries(K.tailwaterTreatment || {}).map(([k, t]) =>
      `<option value="${k}"${k === techKey ? " selected" : ""}>${t.name}</option>`).join("");
    const head = tw.allPass ? "五项全部达标" : "存在不达标项，尾水不得直接排放";
    const tnRaw = tt.cTnRaw, tnPol = tt.cTnPol, tnDrop = (tt.removal && Math.round(tt.removal.tn * 100)) || 0;
    const treatNote = techKey === "none"
      ? `<div class="muted" style="font-size:12px;padding:4px 26px 14px">未设末端处理：排放口浓度 = 系统循环水浓度（TN ${tnRaw} mg/L）。选上方工艺可对排放口做二次削减，多数可使 TN 降至 DB44 限值内。</div>`
      : `<div class="note" style="padding:8px 26px 14px"><span class="ic">♻️</span><div>尾水处理单元 <b>${tt.name}</b>：总氮 ${tnRaw} → <b>${tnPol}</b> mg/L（去除 ${tnDrop}%）；总磷 ${tt.cTpRaw} → ${tt.cTpPol}、COD ${tt.cCodRaw} → ${tt.cCodPol}、SS ${tt.cTssRaw} → ${tt.cTssPol} mg/L。单元投资 <b>${Math.round(tt.capex).toLocaleString("zh-CN")} 元</b>、年运行 <b>${Math.round(tt.opexYr).toLocaleString("zh-CN")} 元</b>、占地约 <b>${tt.footprint} m²</b>（处理流量 ${tt.treatedM3d} m³/d）。</div></div>`;
    const concl = tw.allPass
      ? (techKey === "none" ? "当前设计排放口浓度满足标准，可依法排放。" : `经 <b>${tt.name}</b> 处理后排放口浓度满足标准，可依法排放。`)
      : (techKey === "none" ? "⚠️ 部分指标超出标准，需增加尾水处理（如强化脱氮除磷、增设尾水净化塘/湿地）或重新认定受纳水域等级。" : `⚠️ 经 <b>${tt.name}</b> 处理后仍有指标超限，建议升级工艺（如多级生物净化组合）或重新认定受纳水域等级。`);
    return `
      <div class="section-title">尾水排放合规 (DB44/2462-2024)
        <span class="badge wq-${tw.status}">${head}</span></div>
      <div style="padding:0 26px 6px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <label style="font-size:13px;color:#cbd5e1">受纳水域</label>
        <select id="dischargeLevel" class="text-input" style="max-width:280px">
          <option value="2"${selL(2)}>二级（一般水域）</option>
          <option value="1"${selL(1)}>一级（重点保护水域：饮用水源/自然保护区等）</option>
        </select>
        <span class="muted" style="font-size:12px">${tw.waterType === "seawater" ? "海水" : "淡水"} · ${tw.standardName}</span>
      </div>
      <div style="padding:0 26px 8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <label style="font-size:13px;color:#cbd5e1">末端尾水处理</label>
        <select id="tailwaterTech" class="text-input" style="max-width:300px">${techOpts}</select>
      </div>
      <div class="wq-grid">${cards}</div>
      ${treatNote}
      <div class="note" style="padding:8px 26px 20px"><span class="ic">🏞️</span>
      <div>${tw.waterType === "seawater" ? "海水" : "淡水"}养殖尾水按 <b>${tw.level === 1 ? "一级" : "二级"}</b> 限值判定：pH ${tw.limit.phLow}–${tw.limit.phHigh}、悬浮物 ≤${tw.limit.ss}、COD(Mn) ≤${tw.limit.cod}、总氮 ≤${tw.limit.tn}、总磷 ≤${tw.limit.tp} mg/L。${concl}本判定基于稳态质量平衡推算的排放口浓度（与系统循环水同浓度，末端处理后按处理效率二次削减），供合规性预判；正式排放须按标准方法采样监测。</div></div>`;
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
      { label: "UV 消毒", v: en.energySplit.uv, c: "#22d3ee" },
      { label: "泡沫分离", v: en.energySplit.skimmer, c: "#f472b6" },
      { label: "臭氧", v: en.energySplit.ozone, c: "#fb923c" },
    ].filter((x) => x.v > 0);
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
  // 规模经济曲线（P2-4，v1.18.2 边界平滑）：本地复算分段幂律（数据源 knowledge.capexModel），标注当前规模点
  function sfFor(t) {
    const cm = K.economics.capexModel;
    const curve = cm.scaleCurve && cm.scaleCurve.length ? cm.scaleCurve : null;
    const w = cm.scaleSmoothWidth != null ? cm.scaleSmoothWidth : 0;
    let exp = cm.scaleExponent != null ? cm.scaleExponent : 0.72;
    if (curve) {
      let idx = 0;
      for (let i = 0; i < curve.length; i++) { if (t <= curve[i].upto) { idx = i; break; } idx = i; }
      exp = curve[idx].exp;
      if (w > 0) {
        for (let i = 0; i < curve.length - 1; i++) {
          const b = curve[i].upto;
          if (t >= b - w && t <= b + w) {
            const tt = (t - (b - w)) / (2 * w);
            exp = curve[i].exp + Math.min(1, Math.max(0, tt)) * (curve[i + 1].exp - curve[i].exp);
            break;
          }
        }
      }
    }
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
    const row = (label, o, unit) => {
      if (!o || typeof o.p50 !== "number") return "";
      const epi = o.epi && typeof o.epi.p50 === "number";
      return `
      <div style="padding:4px 0;font-size:12.5px;border-bottom:1px solid rgba(255,255,255,.06)">
        <div style="display:grid;grid-template-columns:1.1fr 1fr 1fr 1fr;gap:6px">
          <span style="color:#cbd5e1">${label}</span>
          <span style="color:#94a3b8">P10 <b style="color:#e2e8f0">${o.p10}</b>${unit}</span>
          <span style="color:#94a3b8">P50 <b style="color:#38bdf8">${o.p50}</b>${unit}</span>
          <span style="color:#94a3b8">P90 <b style="color:#f59e0b">${o.p90}</b>${unit}</span>
        </div>
        ${epi ? `<div style="display:grid;grid-template-columns:1.1fr 3fr;gap:6px;margin-top:2px">
          <span style="color:#64748b;font-size:11px">仅模型系数</span>
          <span style="color:#64748b;font-size:11px">P50 ${o.epi.p50}${unit} · 区间 ${o.epi.p10}–${o.epi.p90}</span>
        </div>` : ""}
      </div>`;
    };
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
        <div>蒙特卡洛 <b>${res.N}</b> 次采样（三角分布）。<b>全口径</b>=模型系数+经营假设；<b>仅模型系数</b>(epistemic) 口径见各指标次级行（浅灰）。水质可行(全口径)：达标 <b>${res.waterQuality.okPct}%</b> / 预警 <b>${res.waterQuality.warnPct}%</b> / 超限 <b>${res.waterQuality.failPct}%</b>${res.waterQualityEpistemic ? `；仅模型系数口径达标 <b>${res.waterQualityEpistemic.okPct}%</b>` : ""}。分层后可知区间宽度多少来自"模型本身不确定"、多少来自"你的经营假设波动"。</div></div>
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
        metricCard("年反冲洗/雾损", Math.round((hy.drumBackwashVolYr + hy.degasserMistVolYr) * 10) / 10, "m³/年", "不返还损耗"),
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
      ${renderTailwater(d)}
      <div style="padding:0 26px 26px"><div class="note">
        <span class="ic">⚠️</span>
        <div><b>设计说明：</b>生物滤池硝化负荷已含水温折减与安全系数 ${d.inputs.sf}。需配置备用发电机、备用纯氧、在线监测（DO/pH/TAN/温度）与自动化控制，确保水质阈值 ${K.waterQuality.tanMax} mg/L TAN、DO>${K.waterQuality.doMin} mg/L。</div></div></div>`;
    const twSel = document.getElementById("dischargeLevel");
    if (twSel) twSel.addEventListener("change", () => compute());
    const twTechSel = document.getElementById("tailwaterTech");
    if (twTechSel) twTechSel.addEventListener("change", () => compute());
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
      ["增氧系统", "1 套", `供氧 ${ox.o2Supply} kg/h（${ox.type}）`, "氧气锥+LHO"],
      ["CO₂ 脱除塔", "1 座", `${ox.degasserType}`, "填料式"],
      ["循环水泵", "≥2 台", `${hy.recircFlowH} m³/h，一用一备`, "变频"],
      ["换热/控温", "1 套", `${d.inputs.temp}℃ 恒温 · ${d.energy.hvacMode === "cool" ? "制冷" : "加热"}主导（环境温度 ${d.energy.ambientTemp}℃）`, "热泵/冷水机组"],
      ["自控与监测", "1 套", "DO/pH/温度/TAN/流量 IoT", "PLC+SCADA"],
      ["污泥处理", "1 套", "浓缩+脱水", "固液分离"],
      ["备用系统", "1 套", "柴油发电机+备用纯氧", "安全保障"],
    ];
    // —— 选配设备（仅在对应开关启用时显示）——
    if (d.waterQuality.denit.removal > 0) {
      rows.splice(3, 0, ["反硝化反应器", "1 座", `容积 ${d.waterQuality.denit.volume} m³，脱氮率 ${Math.round(d.waterQuality.denit.removal*100)}%（侧流脱氮）`, "缺氧+碳源投加"]);
    }
    if (d.inputs.uv !== false) {
      rows.splice(rows.findIndex(r => r[0] === "污泥处理"), 0, ["紫外消毒", "1 套", "30 mJ/cm²", "在线"]);
    }
    if (d.inputs.foamFrac) {
      rows.push(["泡沫分离(蛋白分离器)", "1 套", `处理流量 ~${Math.round(hy.recircFlowH * 0.25)} m³/h，去除溶解有机碳(DOC) ~45%`, "不锈钢/FRP"]);
    }
    if (d.inputs.ozone) {
      rows.push(["臭氧氧化系统", "1 套", `投加量 0.02 g O₃/m³，接触消毒+NO₂氧化，含尾气破坏`, "不锈钢/耐臭氧"]);
    }
    host.innerHTML = `
      <div class="section-title" style="padding:24px 26px 0">设备清单 (BOM)</div>
      <div class="table-wrap" style="padding:14px 26px 26px"><table class="data">
        <thead><tr><th>设备 / 单元</th><th class="num">数量</th><th>规格参数</th><th>材质 / 备注</th></tr></thead>
        <tbody>${rows.map(r => `<tr><td><b>${r[0]}</b></td><td class="num">${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td></tr>`).join("")}</tbody>
      </table></div>`;
  }
  /* 光伏投资明细面板（v1.16.0 接入）：展示 PV 模块输出，未启用时给引导提示 */
  function renderPVPanel(d) {
    const pv = d.economics && d.economics.pv;
    if (!pv || !pv.enabled) {
      return `<div class="note" style="padding:10px 26px 24px"><span class="ic">☀️</span>
        <div>未启用光伏。在设计输入「光伏投资」中填写<b>光伏装机容量</b>或<b>光伏覆盖比例</b>即可接入光伏投资模块：自动计算年发电量、自发自用/余电上网、节省电费与回收期/IRR，并并入项目 CAPEX 与运营成本。模型系数（造价 3.65 元/W、等效小时 1100h、运维 0.06 元/kWh）来自 2026 中国工商业分布式光伏共识。</div></div>`;
    }
    const ec = E.rmb;
    const rows = [
      ["装机容量", pv.kWp, "kWp", "光伏阵列峰值"],
      ["储能配置", pv.batteryKWh, "kWh", pv.batteryKWh > 0 ? "提升自用率" : "未配储"],
      ["年发电量", (pv.annualGenKwh / 1000).toFixed(0), "MWh", "等效小时 1100h"],
      ["自发自用", (pv.selfKwh / 1000).toFixed(0), "MWh", "自用率 " + (pv.selfUseRatio * 100).toFixed(1) + "%"],
      ["余电上网", (pv.exportKwh / 1000).toFixed(0), "MWh", "上网电价 0.35 元/kWh"],
    ];
    return `
      <div class="metrics" style="padding:14px 26px 8px">
        ${metricCard("年节省电费", (pv.elecSaved / 10000).toFixed(1), "万元", "自发自用抵电网", "brand")}
        ${metricCard("年上网收入", (pv.exportIncome / 10000).toFixed(1), "万元", "余电上网", "accent")}
        ${metricCard("光伏投资 CAPEX", (pv.capex / 10000).toFixed(1), "万元", "已并入项目总投资", "brand")}
        ${metricCard("光伏回收期", pv.paybackYears != null ? pv.paybackYears.toFixed(1) : "—", "年", "独立投资视角", pv.paybackYears != null && pv.paybackYears < 8 ? "accent" : "")}
        ${metricCard("光伏 IRR", pv.irr != null ? pv.irr : "—", "%", "25 年寿命·年衰减 0.5%", pv.irr != null && pv.irr > 10 ? "accent" : "")}
      </div>
      <div class="table-wrap" style="padding:0 26px 8px"><table class="data">
        <thead><tr><th>光伏指标</th><th class="num">数值</th><th>说明</th></tr></thead>
        <tbody>${rows.map(r => `<tr><td>${r[0]}</td><td class="num">${r[1]} ${r[2]}</td><td class="muted" style="font-size:12.5px">${r[3]}</td></tr>`).join("")}</tbody>
      </table></div>
      <div class="note" style="padding:6px 26px 24px"><span class="ic">☀️</span>
        <div>光伏为<b>独立投资视角</b>：回收期/IRR 仅衡量光伏+储能自身（25 年寿命、年衰减 0.5%），不依赖项目融资口径。其 capex 已并入项目总投资、节省电费已冲减运营成本、上网收入已计入营收，故项目级盈利能力指标已自动包含光伏贡献。屋顶可用面积需另行勘测。</div></div>`;
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
      ["水费", e.opexWater], ["固废处置", e.opexSolids], ["碱度投加(NaHCO₃)", e.opexAlk], ["人工 (" + e.laborCount + " 人)", e.opexLabor], ["维护", e.opexMaint],
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
      <div class="section-title" style="padding:18px 26px 0">光伏投资分析 (PV)</div>
      ${renderPVPanel(d)}
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
    let html = `<div class="note" style="margin:6px 0 12px"><span class="ic">🧮</span><div>基于 Saltelli (2010) 方差分解，N=${res.N}（seed=${res.seed} 可复现）。<b>ST</b> 为总阶指数（含交互），ST−S 为该因子的交互贡献；各指标 ΣST≈1 表示分解闭合。抽样同时覆盖 <b>模型系数</b>（知识库不确定性参数）与 <b>用户可自定义输入</b>（饲料系数/生产水价/电价/鱼价，围绕当前值 ±band 采样），故主导因子现已含用户经营假设。</div></div>`;
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
          const badge = it.group === "user" ? `<span class="sobol-badge user">用户输入</span>` : `<span class="sobol-badge model">模型系数</span>`;
          const interact = it.interaction > 0.001 ? `<span class="sobol-inter" title="交互贡献 ST−S">交互 ${it.interaction}</span>` : "";
          html += `<div class="sobol-bar-row">
            <span class="sobol-bar-label">${it.label} ${badge}</span>
            <span class="sobol-bar-track"><span class="sobol-bar-fill ${it.group === "user" ? "user" : ""}" style="width:${w}%"></span></span>
            <span class="sobol-bar-val">S=${it.S} · ST=${it.ST} ${interact}</span>
          </div>`;
        });
        html += `</div>`;
        html += `<div class="sobol-foot muted">ΣST=${m.stSum}（闭合性检查，越接近 1 越可信）</div>`;
        if (m.kindShare) html += `<div class="sobol-foot" style="margin-top:3px">方差来源：<b style="color:#38bdf8">模型系数 ${Math.round(m.kindShare.epistemic * 100)}%</b> · <b style="color:#f59e0b">经营假设 ${Math.round(m.kindShare.aleatory * 100)}%</b>（按 ST 汇总，O16）</div>`;
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
    const capCal = ec.capexCalibration || {};
    const capRows = Object.keys(ec.capexPerM3).filter(k => k !== "salePrice")
      .map(k => {
        const c = capCal[k] || {};
        const src = (c.year ? c.year + "：" : "") + (c.source || "—") + (c.confidence ? `（置信度 ${c.confidence}）` : "");
        return `<tr><td>${capexLabel(k)}</td><td class="num">${ec.capexPerM3[k]}</td><td>${k === "building" ? "元/m²" : "元/m³"}</td><td class="src">${src}</td></tr>`;
      }).join("");
    const opRows = [
      ["饲料(" + (sp ? sp.name : "基准") + ")", sp && sp.feedPrice ? sp.feedPrice : ec.opex.feedPrice, "元/kg"],
      ["苗种", ec.opex.fingerlingPrice, "元/尾"],
      ["生产补水", ec.opex.waterPrice, "元/m³"],
      ["人工", ec.opex.laborPerYear + " × " + ec.opex.laborBase + " 起（随产量 √规模）", "元/人·年 × 人"],
      ["维护", (ec.opex.maintenanceRate*100) + "% CAPEX", "年"],
      ["电价", ec.opex.elecPrice, "元/kWh"],
      ["固废处置", ec.opex.solidsDisposalPrice, "元/kg 干固"],
    ].map(r => `<tr><td>${r[0]}</td><td class="num">${r[1]}</td><td>${r[2]}</td></tr>`).join("");
    const pvK = K.pv || {};
    const pvRows = [
      ["系统造价", pvK.capexPerW, "元/W（含设计/施工/并网；2026 工商业分布式区间 3.5–3.8）"],
      ["等效满发小时", pvK.capacityHours, "h/年（中部/华东参考；西北>1300，川渝~1000）"],
      ["余电上网电价", pvK.exportPrice, "元/kWh（2026 市场化，区间 0.30–0.40）"],
      ["运维单价", pvK.omPerKwh, "元/kWh（清洗/保险/监测）"],
      ["组件年衰减", (pvK.degradation * 100).toFixed(1) + "%", "年（组件~0.4–0.5%）"],
      ["基础自用率", (pvK.selfUseBase * 100).toFixed(0) + "%", "RAS 24/7 平负载，白天匹配高"],
      ["储能造价", pvK.batteryCapexPerWh, "元/Wh（2026 EPC，区间 0.5–0.8）"],
      ["经济寿命", pvK.lifetimeYears, "年（光伏系统）"],
    ].map(r => `<tr><td>${r[0]}</td><td class="num">${r[1]}</td><td>${r[2]}</td></tr>`).join("");
    const steps = [
      ["养殖池系统", "按产能目标与放养密度、养殖茬次反推所需养殖水体，确定池数、池径与有效容积。"],
      ["投喂与氮负荷", "由产量与饲料系数(FCR)估算年投喂量，推导总氨氮(TAN)等氮素日产量，作为生物滤池设计依据。"],
      ["水力学", "由养殖水体与日循环次数确定循环流量与补水流量，得出回用率与单位鱼比水耗。水足迹真水平衡：年取水 = 蒸发 + 排污(bleed) + 污泥脱水带水 + 微滤机反冲洗/脱气塔雾损，单位鱼水足迹 = 取水/产量（m³/kg），并校验补水率是否覆盖全部损耗（否则水位下降）。消耗性水足迹另计蒸发+污泥+雾损（不返还环境）。环境足迹按年电耗 × 地区电网排放因子给出电力碳足迹（kgCO₂e/kg鱼）。"],
      ["生物滤池 (MBBR)", "按 TAN 负荷与温度修正后的硝化速率(θ 系数)确定反应器容积与悬浮填料量，并叠加安全系数。分段考虑 AOB 亚硝化(TAN→NO₂)与 NOB 硝化(NO₂→NO₃)两步速率，NO₂ 稳态更低。"],
      ["生物脱氮（反硝化）", "MBBR 完成硝化后，NO₃ 经侧流反硝化反应器在缺氧 + 碳源条件下由异养菌还原为 N₂ 逸出；按 NO₃-N 负荷与反硝化容积负荷(denitRate)确定反应器容积，脱氮率 denitRemoval 计入稳态 NO₃ 质量平衡。"],
      ["增氧与脱碳", "按饲料氧耗 + 硝化耗氧配置供氧能力（覆盖鱼代谢与硝化峰值，含安全系数），按 CO₂ 产生量配置脱气塔；稳态 CO₂ 由<strong>脱气塔(主动) + 养殖池敞口水面天然挥发(被动空气吹脱) + 补水稀释</strong>三者共同决定（双膜理论，等效去除流量=co2Kla×养殖池体积），并非仅依赖脱气塔。"],
      ["固废处理", "按循环流量配置微滤机台数与单台处理量，并配置污泥浓缩/脱水单元。"],
      ["水质精制与消毒（可选）", "在基础单元之上可叠加三套水质精制与生物安保单元：① <strong>泡沫分离（蛋白分离器）</strong>——约 25% 循环量经侧流射流曝气产生泡沫，去除溶解有机碳 DOC（约 45%）与微滤机残留细颗粒，并产出浓缩有机污泥；② <strong>臭氧氧化+消毒</strong>——强氧化剂将 NO₂ 氧化为 NO₃、协同氧化 DOC，并提供对数灭活(LOG)主动消毒，独立运行需追加接触柱+尾气破坏；③ <strong>UV 紫外消毒</strong>——按 30 mJ/cm² 设计剂量进行对数灭活，作为基础生物安保（默认开启）。三单元的 capex / 能耗 / 维护费均并入投资与运营账，仅启用时计入，未启用时对全部指标完全中性。"],
      ["能耗估算", "按水泵、增氧、脱气、控温、辅助、固废处置等系统功率需求估算总装机与单位鱼比能耗。水泵扬程用<strong>达西–魏斯巴赫</strong>阻力法（沿程摩阻 Swamee-Jain + 局部损失 + 静扬程）计算。控温采用<strong>bin method 季节性双工况</strong>：取地区全年月均温序列，逐月判定制热/制冷并用对应 COP 折算，累加得年控温电耗，比单点估算更准；无地区时退化为单点。控温负荷随<strong>地区全年平均气温</strong>变化：净热需求 = 围护传热(围护表面积[屋面+外墙]×U值×温差) + 补水升温(补水流量×比热×温差) + 水面蒸发潜热(池面蒸发×汽化潜热) − 内部得热(泵损+照明/代谢)；若环境低于设定温则加热、高于则制冷，分别按热泵 COP 与冷水机组 COP 折算电耗。固废处置电耗按干固体量 × 单位处置能耗计入。能耗分项在「能耗」面板以饼图展示泵/氧/脱气/控温/杂项的功率占比，便于定位主要耗能单元与节电重点。"],
      ["建筑规模", "按养殖区与设备区占地估算车间总面积与体积（含通道与辅助用房）。"],
      ["光伏与储能（可选）", "若用户启用光伏，按年用电量(或指定 kWp)定容光伏装机，发电量 = kWp × 等效满发小时；自发自用部分按零售电价抵扣电网电费，余电按上网价售电。配储能可提升自用率（封顶 95%）。光伏 CAPEX 并入项目总投资、运维与上网收入并入运营账，并独立给出 25 年寿命(年衰减)视角下的回收期与 IRR。"],
      ["经济与校核", "汇总 CAPEX/OPEX（含水费、光伏节电/上网收入）得出单位成本、盈利与回收期，并以稳态质量平衡校核水质可行性。"],
    ].map((s, i) => `<li><span class="doc-step-n">${i+1}</span><div><b>${s[0]}</b>　${s[1]}</div></li>`).join("");
    // 蒙特卡洛示例数值：实时调用引擎生成，确保与设计书/当前引擎版本一致（避免写死漂移）
    let mcRows = "", mcNote = "", mcWq = "";
    try {
      const mcDemo = E.monteCarlo({ speciesKey: "bass", annualTons: 100, designTemp: 18, salePrice: 45 });
      const f1 = (v) => v.toFixed(1);
      const gProfit = { p10: mcDemo.grossProfit.p10 / 1e4, p50: mcDemo.grossProfit.p50 / 1e4, p90: mcDemo.grossProfit.p90 / 1e4 };
      const mcDef = [
        ["单位成本 (元/kg)", mcDemo.costPerKg, "越低越好"],
        ["比能耗 (kWh/kg)", mcDemo.energyIntensity, "越低越好"],
        ["年毛利 (万元)", gProfit, "越高越好"],
        ["回收期 (年)", mcDemo.paybackYears, "越低越好"],
        ["毛利率 (%)", mcDemo.marginRate, "越高越好"],
      ];
      mcRows = mcDef.map((r) => `<tr><td>${r[0]}</td><td class="num">${f1(r[1].p10)}</td><td class="num">${f1(r[1].p50)}</td><td class="num">${f1(r[1].p90)}</td><td>${r[2]}</td></tr>`).join("");
      const span = ((mcDemo.costPerKg.p90 - mcDemo.costPerKg.p10) / mcDemo.costPerKg.p50 * 100).toFixed(0);
      mcNote = `<b>示例（加州鲈 100 t/年、售价 45 元/kg、N=2000 实时运行）：</b>成本区间 ${mcDemo.costPerKg.p10.toFixed(1)}–${mcDemo.costPerKg.p90.toFixed(1)}（跨度约 ${span}%），因成本主驱动是饲料/电价/售价，均不在本抽样内；总投资在该运行下近似恒定——CAPEX 由规模与设备定容决定，被扰动的运行系数不改变定容逻辑。`;
      const wq = mcDemo.waterQuality;
      mcWq = `<b>水质可行率：</b>每次重算统计水质「达标/预警/超限」占比，即工艺失效概率。本例 ok ${wq.okPct}% / warn ${wq.warnPct}% / fail ${wq.failPct}%${wq.failPct > 0 ? `——仍有约 ${wq.failPct.toFixed(0)}% 场景水质超限，提示应加大余量或调整设计` : `——工艺风险已显著下降`}。直方图展示单位成本与回收期的分布形态（单峰/拖尾/偏态）。`;
    } catch (e) {
      mcRows = `<tr><td colspan="5" class="num">蒙特卡洛示例生成失败</td></tr>`;
      mcNote = "示例数值由引擎实时生成。"; mcWq = "";
    }

    // 当前方案光伏实时测算（renderDoc 可访问同作用域 currentDesign）
    let pvLive = "";
    try {
      const pd = currentDesign;
      if (pd && pd.economics && pd.economics.pv && pd.economics.pv.enabled) {
        const p = pd.economics.pv;
        const f = (v, d) => Number(v).toFixed(d == null ? 0 : d);
        pvLive = `
      <div class="doc-card" style="margin-top:10px">
        <h4>当前方案光伏测算（实时）</h4>
        <table class="data doc-table"><tbody>
          <tr><td>装机容量</td><td class="num">${f(p.kWp, 1)} kWp${p.batteryKWh > 0 ? (" + 储能 " + f(p.batteryKWh, 0) + " kWh") : ""}</td></tr>
          <tr><td>年发电量</td><td class="num">${f(p.annualGenKwh / 1000, 0)} MWh</td></tr>
          <tr><td>自用率</td><td class="num">${(p.selfUseRatio * 100).toFixed(1)}%</td></tr>
          <tr><td>年省电费</td><td class="num">${f(p.elecSaved / 10000, 1)} 万元</td></tr>
          <tr><td>年上网收入</td><td class="num">${f(p.exportIncome / 10000, 1)} 万元</td></tr>
          <tr><td>光伏 CAPEX</td><td class="num">${f(p.capex / 10000, 1)} 万元</td></tr>
          <tr><td>光伏回收期</td><td class="num">${f(p.paybackYears, 2)} 年</td></tr>
          <tr><td>光伏 IRR</td><td class="num">${f(p.irr, 1)}%</td></tr>
        </tbody></table>
        <p class="doc-cap">以上为当前设计输入下光伏模块实时输出；光伏 CAPEX 已并入项目总投资、节电/上网收入已并入运营账（见「经济估算」面板与盈利能力指标）。</p>
      </div>`;
      }
    } catch (e) { pvLive = ""; }

    // 当前方案水质精制单元实时测算（renderDoc 可访问同作用域 currentDesign）
    let refineLive = "";
    try {
      const pd = currentDesign;
      if (pd && pd.economics && pd.energy) {
        const es = pd.energy.energySplit;
        const cb = pd.economics.capexBreakdown;
        const uv = cb.find((r) => r.key === "uv");
        const sk = cb.find((r) => r.key === "skimmer");
        const oz = cb.find((r) => r.key === "ozone");
        const dis = pd.waterQuality.disinfection;
        const f = (v, d) => Number(v).toFixed(d == null ? 0 : d);
        refineLive = `
      <div class="doc-card" style="margin-top:10px">
        <h4>当前方案水质精制单元（实时）</h4>
        <table class="data doc-table"><tbody>
          <tr><td>紫外消毒 UV</td><td class="num">${uv ? f(uv.total / 10000, 1) + " 万元" : "未启用"}（${f(es.uv, 2)} kW）</td></tr>
          <tr><td>泡沫分离</td><td class="num">${sk ? f(sk.total / 10000, 1) + " 万元" : "未启用"}（${f(es.skimmer, 2)} kW）</td></tr>
          <tr><td>臭氧</td><td class="num">${oz ? f(oz.total / 10000, 1) + " 万元" : "未启用"}（${f(es.ozone, 2)} kW）</td></tr>
          <tr><td>主动消毒对数灭活</td><td class="num">${dis ? f(dis.log, 1) + " LOG（目标 " + f(dis.target, 1) + "，" + dis.status + "）" : "—"}</td></tr>
        </tbody></table>
        <p class="doc-cap">以上为当前设计输入下三单元的实时 capex 与能耗；未启用单元对全部经济与水质指标中性。溶解有机碳 DOC 与消毒状态见「水质可行性校核」面板。</p>
      </div>`;
      }
    } catch (e) { refineLive = ""; }

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
          <table class="data doc-table"><thead><tr><th>投资项</th><th class="num">单价</th><th>单位</th><th class="src">来源/年份（校准时效）</th></tr></thead><tbody>${capRows}</tbody></table>
          <p class="doc-cap">直接费按养殖水体（土建按面积）估算，详见「经济估算」中各投资项的一级分解。总投资另含 <b>间接费</b>（EPCM 12% + 调试 4% + 不可预见 6% + 其他 3% = 直接费 25%，封顶上限）与可选 <b>土地费</b>；并应用 <b>规模经济（分段曲线）</b>：单位投资随年产量呈亚线性变化，但按产能档位采用不同规模指数（&lt;30t 更陡、&gt;1000t 趋缓，下限 0.55×、上限 2.5×），并在 30/300/1000t 档位边界做 ±scaleSmoothWidth 平滑过渡（v1.18.2，消除投资跳变），比单一 0.6 次幂常数更贴合工程实际（参考规模 ${K.economics.capexModel.refAnnualTons} t/年）。本表为参考规模下的基准单价。</p>
          <p class="doc-cap">⏱️ <b>校准时效（v1.18.3 优化9）</b>：各单价数据来源与校准年份见右侧「来源/年份」列；设备/土建价格随通胀与供应链波动，建议<b>年度重校准</b>，并在 knowledge.economics.capexCalibration 中更新来源与置信度，便于审计溯源。</p>
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
          <p class="doc-cap">水费按生产补水量 × 水价估算；饲料通常占 OPEX 的 70–80%。维护费改按各设备自身年维护率与寿命分摊并计提重置准备，比单一总率更贴近实际（高价易耗件费率高、寿命短）。本表为<strong>计算基准（标准值，对应默认地区武汉）</strong>；实际计算时人工按地区 laborIndex、电价按地区 powerIndex 调整，且各项均可被用户设计输入覆盖——本表所示即"未选地区/未覆盖"时的生效基准。</p>
        </div>
      </div>

      <div class="doc-grid">
        <div class="doc-card">
          <h4>⑤ 光伏投资基准 (PV, 可选)</h4>
          <table class="data doc-table"><thead><tr><th>参数</th><th class="num">基准值</th><th>说明</th></tr></thead><tbody>${pvRows}</tbody></table>
          <p class="doc-cap">光伏/储能为<strong>可选模块</strong>：用户可指定装机容量 <code>pvKWp</code>(kWp)、或按年用电比例 <code>pvFraction</code>(0–1) 自动定容、并可选 <code>batteryKWh</code> 储能。未启用时光伏 CAPEX/收入/节电均为 0，对经济基线<strong>完全中性</strong>。模型系数来自 2026 中国工商业分布式光伏共识（造价/等效小时/上网价/运维/衰减），不依赖国家 FIT 补贴。</p>
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
          <table class="data doc-table"><thead><tr><th>指标</th><th class="num">P10</th><th class="num">P50</th><th class="num">P90</th><th>方向</th></tr></thead><tbody>${mcRows}</tbody></table>
          <p class="doc-cap">${mcNote}</p>
          <p class="doc-cap">${mcWq}</p>
          <p class="doc-cap"><b>与敏感度（龙卷风图）互补：</b>龙卷风图单参数逐一 ±20% 扰动，回答「哪些参数最关键」；蒙特卡洛多参数同时随机，回答「综合不确定下结果区间多宽、工艺失效概率多大」。配合：先找关键源，再看联合分布。</p>
      </div>

      <div class="doc-section">
        <h3>五、光伏投资分析方法</h3>
        <p class="doc-p">光伏为可选模块，用于评估"自发自用 + 余电上网"对运营电费与项目经济性的改善。核心计算链路：</p>
        <ol class="doc-steps">
          <li><div><b>装机定容</b>：用户指定 <code>pvKWp</code>(kWp)，或按 <code>pvFraction × 年用电量</code> 自动定容（年用电量来自第七节能耗估算）。</div></li>
          <li><div><b>发电与自用</b>：年发电量 = kWp × 等效满发小时；基础自用率默认 80%（RAS 24/7 平负载、白天匹配高），配储能可提升自用率（封顶 95%）；余电上网。</div></li>
          <li><div><b>经济并入</b>：净电网电费 = (总电量 − 光伏自用) × 电价；上网收入 = 余电 × 上网价；光伏 CAPEX(含储能) 并入项目总投资、光伏运维并入运营账——故项目 CAPEX / OPEX / 营收 / NPV / IRR 已自动含光伏贡献。</div></li>
          <li><div><b>独立视角</b>：另以 25 年寿命、组件年衰减(0.5%) 给出光伏自身的回收期与 IRR（二分法求解 NPV=0 的折现率），便于单独评估光伏投资吸引力，不依赖项目融资口径。</div></li>
        </ol>
        <p class="doc-cap">模型系数来自 2026 中国工商业分布式光伏共识（系统造价 3.5–3.8 元/W、等效小时 1100h、上网价 0.30–0.40 元/kWh、运维 0.06 元/kWh），无国家 FIT 补贴依赖；未启用时对所有经济指标完全中性。决策建议：优先利用厂房屋顶平铺（不占土地、就近消纳），先勘测屋顶可用面积与遮挡，再据年用电量定容；储能仅在峰谷价差大或自用率偏低时经济。</p>
        ${pvLive}
      </div>

      <div class="doc-section">
        <h3>六、可选水质精制与消毒单元（泡沫分离 / 臭氧 / UV）</h3>
        <p class="doc-p">三套单元均为<strong>可选叠加项</strong>，用于提升水质透明度（降低 DOC）、强化生物安保（病原灭活）与氧化副产物（NO₂→NO₃）。其计算模型：</p>
        <ol class="doc-steps">
          <li><div><b>泡沫分离（蛋白分离器）</b>：侧流约 25% 循环量经射流曝气/文丘里产生上升泡沫，吸附去除溶解有机碳 DOC（设计去除率约 45%）与微滤机残留细颗粒/胶体；浓缩液为附加有机污泥，计入固废处置。capex 按养殖水体计（含机组/侧流泵/射流器），能耗为侧流泵+气比能耗。</div></li>
          <li><div><b>臭氧氧化+消毒</b>：臭氧发生器（配氧气源）投加 0.01–0.05 g O₃/m³，将 NO₂ 氧化为 NO₃（降低 NOB 负荷与 NO₂ 累积风险）、协同氧化 DOC，并提供对数灭活(LOG)主动消毒；未配泡沫分离时需独立接触柱+尾气破坏单元（作接触/破坏）。capex 与能耗均并入投资与运营账。</div></li>
          <li><div><b>UV 紫外消毒</b>：按 30 mJ/cm² 设计剂量对循环水进行对数灭活，作为基础生物安保（<strong>默认开启</strong>）；能耗按循环流量比能耗计入总能耗（此前仅计 capex、本版补齐能耗口径）。</div></li>
          <li><div><b>稳态联动</b>：DOC 稳态 = 日 DOC 产生量 ÷（生物滤池本底去除 + 泡沫分离 + 臭氧 串联去除后的有效流量 + 补水稀释）；消毒 LOG 取 UV 与臭氧较强者；任一单元开启即计入对应 capex / 能耗 / 维护费，未开启则完全中性。</div></li>
        </ol>
        <p class="doc-cap">模型系数来自 RAS 单元过程文献（泡沫分离 DOC 去除 0.3–0.6、臭氧剂量与 LOG 灭活区间、UV 剂量–LOG 关系）与工程经验；未启用时不改变任何默认水质/经济结论。决策建议：常规淡水 RAS 以 UV 为基础生物安保即可；对苗种、冷水高值品种或病害压力大的系统，叠加泡沫分离（降 DOC、稳水色）与臭氧（强消毒、氧化 NO₂）可显著降低生物安保风险。</p>
        ${refineLive}
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
      degasser: "CO₂ 脱除塔", denit: "反硝化反应器", uv: "紫外消毒(UV)", skimmer: "泡沫分离",
      ozone: "臭氧氧化", ozoneContact: "臭氧接触柱", pumps: "水泵与管路", controls: "自控与监测",
      building: "车间土建", hvac: "控温系统" })[k] || k;
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

  function escHtml(str) {
    if (!str) return "";
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  /* ---------------- 供应商库 ---------------- */
  let suppliersData = [];
  let suppliersLoaded = false;
  let supplierCatOn = "";
  let supplierKeyword = "";
  let isAdmin = false;
  let adminToken = localStorage.getItem("ras_admin_token") || "";

  const CAT_LABELS = { equipment:"设备供应商", material:"材料供应商", construction:"施工供应商", design:"设计供应商", consumable:"耗材供应商" };
  const CAT_KEYS = ["equipment", "material", "construction", "design", "consumable"];

  async function ensureSuppliers() {
    if (!suppliersLoaded) await fetchSuppliers();
  }

  async function fetchSuppliers() {
    try {
      const BASE = cloud.getBase();
      const headers = isAdmin && adminToken ? { "x-admin-token": adminToken } : {};
      const [itemsRes, catsRes] = await Promise.all([
        fetch(BASE + "/api/suppliers", { headers }),
        fetch(BASE + "/api/suppliers/categories", { headers })
      ]);
      if (!itemsRes.ok) throw new Error("HTTP " + itemsRes.status);
      suppliersData = await itemsRes.json();
      let categories = [];
      if (catsRes.ok) categories = await catsRes.json();

      // 渲染分类标签
      const catBar = document.getElementById("supplierCats");
      let catHTML = `<button class="chip${supplierCatOn === "" ? " on" : ""}" data-cat="">全部 <span class="count">${suppliersData.length}</span></button>`;
      categories.forEach((c) => {
        catHTML += `<button class="chip${supplierCatOn === c.key ? " on" : ""}" data-cat="${c.key}">${c.label} <span class="count">${c.count}</span></button>`;
      });
      catBar.innerHTML = catHTML;
      catBar.querySelectorAll(".chip").forEach((chip) => {
        chip.addEventListener("click", () => {
          supplierCatOn = chip.dataset.cat;
          supplierKeyword = "";
          document.getElementById("supplierKeyword").value = "";
          applySupplierFilter();
          updateCatChips();
        });
      });

      suppliersLoaded = true;
      applySupplierFilter();
    } catch (e) {
      console.error("[suppliers] fetch error:", e);
      document.getElementById("supplierGrid").innerHTML = '<div class="supplier-none">❌ 无法连接服务器，请确认后端已启动</div>';
    }
  }

  function updateCatChips() {
    document.querySelectorAll("#supplierCats .chip").forEach((chip) => {
      chip.classList.toggle("on", chip.dataset.cat === supplierCatOn);
    });
  }

  function applySupplierFilter() {
    let list = suppliersData;
    // 非管理员过滤掉已隐藏的
    if (!isAdmin) list = list.filter((s) => !s.hidden);
    if (supplierCatOn) list = list.filter((s) => s.category === supplierCatOn);
    if (supplierKeyword) {
      const kw = supplierKeyword.toLowerCase();
      list = list.filter((s) =>
        (s.name && s.name.toLowerCase().includes(kw)) ||
        (s.brand && s.brand.toLowerCase().includes(kw)) ||
        (s.product && s.product.toLowerCase().includes(kw)) ||
        (s.tags && s.tags.some((t) => t.toLowerCase().includes(kw)))
      );
    }
    renderSupplierCards(list);
  }

  function renderSupplierCards(list) {
    const grid = document.getElementById("supplierGrid");
    if (list.length === 0) {
      grid.innerHTML = '<div class="supplier-none">没有匹配的供应商</div>';
      return;
    }
    grid.innerHTML = list.map((s) => {
      const tagsHTML = (s.tags || []).slice(0, 4).map((t) => `<span class="sup-tag">${t}</span>`).join("");
      const adminBtns = isAdmin ? `
        <div class="card-admin-actions" onclick="event.stopPropagation()">
          <button class="admin-act-btn edit" onclick="window._editSupplier(${s.id})" title="编辑">✏️</button>
          <button class="admin-act-btn hide-btn" onclick="window._toggleHideSupplier(${s.id})" title="${s.hidden ? '取消隐藏' : '隐藏'}">${s.hidden ? '👁' : '🙈'}</button>
          <button class="admin-act-btn del" onclick="window._deleteSupplier(${s.id})" title="删除">🗑</button>
        </div>` : "";
      const hiddenClass = s.hidden ? " is-hidden" : "";
      const hiddenBadge = s.hidden ? '<span class="sup-hidden-badge">已隐藏</span>' : "";
      return `
        <div class="supplier-card${isAdmin ? " admin-mode" : ""}${hiddenClass}" data-id="${s.id}" onclick="window._showSupplierDetail(${s.id})">
          ${adminBtns}
          <div class="sup-header">
            <span class="sup-name">${escHtml(s.name)}</span>
            ${s.brand ? `<span class="sup-brand">${escHtml(s.brand)}</span>` : ""}
            ${hiddenBadge}
          </div>
          ${s.product ? `<div class="sup-product">${escHtml(s.product)}</div>` : ""}
          ${s.description ? `<div class="sup-desc">${escHtml(s.description)}</div>` : ""}
          <div class="sup-meta">
            ${s.region ? `<span>📍 ${escHtml(s.region)}</span>` : ""}
            ${s.contact ? `<span>📞 ${escHtml(s.contact)}</span>` : ""}
          </div>
          ${tagsHTML ? `<div class="sup-tags">${tagsHTML}</div>` : ""}
        </div>`;
    }).join("");

    window._suppliersData = suppliersData;
  }

  window._showSupplierDetail = function(id) {
    const s = (window._suppliersData || suppliersData).find((x) => x.id === id);
    if (!s) return;
    const overlay = document.createElement("div");
    overlay.className = "supplier-modal-overlay";
    const tagsHTML = (s.tags || []).map((t) => `<span class="modal-tag">${t}</span>`).join("");
    const adminFooter = isAdmin ? `
      <div class="modal-admin-footer">
        <button class="admin-act-btn edit" onclick="window._editSupplier(${s.id})">✏️ 编辑</button>
        <button class="admin-act-btn hide-btn" onclick="window._toggleHideSupplier(${s.id})">${s.hidden ? '👁 取消隐藏' : '🙈 隐藏'}</button>
        <button class="admin-act-btn del" onclick="window._deleteSupplier(${s.id})">🗑 删除</button>
      </div>` : "";
    overlay.innerHTML = `
      <div class="supplier-modal">
        <button class="modal-close" onclick="this.closest('.supplier-modal-overlay').remove()">✕</button>
        <div class="modal-name">${escHtml(s.name)}</div>
        ${s.brand ? `<div class="modal-brand">品牌：${escHtml(s.brand)}</div>` : ""}
        ${s.product ? `<div class="modal-section"><div class="modal-label">主营产品</div><div class="modal-value">${escHtml(s.product)}</div></div>` : ""}
        ${s.description ? `<div class="modal-section"><div class="modal-label">简介</div><div class="modal-value">${escHtml(s.description)}</div></div>` : ""}
        ${s.region ? `<div class="modal-section"><div class="modal-label">服务区域</div><div class="modal-value">📍 ${escHtml(s.region)}</div></div>` : ""}
        ${s.contact ? `<div class="modal-section"><div class="modal-label">联系方式</div><div class="modal-value">📞 ${escHtml(s.contact)}</div></div>` : ""}
        ${s.website ? `<div class="modal-section"><div class="modal-label">网站</div><div class="modal-value"><a href="${escHtml(s.website)}" target="_blank" rel="noopener">${escHtml(s.website)}</a></div></div>` : ""}
        ${tagsHTML ? `<div class="modal-section"><div class="modal-label">标签</div><div class="modal-tags">${tagsHTML}</div></div>` : ""}
        ${adminFooter}
      </div>`;
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  };

  /* ---- 管理员登录 ---- */
  function toggleAdmin() {
    if (isAdmin) {
      // 退出登录
      isAdmin = false;
      adminToken = "";
      localStorage.removeItem("ras_admin_token");
      applySupplierFilter();
      updateAdminUI();
      // 如果当前在 full 模式的管理面板，切回设计输入
      const activeTab = document.querySelector("#tabs .tab.active");
      if (activeTab && activeTab.dataset.adminOnly === "full") {
        document.querySelector('#tabs .tab[data-tab="input"]').click();
      }
      return;
    }
    // 弹出登录框
    const overlay = document.createElement("div");
    overlay.className = "supplier-modal-overlay";
    overlay.innerHTML = `
      <div class="supplier-modal admin-login-modal">
        <button class="modal-close" onclick="this.closest('.supplier-modal-overlay').remove()">✕</button>
        <div class="modal-name" style="margin-bottom:1rem">🔐 管理员登录</div>
        <div style="margin-bottom:1rem">
          <label style="font-size:.73rem;color:hsla(0,0%,100%,.5);display:block;margin-bottom:.3rem">管理员密码</label>
          <input id="adminPwdInput" type="password" class="text-input" placeholder="请输入管理员密码" style="width:100%;padding:.5rem .75rem" />
        </div>
        <div id="adminLoginError" style="color:#f66;font-size:.73rem;margin-bottom:.8rem;display:none"></div>
        <button id="adminLoginBtn" class="toggle-btn magnetic on" style="width:100%;padding:.55rem">登录</button>
      </div>`;
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);

    const pwdInput = document.getElementById("adminPwdInput");
    const loginBtn = document.getElementById("adminLoginBtn");
    const errEl = document.getElementById("adminLoginError");

    const doLogin = async () => {
      const pwd = pwdInput.value.trim();
      if (!pwd) { errEl.textContent = "请输入密码"; errEl.style.display = "block"; return; }
      try {
        const BASE = cloud.getBase();
        const res = await fetch(BASE + "/api/suppliers/admin/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: pwd })
        });
        const data = await res.json();
        if (data.ok) {
          adminToken = pwd;
          isAdmin = true;
          localStorage.setItem("ras_admin_token", pwd);
          overlay.remove();
          applySupplierFilter();
          updateAdminUI();
        } else {
          errEl.textContent = data.error || "密码错误";
          errEl.style.display = "block";
        }
      } catch (e) {
        errEl.textContent = "连接服务器失败";
        errEl.style.display = "block";
      }
    };
    loginBtn.addEventListener("click", doLogin);
    pwdInput.addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
    setTimeout(() => pwdInput.focus(), 100);
  }

  /* ---- 自动恢复管理员状态 ---- */
  async function restoreAdmin() {
    if (!adminToken) return;
    try {
      const BASE = cloud.getBase();
      const res = await fetch(BASE + "/api/suppliers/admin/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: adminToken })
      });
      const data = await res.json();
      if (data.ok) {
        isAdmin = true;
        updateAdminUI();
      } else {
        adminToken = "";
        localStorage.removeItem("ras_admin_token");
      }
    } catch (e) { /* 静默失败 */ }
  }

  function updateAdminUI() {
    const lockBtn = document.getElementById("adminLockBtn");
    const addBtn = document.getElementById("adminAddBtn");

    // 1. 统一锁按钮状态
    if (lockBtn) {
      if (isAdmin) {
        lockBtn.textContent = "🔓";
        lockBtn.title = "退出管理";
        lockBtn.classList.add("on");
      } else {
        lockBtn.textContent = "🔒";
        lockBtn.title = "管理员登录";
        lockBtn.classList.remove("on");
      }
    }

    // 2. 管理类 tab 显隐控制
    document.querySelectorAll("#tabs .tab[data-admin-only]").forEach(tab => {
      const mode = tab.dataset.adminOnly;
      if (mode === "full") {
        tab.style.display = isAdmin ? "" : "none";
      }
      // "edit" 模式始终可见，无需处理
    });

    // 3. 供应商面板中的编辑模式按钮
    if (addBtn) addBtn.style.display = isAdmin ? "" : "none";

    // 4. 知识库面板 UI
    updateKBUI();
  }

  /* ---- 新增 / 编辑供应商 ---- */
  window._editSupplier = function(id) {
    const s = id ? (window._suppliersData || suppliersData).find((x) => x.id === id) : null;
    showSupplierEditor(s);
  };

  function showSupplierEditor(supplier) {
    const isNew = !supplier;
    const s = supplier || {};
    // 关闭已有的详情弹窗
    document.querySelectorAll(".supplier-modal-overlay").forEach((el) => el.remove());

    const overlay = document.createElement("div");
    overlay.className = "supplier-modal-overlay";
    overlay.innerHTML = `
      <div class="supplier-modal supplier-editor-modal">
        <button class="modal-close" onclick="this.closest('.supplier-modal-overlay').remove()">✕</button>
        <div class="modal-name">${isNew ? "＋ 新增供应商" : "✏️ 编辑供应商"}</div>
        <form id="supplierForm" class="supplier-form" onsubmit="return false">
          <div class="form-row">
            <label>分类 <span class="req">*</span></label>
            <select id="supCat" class="text-input">
              ${CAT_KEYS.map((k) => `<option value="${k}" ${s.category === k ? "selected" : ""}>${CAT_LABELS[k]}</option>`).join("")}
            </select>
          </div>
          <div class="form-row">
            <label>名称 <span class="req">*</span></label>
            <input id="supName" class="text-input" value="${escHtml(s.name || "")}" placeholder="供应商名称" />
          </div>
          <div class="form-row">
            <label>品牌</label>
            <input id="supBrand" class="text-input" value="${escHtml(s.brand || "")}" placeholder="品牌名称" />
          </div>
          <div class="form-row">
            <label>主营产品</label>
            <input id="supProduct" class="text-input" value="${escHtml(s.product || "")}" placeholder="主营产品描述" />
          </div>
          <div class="form-row">
            <label>联系方式</label>
            <input id="supContact" class="text-input" value="${escHtml(s.contact || "")}" placeholder="电话 / 邮箱" />
          </div>
          <div class="form-row">
            <label>服务区域</label>
            <input id="supRegion" class="text-input" value="${escHtml(s.region || "")}" placeholder="如：全国 / 华东 / 海外" />
          </div>
          <div class="form-row">
            <label>网站</label>
            <input id="supWebsite" class="text-input" value="${escHtml(s.website || "")}" placeholder="https://..." />
          </div>
          <div class="form-row">
            <label>标签</label>
            <input id="supTags" class="text-input" value="${(s.tags || []).join("，")}" placeholder="多个标签用逗号分隔" />
          </div>
          <div class="form-row">
            <label>简介</label>
            <textarea id="supDesc" class="text-input" rows="3" placeholder="供应商简介...">${escHtml(s.description || "")}</textarea>
          </div>
          <div id="supFormError" style="color:#f66;font-size:.73rem;margin-top:.5rem;display:none"></div>
          <div class="form-actions">
            <button type="button" class="toggle-btn" onclick="this.closest('.supplier-modal-overlay').remove()">取消</button>
            <button type="submit" class="toggle-btn magnetic on">${isNew ? "创建" : "保存"}</button>
          </div>
        </form>
      </div>`;
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);

    const form = document.getElementById("supplierForm");
    form.addEventListener("submit", async () => {
      const name = document.getElementById("supName").value.trim();
      const category = document.getElementById("supCat").value;
      const errEl = document.getElementById("supFormError");
      if (!name) { errEl.textContent = "请输入供应商名称"; errEl.style.display = "block"; return; }
      if (!category) { errEl.textContent = "请选择分类"; errEl.style.display = "block"; return; }

      const tagsRaw = document.getElementById("supTags").value.trim();
      const tags = tagsRaw ? tagsRaw.split(/[,，]/).map((t) => t.trim()).filter(Boolean) : [];

      const body = {
        category,
        name,
        brand: document.getElementById("supBrand").value.trim() || undefined,
        product: document.getElementById("supProduct").value.trim() || undefined,
        contact: document.getElementById("supContact").value.trim() || undefined,
        region: document.getElementById("supRegion").value.trim() || undefined,
        website: document.getElementById("supWebsite").value.trim() || undefined,
        tags: tags.length ? tags : undefined,
        description: document.getElementById("supDesc").value.trim() || undefined,
        sort_order: 0
      };

      try {
        const BASE = cloud.getBase();
        const url = isNew ? (BASE + "/api/suppliers") : (BASE + "/api/suppliers/" + supplier.id);
        const method = isNew ? "POST" : "PUT";
        const res = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json", "x-admin-token": adminToken },
          body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!res.ok) { errEl.textContent = data.error || "操作失败"; errEl.style.display = "block"; return; }
        overlay.remove();
        // 刷新数据
        suppliersLoaded = false;
        await fetchSuppliers();
      } catch (e) {
        errEl.textContent = "网络错误：" + e.message;
        errEl.style.display = "block";
      }
    });
  }

  /* ---- 删除供应商 ---- */
  window._deleteSupplier = function(id) {
    if (!confirm("确定要删除该供应商吗？此操作不可撤销。")) return;
    (async () => {
      try {
        const BASE = cloud.getBase();
        const res = await fetch(BASE + "/api/suppliers/" + id, {
          method: "DELETE",
          headers: { "x-admin-token": adminToken }
        });
        if (!res.ok) { const d = await res.json(); alert("删除失败：" + (d.error || res.status)); return; }
        suppliersLoaded = false;
        await fetchSuppliers();
      } catch (e) {
        alert("网络错误：" + e.message);
      }
    })();
  };

  /* ---- 隐藏/取消隐藏供应商 ---- */
  window._toggleHideSupplier = function(id) {
    console.log("[toggleHide] 触发，id=", id, "类型:", typeof id);
    console.log("[toggleHide] suppliersData 长度:", suppliersData ? suppliersData.length : 0);
    const s = suppliersData.find((x) => x.id === id);
    if (!s) { console.warn("[toggleHide] 未找到供应商 id=", id); return; }
    console.log("[toggleHide] 供应商:", s.name, "hidden:", s.hidden, "类型:", typeof s.hidden);
    const action = s.hidden ? "unhide" : "hide";
    console.log("[toggleHide] action:", action, "adminToken:", adminToken ? "已设置" : "空");
    (async () => {
      try {
        const BASE = cloud.getBase();
        const url = BASE + "/api/suppliers/" + id + "/" + action;
        console.log("[toggleHide] 请求 URL:", url);
        const res = await fetch(url, {
          method: "POST",
          headers: { "x-admin-token": adminToken }
        });
        console.log("[toggleHide] 响应状态:", res.status);
        if (!res.ok) {
          let errMsg;
          try { const d = await res.json(); errMsg = d.error || res.status; } catch (_) { errMsg = res.status; }
          console.error("[toggleHide] 服务器错误:", errMsg);
          alert("操作失败：" + errMsg);
          return;
        }
        const data = await res.json();
        console.log("[toggleHide] 服务器响应:", data);
        // 本地即时更新
        s.hidden = !s.hidden;
        console.log("[toggleHide] 本地更新: hidden =", s.hidden);
        applySupplierFilter();
      } catch (e) {
        console.error("[toggleHide] 网络错误:", e.message);
        alert("网络错误：" + e.message);
      }
    })();
  };

  function initSuppliers() {
    const kw = document.getElementById("supplierKeyword");
    if (kw) {
      kw.addEventListener("input", () => {
        supplierKeyword = kw.value.trim();
        applySupplierFilter();
      });
    }
    // 管理员按钮
    const addBtn = document.getElementById("adminAddBtn");
    if (addBtn) addBtn.addEventListener("click", () => showSupplierEditor(null));
    // 尝试恢复管理员状态
    restoreAdmin();
    // 首次点击 tab 时懒加载
  }

  /* ---------------- 知识库管理 ---------------- */
  let kbCategories = [];
  let kbLeaves = [];
  let kbDirty = {};          // { "category.itemKey": { value, value_type } }
  let kbSelectedCat = "";
  let kbLoaded = false;

  async function ensureKnowledge() {
    if (!kbLoaded) await loadKBCategories();
  }

  async function loadKBCategories() {
    try {
      const BASE = cloud.getBase();
      const res = await fetch(BASE + "/api/knowledge/categories");
      if (!res.ok) throw new Error("HTTP " + res.status);
      kbCategories = await res.json();
      renderKBCategorySelect();
      kbLoaded = true;
    } catch (e) {
      console.error("[knowledge] load categories error:", e);
      document.getElementById("kbHint").textContent = "❌ 无法连接服务器";
    }
  }

  function renderKBCategorySelect() {
    const sel = document.getElementById("kbCategorySel");
    sel.innerHTML = '<option value="">-- 选择知识库类别 (' + kbCategories.length + ' 个) --</option>';
    kbCategories.forEach(c => {
      const ovBadge = c.overridesCount > 0 ? ` [${c.overridesCount}项覆盖]` : "";
      sel.innerHTML += `<option value="${c.key}">${c.label} · ${c.leafCount}项参数${ovBadge}</option>`;
    });
    sel.addEventListener("change", () => {
      kbSelectedCat = sel.value;
      if (kbSelectedCat) { loadKBLeaves(kbSelectedCat); } else { clearKBView(); }
    });
  }

  async function loadKBLeaves(category) {
    try {
      const BASE = cloud.getBase();
      const res = await fetch(BASE + "/api/knowledge/leaves/" + category);
      if (!res.ok) throw new Error("HTTP " + res.status);
      kbLeaves = await res.json();
      kbDirty = {};
      renderKBTable();
      updateKBUI();
      loadKBAudit(category);
    } catch (e) {
      console.error("[knowledge] load leaves error:", e);
    }
  }

  function renderKBTable() {
    const tbody = document.getElementById("kbTableBody");
    if (kbLeaves.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="color:hsla(0,0%,100%,.3);text-align:center;padding:2rem">该类别无参数</td></tr>';
      return;
    }
    tbody.innerHTML = kbLeaves.map(leaf => {
      const displayValue = typeof leaf.value === "object" ? JSON.stringify(leaf.value).substring(0, 40) : String(leaf.value);
      const displayOverride = leaf.isOverridden ? (typeof leaf.overrideValue === "object" ? JSON.stringify(leaf.overrideValue).substring(0, 40) : String(leaf.overrideValue)) : "";
      const overrideClass = leaf.isOverridden ? " overridden" : "";
      const changedClass = kbDirty[leaf.key] ? " changed" : "";
      const editValue = kbDirty[leaf.key] ? kbDirty[leaf.key].value : (leaf.isOverridden ? displayOverride : "");
      return `<tr class="${overrideClass}">
        <td class="kb-path" title="${leaf.key}">${leaf.key}</td>
        <td class="kb-default" title="${displayValue}">${displayValue}</td>
        <td><input class="kb-input${changedClass}" data-key="${leaf.key}" data-type="${leaf.value_type}" value="${escHtml(editValue)}" placeholder="= 默认" /></td>
        <td style="display:flex;gap:.3rem;align-items:center">
          <input class="kb-notes-input" data-key="${leaf.key}" data-field="notes" value="${escHtml(leaf.overrideNotes || (kbDirty[leaf.key] ? kbDirty[leaf.key].notes || "" : ""))}" placeholder="备注" />
          <span class="kb-reset-cell" data-key="${leaf.key}" title="恢复默认值">↺</span>
        </td>
      </tr>`;
    }).join("");

    // 绑定事件
    tbody.querySelectorAll(".kb-input[data-key]").forEach(inp => {
      inp.addEventListener("input", () => markDirty(inp.dataset.key, inp.dataset.type, inp.value));
    });
    tbody.querySelectorAll(".kb-notes-input[data-key]").forEach(inp => {
      inp.addEventListener("input", () => {
        const key = inp.dataset.key;
        if (!kbDirty[key]) kbDirty[key] = { value: "", value_type: "number", notes: "" };
        kbDirty[key].notes = inp.value;
      });
    });
    tbody.querySelectorAll(".kb-reset-cell[data-key]").forEach(span => {
      span.addEventListener("click", () => {
        const key = span.dataset.key;
        const leaf = kbLeaves.find(l => l.key === key);
        if (leaf && leaf.isOverridden) {
          // 标记为删除覆盖
          kbDirty[key] = { _delete: true, notes: "重置为默认值" };
          renderKBTable();
          updateKBUI();
        } else if (kbDirty[key]) {
          delete kbDirty[key];
          renderKBTable();
          updateKBUI();
        }
      });
    });
  }

  function markDirty(key, type, rawValue) {
    const leaf = kbLeaves.find(l => l.key === key);
    if (!leaf) return;
    const trimmed = rawValue.trim();
    if (trimmed === "") {
      delete kbDirty[key];
      updateKBUI();
      return;
    }
    let parsed;
    if (type === "number") { parsed = parseFloat(trimmed); if (isNaN(parsed)) { kbDirty[key] = { value: trimmed, value_type: "string", notes: kbDirty[key] ? kbDirty[key].notes || "" : "" }; updateKBUI(); return; } }
    else if (type === "boolean") { parsed = trimmed.toLowerCase() === "true" || trimmed === "1"; }
    else { parsed = trimmed; }
    kbDirty[key] = { value: parsed, value_type: type, notes: kbDirty[key] ? kbDirty[key].notes || "" : "" };
    updateKBUI();
  }

  function updateKBUI() {
    const saveBtn = document.getElementById("kbSaveBtn");
    const resetBtn = document.getElementById("kbResetBtn");
    const badge = document.getElementById("kbOverridesBadge");
    const tableWrap = document.getElementById("kbTableWrap");
    const hint = document.getElementById("kbHint");
    const lockHint = document.getElementById("kbLockHint");
    const auditSec = document.getElementById("kbAuditSection");

    const hasCat = !!kbSelectedCat;

    if (!hasCat) {
      // 未选择类别
      tableWrap.style.display = "none";
      hint.style.display = "";
      if (lockHint) lockHint.style.display = "none";
      auditSec.style.display = "none";
      saveBtn.style.display = "none";
      resetBtn.style.display = "none";
      badge.style.display = "none";
    } else if (!isAdmin) {
      // 选择了类别但未解锁 → 隐藏所有参数，仅显示锁定提示
      tableWrap.style.display = "none";
      hint.style.display = "none";
      if (lockHint) lockHint.style.display = "";
      auditSec.style.display = "none";
      saveBtn.style.display = "none";
      resetBtn.style.display = "none";
      badge.style.display = "none";
    } else {
      // 已解锁 → 正常显示所有内容
      tableWrap.style.display = "";
      hint.style.display = "none";
      if (lockHint) lockHint.style.display = "none";
      auditSec.style.display = "";

      // 显示按钮（仅管理员）
      saveBtn.style.display = "";
      resetBtn.style.display = "";

      const dirtyCount = Object.keys(kbDirty).length;
      const ovCount = kbLeaves.filter(l => l.isOverridden).length;
      badge.style.display = ovCount > 0 ? "" : "none";
      if (ovCount > 0) badge.textContent = ovCount + " 项覆盖";
      if (dirtyCount > 0) saveBtn.textContent = "💾 保存更改 (" + dirtyCount + ")";
      else saveBtn.textContent = "💾 保存更改";
    }
  }

  async function saveKBOverrides() {
    const overrides = Object.entries(kbDirty).map(([key, val]) => ({
      item_key: key,
      value: val.value,
      value_type: val.value_type || "number",
      notes: val.notes || "",
    }));
    if (overrides.length === 0) return;

    try {
      const BASE = cloud.getBase();
      const res = await fetch(BASE + "/api/knowledge/overrides", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-admin-token": adminToken },
        body: JSON.stringify({ category: kbSelectedCat, overrides })
      });
      const data = await res.json();
      if (!res.ok) { alert("保存失败：" + (data.error || res.status)); return; }
      alert("✅ 已保存 " + overrides.length + " 项修改");
      // 重新加载
      await loadKBLeaves(kbSelectedCat);
      await loadKBCategories(); // 刷新类别统计
      // 重新加载知识库覆盖到引擎
      await loadKnowledgeOverrides();
    } catch (e) {
      alert("网络错误：" + e.message);
    }
  }

  async function resetKBCategory() {
    if (!confirm("确定要将「" + (kbCategories.find(c => c.key === kbSelectedCat) || {}).label || kbSelectedCat + "」的所有覆盖值恢复为默认值吗？此操作不可撤销。")) return;
    try {
      const BASE = cloud.getBase();
      const res = await fetch(BASE + "/api/knowledge/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-token": adminToken },
        body: JSON.stringify({ category: kbSelectedCat })
      });
      const data = await res.json();
      if (!res.ok) { alert("重置失败：" + (data.error || res.status)); return; }
      kbDirty = {};
      await loadKBLeaves(kbSelectedCat);
      await loadKBCategories();
      await loadKnowledgeOverrides();
      alert("✅ 已恢复默认值");
    } catch (e) {
      alert("网络错误：" + e.message);
    }
  }

  async function loadKBAudit(category) {
    try {
      const BASE = cloud.getBase();
      const res = await fetch(BASE + "/api/knowledge/audit?category=" + encodeURIComponent(category) + "&limit=20");
      if (!res.ok) return;
      const rows = await res.json();
      const list = document.getElementById("kbAuditList");
      if (rows.length === 0) { list.innerHTML = '<div style="color:hsla(0,0%,100%,.2);padding:.5rem 0">暂无变更记录</div>'; list.classList.add("open"); return; }
      list.innerHTML = rows.map(r => {
        const actionClass = r.action === "delete" ? "del" : r.action === "reset" ? "reset" : "";
        const actionLabel = { create: "新增", update: "修改", delete: "删除", reset: "重置", reset_all: "全部重置" }[r.action] || r.action;
        const time = r.created_at ? r.created_at.replace("T", " ").substring(0, 19) : "";
        return `<div class="kb-audit-item">
          <span class="audit-action ${actionClass}">${actionLabel}</span>
          <span class="audit-key">${r.item_key}</span>
          ${r.notes ? `<span style="color:hsla(0,0%,100%,.3)">${escHtml(r.notes.substring(0, 40))}</span>` : ""}
          <span class="audit-time">${time}</span>
        </div>`;
      }).join("");
      list.classList.add("open");
    } catch (e) { /* 静默 */ }
  }

  function clearKBView() {
    kbLeaves = [];
    kbDirty = {};
    document.getElementById("kbTableBody").innerHTML = "";
    document.getElementById("kbTableWrap").style.display = "none";
    document.getElementById("kbHint").style.display = "";
    const lockHint = document.getElementById("kbLockHint");
    if (lockHint) lockHint.style.display = "none";
    document.getElementById("kbSaveBtn").style.display = "none";
    document.getElementById("kbResetBtn").style.display = "none";
    document.getElementById("kbOverridesBadge").style.display = "none";
    document.getElementById("kbAuditSection").style.display = "none";
  }

  /* ---- 全局：加载知识库覆盖值并应用到引擎 ---- */
  async function loadKnowledgeOverrides() {
    try {
      const BASE = cloud.getBase();
      const res = await fetch(BASE + "/api/knowledge/export");
      if (!res.ok) return;
      const merged = await res.json();
      // 将合并后的知识库应用到全局
      window.RAS_KNOWLEDGE = merged;
      // 同时更新 K 引用（app.js 顶层 const K = window.RAS_KNOWLEDGE 不会自动更新，
      // 但引擎内部使用 window.RAS_KNOWLEDGE 读取，所以覆盖全局即可）
      console.log("[knowledge] 已加载覆盖值（" + Object.keys(merged).length + " 个顶级类别）");
    } catch (e) {
      console.warn("[knowledge] 加载覆盖值失败，使用内置默认:", e.message);
    }
  }

  function initKnowledge() {
    // 类别选择器事件
    const sel = document.getElementById("kbCategorySel");
    if (sel) sel.addEventListener("change", () => {
      kbSelectedCat = sel.value;
      if (kbSelectedCat) loadKBLeaves(kbSelectedCat); else clearKBView();
    });
    // 保存按钮
    const saveBtn = document.getElementById("kbSaveBtn");
    if (saveBtn) saveBtn.addEventListener("click", saveKBOverrides);
    // 重置按钮
    const resetBtn = document.getElementById("kbResetBtn");
    if (resetBtn) resetBtn.addEventListener("click", resetKBCategory);
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    const sv = document.getElementById("sysVersion");
    if (sv && K && K.meta) sv.textContent = K.meta.version;   // 首页版本号跟随系统版本（knowledge.meta.version）
    initTheme(); initSpecies(); initRegionChips(); initTabs(); initMagnetic();
    initModelControls(); initExport(); initOptimizer(); initLibrary(); initLinking(); initSuppliers(); initKnowledge();
    // 统一管理员锁按钮
    const adminLockBtn = document.getElementById("adminLockBtn");
    if (adminLockBtn) adminLockBtn.addEventListener("click", toggleAdmin);
    // 初始化管理员 UI 状态（非管理员时隐藏管理面板 tab）
    updateAdminUI();
    // 加载知识库覆盖值（异步，不阻塞页面渲染）
    loadKnowledgeOverrides();
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
