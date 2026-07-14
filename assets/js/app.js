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
      hint.textContent = `${s.group} · 适温 ${s.tempRange[0]}–${s.tempRange[1]}℃ · FCR ${s.fcr}`;
    };
    sel.addEventListener("change", updHint);
    updHint();
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
      recircTurns: num("turns", 12),
      makeupRate: num("makeup", 1) / 100,
      designTemp: document.getElementById("designTemp").value ? num("designTemp") : null,
      safety: num("safety", 1.15),
    };
  }
  function renderAll(d) {
    renderParams(d); renderPFD(d); renderPID(d); renderBOM(d); renderEcon(d);
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
        metricCard("比水耗", hy.specificWaterUse, "m³/kg", "单位鱼耗新水"),
        metricCard("日循环次数", hy.turns, "次", "系统换水强度"),
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
        metricCard("增氧功率", en.oxyPower, "kW", "制氧/液氧"),
        metricCard("控温功率", en.hvacPower, "kW", "热泵/制冷"),
      ])}
      ${section("建筑规模", "Building", [
        metricCard("养殖区占地", b.tankFootprint, "m²", "含通道"),
        metricCard("设备区", b.equipArea, "m²", "滤池/泵房"),
        metricCard("车间总面积", b.buildingArea, "m²", "含辅助", "brand"),
        metricCard("车间体积", b.buildingVol, "m³", "层高约 6m"),
      ])}
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
      ["增氧系统", "1 套", `供氧 ${ox.o2Supply} kg/h（${ox.type}）`, "氧气锥+LHO"],
      ["CO₂ 脱除塔", "1 座", `${ox.degasserType}`, "填料式"],
      ["循环水泵", "≥2 台", `${hy.recircFlowH} m³/h，一用一备`, "变频"],
      ["紫外消毒", "1 套", "30 mJ/cm²", "在线"],
      ["换热/控温", "1 套", `${d.inputs.temp}℃ 恒温（热泵 COP≈4）`, "按需制冷/加热"],
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
    const capRows = [
      ["养殖池系统", e.capexTanks], ["生物滤池", e.capexBio], ["固废处理", e.capexSolids],
      ["增氧系统", e.capexOxy], ["水泵与管路", e.capexPumps], ["自控与监测", e.capexCtl],
      ["车间土建", e.capexBuilding], ["控温系统", e.capexHvac],
    ];
    const opRows = [
      ["饲料", e.opexFeed], ["苗种", e.opexFinger], ["电费", e.opexElec], ["人工", e.opexLabor], ["维护", e.opexMaint],
    ];
    host.innerHTML = `
      <div class="section-title" style="padding:24px 26px 0">投资估算 (CAPEX)</div>
      <div class="table-wrap" style="padding:14px 26px 6px"><table class="data">
        <thead><tr><th>投资项</th><th class="num">金额</th></tr></thead>
        <tbody>${capRows.map(r => `<tr><td>${r[0]}</td><td class="num">${ec(r[1])}</td></tr>`).join("")}</tbody>
        <tfoot><tr><td>合计 CAPEX</td><td class="num">${ec(e.capexTotal)}</td></tr></tfoot></table></div>
      <div class="section-title" style="padding:8px 26px 0">运营成本估算 (OPEX / 年)</div>
      <div class="table-wrap" style="padding:14px 26px 6px"><table class="data">
        <thead><tr><th>运营成本项</th><th class="num">金额 / 年</th></tr></thead>
        <tbody>${opRows.map(r => `<tr><td>${r[0]}</td><td class="num">${ec(r[1])}</td></tr>`).join("")}</tbody>
        <tfoot><tr><td>合计 OPEX</td><td class="num">${ec(e.opexTotal)}</td></tr></tfoot></table></div>
      <div class="metrics" style="padding:14px 26px 26px">
        ${metricCard("单位鱼生产成本", e.costPerKg, "元/kg", "仅运营成本", "brand")}
        ${metricCard("总投资 CAPEX", (e.capexTotal/10000).toFixed(1), "万元", "含土建与设备", "accent")}
        ${metricCard("年运营成本", (e.opexTotal/10000).toFixed(1), "万元", "全周期", "brand")}
        ${metricCard("出塘尾数", e.harvestNum.toLocaleString(), "尾", "按商品规格")}
      </div>
      <div style="padding:0 26px 26px"><div class="note"><span class="ic">📌</span>
      <div>经济参数为行业经验量级估算（人民币），实际受地区人工/地价/电价/苗种价格影响显著。饲料通常占 OPEX 的 70–80%。</div></div></div>`;
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
      : `放养密度 <b>${v.density}</b> kg/m³ · 日循环 <b>${v.turns}</b> · 池径 <b>Ø${v.tankD}m</b> · 补水 <b>${(v.makeup*100).toFixed(1)}%</b>`;
    const topRows = res.top.map((t, i) => `<tr>
      <td>${i+1}</td><td>${t.yield} t</td><td>${E.rmb(t.capEx)}</td><td>${t.costPerKg} 元/kg</td>
      <td>${t.energy} kWh/kg</td><td>${Math.round(t.area)} m²</td></tr>`).join("");
    host.innerHTML = `
      <div class="section-title" style="padding:18px 26px 0">最优方案（共搜索 ${res.count} 个可行解）</div>
      <div class="metrics" style="padding:14px 26px">
        ${metricCard("决策变量", "—", "", varTxt)}
        ${metricCard("总投资 CAPEX", (b.economics.capexTotal/10000).toFixed(1), "万元", `Δ ${dCapex>=0?"+":""}${(dCapex/10000).toFixed(1)} 万元`, "brand")}
        ${metricCard("比能耗", b.energy.energyIntensity, "kWh/kg", `Δ ${dEnergy} kWh/kg`, "accent")}
        ${metricCard("车间面积", b.building.buildingArea, "m²", `Δ ${dArea>=0?"+":""}${Math.round(dArea)} m²`, "brand")}
        ${metricCard("产能", b.culture.actualYield, "吨/年", "满足目标", "accent")}
        ${metricCard("单位成本", b.economics.costPerKg, "元/kg", "运营成本")}
      </div>
      <div class="section-title" style="padding:8px 26px 0">候选方案 Top 6</div>
      <div class="table-wrap" style="padding:14px 26px 26px"><table class="data">
        <thead><tr><th>#</th><th>产能</th><th>CAPEX</th><th>单位成本</th><th>比能耗</th><th>面积</th></tr></thead>
        <tbody>${topRows}</tbody></table></div>
      <div style="padding:0 26px 26px"><div class="note"><span class="ic">💡</span>
      <div>寻优基于网格搜索：在品种经验区间内遍历决策变量，按约束过滤后取目标最优。生产目标固定时，<b>最低成本</b>与<b>最低能耗</b>通常对应更优的密度/循环组合；<b>最大产能</b>则在给定预算下反推可承受的最大年产量。</div></div></div>`;
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
      <thead><tr><th>方案</th><th class="num">产能</th><th class="num">CAPEX</th><th class="num">比能耗</th><th>操作(选 2 个对比)</th></tr></thead>
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
    document.getElementById("turns").value = inputs.recircTurns;
    document.getElementById("makeup").value = (inputs.makeupRate * 100).toFixed(1);
    document.getElementById("designTemp").value = inputs.designTemp || "";
    document.getElementById("safety").value = inputs.safety;
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
        h1{font-size:24px;border-bottom:3px solid #1e88e5;padding-bottom:8px}h2{font-size:18px;margin-top:28px;color:#1e88e5}
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
    initTheme(); initSpecies(); initTabs(); initMagnetic();
    initModelControls(); initExport(); initOptimizer(); initLibrary(); initLinking();
    document.getElementById("designForm").addEventListener("submit", (e) => {
      e.preventDefault(); compute();
      document.querySelector('#tabs .tab[data-tab="params"]').click();
    });
    compute();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
