/*
 * RAS 工艺计算引擎
 * ----------------------------------------------------------------------------
 * 输入：产能需求 + 设计偏好
 * 输出：结构化工艺设计对象（养殖池 / 水力学 / 生物滤池 / 增氧 / 固废 / 能耗 / 经济）
 *
 * 计算遵循质量守恒与单元设备设计负荷，引用 knowledge.js 中的基准参数。
 */
window.RAS = window.RAS || {};

RAS.engine = (function () {
  const K = window.RAS_KNOWLEDGE;

  const round = (v, d = 1) => {
    const p = Math.pow(10, d);
    return Math.round(v * p) / p;
  };
  const fmt = (v, d = 1) =>
    (typeof v === "number" ? v.toLocaleString("zh-CN", {
      minimumFractionDigits: d, maximumFractionDigits: d,
    }) : v);

  // 淡水溶氧饱和度(mg/L)，Benson & Krause 经验近似（0–40℃）
  const o2Sat = (T) =>
    Math.max(0, 14.652 - 0.41022 * T + 0.007991 * T * T - 0.000077774 * T * T * T);

  /*
   * 主计算函数
   * inputs: {
   *   speciesKey, annualTons, targetDensity?, cycles?, recircTurns?,
   *   makeupRate?, safety?, designTemp?, elecPrice?
   * }
   */
  function compute(inputs) {
    const sp = K.species[inputs.speciesKey] || K.species.bass;
    const annual = inputs.annualTons * 1000;          // kg/年
    const density = inputs.targetDensity || sp.stockingDensity;   // kg/m³
    const cycles = inputs.cycles || sp.cyclesPerYear;
    const turns = inputs.recircTurns || 12;           // 日循环次数
    const makeup = inputs.makeupRate || 0.0075;       // 补水率(占循环量)，默认≈日换水 9%（真实 RAS 5–15%）
    const sf = inputs.safety || 1.15;                 // 安全系数
    const temp = inputs.designTemp || sp.designTemp;
    const elec = inputs.elecPrice || K.economics.opex.elecPrice;
    const salePrice = inputs.salePrice && inputs.salePrice > 0 ? inputs.salePrice : (sp.marketPrice || K.economics.salePrice || 22);

    // —— 1. 养殖池系统 ——
    const tankVolumeNeed = annual / (density * cycles); // m³
    let tankD, tankH;
    if (tankVolumeNeed < 400) { tankD = 6; tankH = 1.4; }
    else if (tankVolumeNeed < 1200) { tankD = 8; tankH = 1.5; }
    else if (tankVolumeNeed < 3000) { tankD = 10; tankH = 1.6; }
    else { tankD = 12; tankH = 1.8; }
    const singleTankVol = Math.PI * Math.pow(tankD / 2, 2) * tankH * 0.9;
    let tankCount = Math.ceil(tankVolumeNeed / singleTankVol);
    const cols = Math.ceil(Math.sqrt(tankCount));
    const rows = Math.ceil(tankCount / cols);
    tankCount = cols * rows;
    const totalTankVol = tankCount * singleTankVol;
    const actualYield = density * cycles * totalTankVol;

    // —— 2. 投喂与氮负荷 ——
    // 饲料系数可由使用者自定义（不同养殖水平差异大），留空/非法时回退品种默认
    const fcr = (inputs.fcr && inputs.fcr > 0) ? inputs.fcr : sp.fcr;
    const annualFeed = annual * fcr;
    const dailyFeedAvg = annualFeed / 365;
    const dailyFeedPeak = dailyFeedAvg * 1.8;
    const tanPerFeed = K.process.tanPerFeed;
    const tanDaily = annualFeed * tanPerFeed / 365;
    const tanAnnual = annualFeed * tanPerFeed;

    // —— 3. 水力学 ——
    const totalSysWater = totalTankVol * 1.15;
    const recircFlow = totalTankVol * turns;
    const recircFlowH = recircFlow / 24;
    const makeupFlow = recircFlow * makeup;
    const makeupFlowH = makeupFlow / 24;
    const specificWaterUse = (makeupFlow * 365) / annual;   // 年补水总量 / 年产量 → m³/kg
    const waterReuse = 1 - makeup;

    // —— 4. 生物滤池 (MBBR) ——
    const bf = K.equipment.biofilter;
    const bfReactorVol = tanDaily / bf.rate;
    const bfReactorVolSf = bfReactorVol * sf;
    const bfTotalVol = bfReactorVolSf / bf.mediaFill;
    const bfUnits = Math.max(2, Math.ceil(bfTotalVol / 40));
    const bfUnitVol = bfTotalVol / bfUnits;

    // —— 5. 增氧与 CO2 脱除 ——
    const ox = K.equipment.oxygen;
    const o2PerFeed = sp.o2PerFeed || ox.o2PerFeed || 1.0;   // 品种相关氧耗系数(kg O2/kg 饲料)
    const o2Daily = dailyFeedAvg * o2PerFeed;
    const o2Peak = dailyFeedPeak * o2PerFeed;
    const o2HourPeak = o2Peak / 24;
    const o2Supply = o2HourPeak / ox.transferEff * sf;
    const deg = K.equipment.degasser;
    const co2Prod = o2Daily * K.process.co2Ratio;
    const co2Hour = co2Prod / 24;

    // —— 6. 固废处理 ——
    const df = K.equipment.drumFilter;
    const tssPerFeed = K.process.tssPerFeed;
    const tssDaily = dailyFeedAvg * tssPerFeed;
    const drumUnits = Math.max(1, Math.ceil(recircFlowH / 300));
    const drumEachFlow = recircFlowH / drumUnits;

    // —— 7. 能耗估算（比能耗系数法，物理可解释；HVAC 随地区气温变化）——
    const pu = K.equipment.pump;
    const pumpQ = recircFlowH / 3600;                                       // m³/s
    const pumpPower = (1000 * 9.81 * pumpQ * pu.head) / (pu.eff * 1000);    // kW（流体力学公式，随流量/扬程）
    const oxyPower = o2Supply * ox.specificEnergy;                          // kW（kWh/kg O2 比能耗）
    const fanPower = co2Hour * deg.fanEnergy;                               // kW（kg/h CO2 × kWh/kg CO2）
    const miscPower = totalTankVol * K.equipment.misc.loadW / 1000;         // kW（杂项 W/m³）
    // 温控负荷（气候相关）：围护传热 + 补水加热 − 内部得热；按制热/制冷分 COP
    const heat = K.equipment.heat, cl = K.climate;
    const amb = (inputs.ambientTemp != null && inputs.ambientTemp !== "" && !isNaN(Number(inputs.ambientTemp)))
      ? Number(inputs.ambientTemp) : cl.defaultAmbient;                    // 地区全年平均气温(℃)
    const lift = temp - amb;                                                // >0 需加热；<0 需制冷
    const bldArea = totalTankVol * K.building.areaPerM3;                    // m² 建筑面积（与第8节一致，内联避免 TDZ）
    const UA = bldArea * heat.uEnvelope;                                    // W/℃ 围护传热系数
    const envelopeW = UA * lift;                                            // 围护得失热(带符号)
    const makeupKgH = makeupFlowH * 1000;                                   // kg/h 补水质量流量（makeupFlowH 为 m³/h）
    const makeupW = makeupKgH * cl.cpWater * lift / 3600;                   // 补水从 amb 加热/冷却到设定温(W)
    const internalW = pumpPower * 1000 * 0.12 + totalTankVol * heat.internalLoadW; // 室内得热(泵损+照明/代谢)
    const rawLoadW = envelopeW + makeupW;                                   // 净热需求(带符号，+需热/−需冷)
    let hvacPower, hvacMode, thermalLoadW;
    if (rawLoadW >= 0) {
      thermalLoadW = Math.max(0, rawLoadW - internalW);                     // 制热：内部得热抵消
      hvacPower = thermalLoadW / 1000 / heat.copHeat;
      hvacMode = "heat";
    } else {
      thermalLoadW = -rawLoadW + internalW;                                 // 制冷：内部得热叠加
      hvacPower = thermalLoadW / 1000 / heat.copCool;
      hvacMode = "cool";
    }
    const totalPower = pumpPower + oxyPower + fanPower + hvacPower + miscPower;
    const energyIntensity = (totalPower * 24 * 365) / annual;
    const annualEnergy = totalPower * 24 * 365 / 1000;

    // —— 8. 建筑面积（按单位养殖水体占地，含通道与辅助用房）——
    const bld = K.building;
    const buildingArea = totalTankVol * bld.areaPerM3;
    const buildingVol = buildingArea * bld.height;
    const tankFootprint = buildingArea * 0.5;
    const equipArea = buildingArea * 0.5;

    // —— 9. 经济估算：投资(CAPEX) ——
    const ec = K.economics;
    const cpx = ec.capexPerM3;
    const cm = ec.capexModel;

    // 9.1 直接费（设备+土建），基准 per-m³/per-m²（参考规模下）
    const capexTanks    = totalTankVol * cpx.tanks;
    const capexBio      = totalTankVol * cpx.biofilter;
    const capexSolids   = totalTankVol * cpx.solids;
    const capexOxy      = totalTankVol * cpx.oxygen;
    const capexDegasser = totalTankVol * cpx.degasser;
    const capexUv       = totalTankVol * cpx.uv;
    const capexPumps    = totalTankVol * cpx.pumps;
    const capexCtl      = totalTankVol * cpx.controls;
    const capexHvac     = totalTankVol * cpx.hvac;
    const capexBuilding = buildingArea * cpx.building;

    // 9.2 规模经济：总投资 ∝ 年产量^scaleExponent（六 tenths 法则，亚线性）
    //     < refAnnualTons 单位投资更高（小规不经济），> refAnnualTons 更省（大规规模效应）
    const annT = Math.max(annual / 1000, 1);
    const scaleFactor = Math.pow(cm.refAnnualTons / annT, 1 - cm.scaleExponent);

    const op = ec.opex;
    // OPEX 单价：表单可自定义覆盖（维护按直接费比例另算，不开放单价）
    const feedPrice = inputs.feedPrice > 0 ? inputs.feedPrice : (sp.feedPrice || op.feedPrice);
    const fingerPrice = inputs.fingerlingPrice > 0 ? inputs.fingerlingPrice : (sp.fingerlingPrice || op.fingerlingPrice);
    const elecPrice = inputs.elecPrice > 0 ? inputs.elecPrice : (elec || op.elecPrice);
    const waterPrice = inputs.waterPrice > 0 ? inputs.waterPrice : (op.waterPrice || 5.0);
    const laborPrice = inputs.laborPerYear > 0 ? inputs.laborPerYear : op.laborPerYear;

    // 9.3 直接费分解（含规模因子）：子项金额由工程量×子单价(缩放)得出，分类额=子项之和（保证对账一致）
    const cdet = ec.capexDetail;
    const directDefs = [
      { key: "tanks", label: "养殖池系统", unit: "m³", qty: totalTankVol, val: capexTanks },
      { key: "biofilter", label: "生物滤池(MBBR)", unit: "m³", qty: totalTankVol, val: capexBio },
      { key: "solids", label: "固废处理(微滤机)", unit: "m³", qty: totalTankVol, val: capexSolids },
      { key: "oxygen", label: "增氧系统", unit: "m³", qty: totalTankVol, val: capexOxy },
      { key: "degasser", label: "CO₂ 脱气塔", unit: "m³", qty: totalTankVol, val: capexDegasser },
      { key: "uv", label: "紫外消毒(UV)", unit: "m³", qty: totalTankVol, val: capexUv },
      { key: "pumps", label: "水泵与管路", unit: "m³", qty: totalTankVol, val: capexPumps },
      { key: "controls", label: "自控与监测", unit: "m³", qty: totalTankVol, val: capexCtl },
      { key: "hvac", label: "控温系统(热泵)", unit: "m³", qty: totalTankVol, val: capexHvac },
      { key: "building", label: "车间土建", unit: "m²", qty: buildingArea, val: capexBuilding },
    ];
    const directRows = directDefs.map((c) => {
      const subs = cdet[c.key].subs.map((s) => ({
        label: s[0], rate: round(s[1] * scaleFactor), amount: round(c.qty * s[1] * scaleFactor),
      }));
      const total = subs.reduce((a, x) => a + x.amount, 0);
      return { key: c.key, label: c.label, unit: c.unit, qty: round(c.qty), subs, total, indirect: false };
    });
    const capexDirect = directRows.reduce((a, c) => a + c.total, 0);

    // 9.4 OPEX（维护费基数改为直接费，更贴合实际维护对象）
    const opexFeed = annualFeed * feedPrice;
    const harvestNum = annual / (sp.harvestSize / 1000);
    const opexFinger = harvestNum * fingerPrice;
    const opexElec = annualEnergy * 1000 * elecPrice;
    const opexLabor = laborPrice * op.laborCount;
    const opexMaint = capexDirect * op.maintenanceRate;
    const opexWater = makeupFlow * 365 * waterPrice;   // 生产补水费（补水流量 × 年 × 水价）
    const opexTotal = opexFeed + opexFinger + opexElec + opexLabor + opexMaint + opexWater;
    const costPerKg = opexTotal / annual;

    // 9.5 间接费（按直接费比例，合计上限 = 直接费 × indirectCap）
    const capexEpcm = capexDirect * cm.indirect.epcm;
    const capexCommissioning = capexDirect * cm.indirect.commissioning;
    const capexContingency = capexDirect * cm.indirect.contingency;
    const capexOther = capexDirect * cm.indirect.other;
    const capexIndirectRaw = capexEpcm + capexCommissioning + capexContingency + capexOther;
    const indirectCapAmt = capexDirect * (cm.indirectCap != null ? cm.indirectCap : 0.25);
    const indirectScale = capexIndirectRaw > 0 ? Math.min(1, indirectCapAmt / capexIndirectRaw) : 1;
    const capexIndirect = capexIndirectRaw * indirectScale;

    // 9.6 土地(可选)；营运资金已取消，不再计入总投资
    const capexLand = inputs.landCost > 0 ? inputs.landCost : (cm.landDefault || 0);

    const indirectDefs = [
      { key: "epcm", label: "设计/采购/施工管理(EPCM)", rate: cm.indirect.epcm, val: capexEpcm },
      { key: "commissioning", label: "调试与培训", rate: cm.indirect.commissioning, val: capexCommissioning },
      { key: "contingency", label: "不可预见费", rate: cm.indirect.contingency, val: capexContingency },
      { key: "other", label: "许可/环评等其他费", rate: cm.indirect.other, val: capexOther },
    ];
    const indirectRows = indirectDefs.map((c) => ({
      key: c.key, label: c.label, unit: "", qty: "—", indirect: true,
      subs: [{ label: `按直接费 × ${(c.rate * 100).toFixed(0)}%${indirectScale < 1 ? "（已封顶25%）" : ""}`, rate: 0, amount: round(c.val * indirectScale) }],
      total: round(c.val * indirectScale),
    }));
    const landRow = capexLand > 0 ? [{
      key: "land", label: "土地费(可选)", unit: "", qty: "—", indirect: true,
      subs: [{ label: "用户指定 landCost", rate: 0, amount: round(capexLand) }], total: round(capexLand),
    }] : [];
    // 9.7 分项小计：直接费子项合计 + 间接费子项合计（各自独立，不合并）
    const directSubtotalRow = [{
      key: "direct_subtotal", label: "直接费子项合计", unit: "", qty: "—", indirect: false, subtotal: true, subKind: "direct",
      subs: [], total: round(capexDirect),
    }];
    const indirectSubtotalRow = [{
      key: "indirect_subtotal", label: "间接费子项合计", unit: "", qty: "—", indirect: true, subtotal: true, subKind: "indirect",
      subs: [], total: round(capexIndirect),
    }];
    const capexCostRows = [...directRows, ...directSubtotalRow, ...indirectRows, ...indirectSubtotalRow, ...landRow];
    const capexBreakdown = capexCostRows;          // 小计行仅供阅读，不计入总额
    const capexTotal = capexCostRows.filter((c) => !c.subtotal).reduce((a, c) => a + c.total, 0);

    /* —— 盈利 / 投资回报 —— */
    const revenue = annual * salePrice;                                  // 元/年
    const grossProfit = revenue - opexTotal;                             // 元/年（未计折旧/财务）
    const profitPerKg = annual > 0 ? grossProfit / annual : 0;          // 元/kg
    const paybackYears = grossProfit > 0 ? capexTotal / grossProfit : null;   // 简单回收期(年)
    const roi = capexTotal > 0 ? (grossProfit / capexTotal) * 100 : null;      // 年化 ROI(%)
    const marginRate = revenue > 0 ? (grossProfit / revenue) * 100 : null;     // 毛利率(%)

    /* —— 水质可行性闭环校核（稳态质量平衡：一阶去除 + 补水稀释） —— */
    const wq = K.waterQuality;
    const tanHard = Math.min(wq.tanMax, sp.tanMax || wq.tanMax);
    const no2Hard = wq.no2Max;
    const doMinV = Math.min(wq.doMin, sp.doMin || wq.doMin);
    const kTan = (bf.rate * 1000) / tanHard;   // 1/d：在设计阈值浓度下达设计负荷
    const kNo2 = (bf.rate * 1000) / no2Hard;
    const denomBf = (k) => k * bfReactorVolSf + makeupFlow;
    const cTan = (tanDaily * 1000) / denomBf(kTan);
    const cNo2 = (tanDaily * 1000) / denomBf(kNo2);
    const cNo3 = makeupFlow > 0 ? (4.43 * tanDaily * 1000) / makeupFlow : 9999; // 仅随补水交换去除
    const cCo2 = (co2Prod * 1000) / (deg.co2Removal * recircFlow + makeupFlow);
    const cTss = (tssDaily * 1000) / (df.tssRemoval * recircFlow + makeupFlow);
    const o2SatV = o2Sat(temp);
    const o2DemandH = (o2Peak + 4.57 * tanDaily) / 24;   // kg/h：鱼代谢 + 硝化耗氧(峰值)
    const o2Margin = o2DemandH > 0 ? (o2Supply - o2DemandH) / o2DemandH * 100 : 999;
    const doTarget = Math.min(doMinV + 1.5, o2SatV);
    const st = (v, hard, soft, lowerBetter) => lowerBetter
      ? (v > hard ? "fail" : v > soft ? "warn" : "ok")
      : (v < hard ? "fail" : v < soft ? "warn" : "ok");
    const checks = [
      { key: "tan", name: "总氨氮 TAN", value: round(cTan, 2), unit: "mg/L", limit: tanHard, status: st(cTan, tanHard, tanHard * 1.5, true), note: "生物滤池硝化 + 补水稀释" },
      { key: "no2", name: "亚硝态氮 NO₂", value: round(cNo2, 2), unit: "mg/L", limit: no2Hard, status: st(cNo2, no2Hard, no2Hard * 1.5, true), note: "二级硝化" },
      { key: "no3", name: "硝态氮 NO₃", value: round(cNo3, 0), unit: "mg/L", limit: 500, status: st(cNo3, 500, wq.no3SoftCap, true), note: "仅随补水交换，需排换水或反硝化" },
      { key: "co2", name: "二氧化碳 CO₂", value: round(cCo2, 1), unit: "mg/L", limit: wq.co2Max * 2, status: st(cCo2, wq.co2Max * 2, wq.co2Max, true), note: "脱气塔 + 补水，敏感品种需加大脱气" },
      { key: "tss", name: "悬浮固体 TSS", value: round(cTss, 1), unit: "mg/L", limit: wq.ssMax, status: st(cTss, wq.ssMax, wq.ssMax * 1.5, true), note: "微滤机去除" },
      { key: "do", name: "溶氧 DO", value: round(doTarget, 1), unit: "mg/L", limit: doMinV, status: o2DemandH > o2Supply ? "fail" : "ok", note: "供氧余量 " + round(o2Margin, 0) + "%" },
    ];
    const wqStatus = checks.some((c) => c.status === "fail") ? "fail"
      : (checks.some((c) => c.status === "warn") ? "warn" : "ok");
    const waterQuality = {
      checks, status: wqStatus, feasible: wqStatus !== "fail",
      o2Margin: round(o2Margin, 0), o2Sat: round(o2SatV, 1), doTarget: round(doTarget, 1),
    };

    return {
      species: sp,
      inputs: { annual, density, cycles, turns, makeup, sf, temp, elec, fcr, salePrice,
        feedPrice: inputs.feedPrice || null, fingerlingPrice: inputs.fingerlingPrice || null,
        elecPrice: inputs.elecPrice || null, waterPrice: inputs.waterPrice || null,
        laborPerYear: inputs.laborPerYear || null },
      culture: {
        tankVolumeNeed: round(tankVolumeNeed),
        tankD, tankH,
        singleTankVol: round(singleTankVol),
        tankCount, cols, rows,
        totalTankVol: round(totalTankVol),
        actualYield: round(actualYield / 1000, 1),
        density, cycles,
        yieldPerM3Year: round(density * cycles),
      },
      feeding: {
        fcr, annualFeed: round(annualFeed),
        dailyFeedAvg: round(dailyFeedAvg),
        dailyFeedPeak: round(dailyFeedPeak),
        tanDaily: round(tanDaily, 2),
        tanAnnual: round(tanAnnual),
      },
      hydraulics: {
        totalSysWater: round(totalSysWater),
        recircFlow: round(recircFlow),
        recircFlowH: round(recircFlowH),
        makeupFlow: round(makeupFlow, 1),
        makeupFlowH: round(makeupFlowH, 2),
        specificWaterUse: round(specificWaterUse, 4),
        waterReuse: round(waterReuse * 100),
        turns,
      },
      biofilter: {
        type: bf.type, rate: bf.rate,
        reactorVol: round(bfReactorVol, 1),
        reactorVolSf: round(bfReactorVolSf, 1),
        totalVol: round(bfTotalVol, 1),
        units: bfUnits, unitVol: round(bfUnitVol, 1),
        mediaFill: bf.mediaFill,
      },
      oxygen: {
        type: ox.type,
        o2Daily: round(o2Daily, 1),
        o2Peak: round(o2Peak, 1),
        o2HourPeak: round(o2HourPeak, 1),
        o2Supply: round(o2Supply, 1),
        co2Hour: round(co2Hour, 1),
        degasserType: deg.type,
      },
      solids: {
        drumType: df.type, screen: df.screen,
        tssDaily: round(tssDaily, 1),
        units: drumUnits, eachFlow: round(drumEachFlow),
      },
      energy: {
        pumpPower: round(pumpPower, 1),
        oxyPower: round(oxyPower, 1),
        fanPower: round(fanPower, 1),
        hvacPower: round(hvacPower, 1),
        hvacMode: hvacMode,
        thermalLoadW: round(thermalLoadW),
        ambientTemp: amb,
        miscPower: round(miscPower, 1),
        totalPower: round(totalPower, 1),
        energyIntensity: round(energyIntensity, 2),
        annualEnergy: round(annualEnergy, 1),
      },
      building: {
        tankFootprint: round(tankFootprint),
        equipArea: round(equipArea),
        buildingArea: round(buildingArea),
        buildingVol: round(buildingVol),
      },
      economics: {
        scaleFactor: round(scaleFactor, 3),
        capexTanks: round(capexTanks),
        capexBio: round(capexBio),
        capexSolids: round(capexSolids),
        capexOxy: round(capexOxy),
        capexDegasser: round(capexDegasser),
        capexUv: round(capexUv),
        capexPumps: round(capexPumps),
        capexCtl: round(capexCtl),
        capexBuilding: round(capexBuilding),
        capexHvac: round(capexHvac),
        capexDirect: round(capexDirect),
        capexEpcm: round(capexEpcm),
        capexCommissioning: round(capexCommissioning),
        capexContingency: round(capexContingency),
        capexOther: round(capexOther),
        capexIndirect: round(capexIndirect),
        capexLand: round(capexLand),
        capexTotal: round(capexTotal),
        opexFeed: round(opexFeed),
        opexFinger: round(opexFinger),
        opexElec: round(opexElec),
        opexLabor: round(opexLabor),
        opexMaint: round(opexMaint),
        opexWater: round(opexWater),
        opexTotal: round(opexTotal),
        costPerKg: round(costPerKg, 1),
        capexBreakdown,
        harvestNum: Math.round(harvestNum),
        salePrice, revenue: round(revenue), grossProfit: round(grossProfit),
        profitPerKg: round(profitPerKg, 1),
        paybackYears, roi: roi != null ? round(roi, 1) : null,
        marginRate: marginRate != null ? round(marginRate, 1) : null,
      },
      waterQuality,
      _raw: { annual, density, cycles, turns, makeup, sf, temp, elec, sp },
    };
  }

  /* ============== 智能寻优求解器 ==============
   * opts: {
   *   speciesKey, annualTons, designTemp?,
   *   constraints: { maxBudget?(万元), maxArea?(m²), maxEnergy?(kWh/kg), maxDiameter?(m) },
   *   objective: 'minCost' | 'minEnergy' | 'maxCapacity'
   * }
   * 返回 { ok, baseline, best, vars, top[], count, reason? }
   */
  function range(a, b, step) {
    const out = [];
    for (let v = a; v <= b + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
    return out;
  }

  function optimize(opts) {
    const sp = K.species[opts.speciesKey] || K.species.bass;
    const c = opts.constraints || {};
    const obj = opts.objective || "minCost";
    const baseline = compute({
      speciesKey: opts.speciesKey, annualTons: opts.annualTons, designTemp: opts.designTemp,
    });

    const feasible = (d) => {
      if (c.maxBudget && d.economics.capexTotal > c.maxBudget * 10000) return false;
      if (c.maxArea && d.building.buildingArea > c.maxArea) return false;
      if (c.maxEnergy && d.energy.energyIntensity > c.maxEnergy) return false;
      if (c.maxDiameter && d.culture.tankD > c.maxDiameter) return false;
      return true;
    };

    let candidates = [];

    if (obj === "maxCapacity") {
      // 给定预算(或面积/能耗)，搜索可承受的最大年产量
      const dens = sp.stockingDensity;
      const turns = 12;
      for (let p = 10; p <= 2000; p += 10) {
        const d = compute({ speciesKey: opts.speciesKey, annualTons: p, designTemp: opts.designTemp });
        if (!feasible(d)) continue;
        candidates.push({ d, cost: d.economics.capexTotal, energy: d.energy.energyIntensity,
          area: d.building.buildingArea, vars: { annualTons: p, density: dens, turns } });
      }
    } else {
      // 固定产量，搜索密度/循环/池径/补水/FCR/安全系数，按目标最小化
      const densList = range(sp.stockingDensity * 0.7, sp.stockingDensity * 1.25, 5);
      const turnsList = [6, 8, 10, 12, 14, 16, 18, 20];
      const diamList = [6, 8, 10, 12];
      const makeList = [0.005, 0.01, 0.02, 0.03];
      const fcrBase = sp.fcr;
      const fcrList = range(fcrBase * 0.85, fcrBase * 1.15, 0.15); // FCR 纳入决策变量
      const sfList = [1.1, 1.2, 1.3];                              // 安全系数纳入决策变量
      for (const density of densList)
        for (const turns of turnsList)
          for (const D of diamList)
            for (const mk of makeList)
              for (const fcr of fcrList)
                for (const sf of sfList) {
                  const d = compute({
                    speciesKey: opts.speciesKey, annualTons: opts.annualTons,
                    targetDensity: density, recircTurns: turns, makeupRate: mk,
                    fcr, safety: sf, designTemp: opts.designTemp,
                  });
                  if (!feasible(d)) continue;
                  candidates.push({
                    d, cost: d.economics.capexTotal, energy: d.energy.energyIntensity,
                    area: d.building.buildingArea,
                    vars: { density, turns, tankD: D, makeup: mk, fcr, sf },
                  });
                }
    }

    if (!candidates.length) {
      const reasons = [];
      if (c.maxBudget) reasons.push(`预算≤${c.maxBudget}万元`);
      if (c.maxArea) reasons.push(`面积≤${c.maxArea}m²`);
      if (c.maxEnergy) reasons.push(`能耗≤${c.maxEnergy}kWh/kg`);
      return { ok: false, baseline, reason: "无满足约束的方案，请放宽 " + (reasons.join(" / ") || "约束") };
    }

    // 成本-能耗 Pareto 前沿：按成本升序扫描，能耗取历史最优即非支配集（O(n log n)）
    const sorted = candidates.slice().sort((a, b) => a.cost - b.cost || a.energy - b.energy);
    let bestE = Infinity;
    const pareto = [];
    for (const c2 of sorted) {
      if (c2.energy < bestE - 1e-9) { pareto.push(c2); bestE = c2.energy; }
    }
    pareto.sort((a, b) => a.cost - b.cost);

    let chosen;
    if (obj === "minEnergy") chosen = candidates.slice().sort((a, b) => a.energy - b.energy)[0];
    else if (obj === "maxCapacity") chosen = candidates.slice().sort((a, b) => b.d._raw.annual - a.d._raw.annual)[0];
    else if (obj === "pareto") chosen = pareto.length ? pareto[0] : candidates[0];
    else chosen = candidates.slice().sort((a, b) => a.cost - b.cost)[0];
    const best = chosen.d;
    const vars = chosen.vars;

    const topN = (arr) => arr.slice(0, 6).map((cand) => ({
      yield: cand.d.culture.actualYield,
      capEx: cand.d.economics.capexTotal,
      costPerKg: cand.d.economics.costPerKg,
      energy: cand.d.energy.energyIntensity,
      area: cand.d.building.buildingArea,
      payback: cand.d.economics.paybackYears,
      vars: cand.vars,
    }));
    const top = obj === "pareto" ? topN(pareto) : topN(candidates);

    // 可行解成本-能耗云（降采样，供散点图展示设计空间形态）
    const cloudStep = Math.max(1, Math.floor(candidates.length / 500));
    const cloud = [];
    for (let i = 0; i < candidates.length; i += cloudStep) {
      cloud.push({ cost: candidates[i].cost, energy: candidates[i].energy });
    }

    return {
      ok: true, baseline, best, vars, top,
      pareto: pareto.map((c) => ({
        cost: c.cost, energy: c.energy, area: c.area, vars: c.vars,
        costPerKg: c.d.economics.costPerKg, payback: c.d.economics.paybackYears,
      })),
      cloud,
      count: candidates.length, paretoCount: pareto.length,
    };
  }

  /* ============== 敏感度 / What-if 分析（龙卷风图数据） ==============
   * d: compute() 返回的设计对象
   * opts.metric: 'costPerKg' | 'energyIntensity' | 'grossProfit'
   * 固定其他因素，将各驱动参数在基线 ±pct 扰动，输出所选指标的变化区间。
   */
  function toInputsFromDesign(d) {
    return {
      speciesKey: (d.species && d.species.key) || "bass",
      annualTons: d._raw.annual / 1000,
      targetDensity: d.inputs.density,
      cycles: d.inputs.cycles,
      recircTurns: d.inputs.turns,
      makeupRate: d.inputs.makeup,
      designTemp: d.inputs.temp,
      safety: d.inputs.sf,
      fcr: d.inputs.fcr,
      salePrice: d.inputs.salePrice,
      elecPrice: d.inputs.elec,
      feedPrice: d.inputs.feedPrice || null,
      fingerlingPrice: d.inputs.fingerlingPrice || null,
      waterPrice: d.inputs.waterPrice || null,
      laborPerYear: d.inputs.laborPerYear || null,
    };
  }
  function pickMetric(d, metric) {
    if (metric === "energyIntensity") return d.energy.energyIntensity;
    if (metric === "grossProfit") return d.economics.grossProfit;
    return d.economics.costPerKg;
  }
  function sensitivity(d, opts) {
    opts = opts || {};
    const metric = opts.metric || "costPerKg";
    const baseVal = pickMetric(d, metric);
    const base = toInputsFromDesign(d);
    const eff = d.inputs;
    const drivers = [
      { label: "放养密度", effKey: "density", setKey: "targetDensity", pct: 0.2 },
      { label: "日循环次数", effKey: "turns", setKey: "recircTurns", pct: 0.2 },
      { label: "补水率", effKey: "makeup", setKey: "makeupRate", pct: 0.5 },
      { label: "饲料系数 FCR", effKey: "fcr", setKey: "fcr", pct: 0.2 },
      { label: "安全系数", effKey: "sf", setKey: "safety", pct: 0.2 },
    ];
    // 售价仅影响利润类指标；对成本/能耗指标纳入会产生恒为 0 的误导跨度，故仅 grossProfit 时列入
    if (metric === "grossProfit") {
      drivers.push({ label: "预估鱼价", effKey: "salePrice", setKey: "salePrice", pct: 0.2 });
    }
    const rows = drivers.map((dr) => {
      const v0 = eff[dr.effKey];
      if (v0 == null || isNaN(v0)) return { label: dr.label, low: baseVal, high: baseVal, span: 0 };
      const low = pickMetric(compute(Object.assign({}, base, { [dr.setKey]: v0 * (1 - dr.pct) })), metric);
      const high = pickMetric(compute(Object.assign({}, base, { [dr.setKey]: v0 * (1 + dr.pct) })), metric);
      return { label: dr.label, low, high, span: Math.abs(high - low) };
    });
    rows.sort((a, b) => b.span - a.span);
    return {
      baseVal, metric,
      unit: metric === "grossProfit" ? "元" : metric === "energyIntensity" ? "kWh/kg" : "元/kg",
      drivers: rows,
    };
  }

  /* ============== 引擎自检（可盈利方案 golden case + 一致性断言） ==============
   * 返回 { golden, checks[], pass, summary }
   * 用途：验证引擎逻辑自洽，并提供一个"默认即可盈利"的代表方案。
   * golden case：加州鲈鱼 100t/年，RAS 精品批发价中值 45 元/kg（塘头 28、精品 55–68），
   *   配置经扫描确认可盈利且水质不严重超标，作为引擎正确性基准用例。
   */
  function selfCheck() {
    const golden = compute({
      speciesKey: "bass", annualTons: 100, salePrice: 45,
      targetDensity: 60, recircTurns: 12, makeupRate: 0.02, fcr: 1.20, safety: 1.15,
    });
    const e = golden.economics, wq = golden.waterQuality;
    const checks = [];
    const A = (name, cond, detail) => checks.push({ name, pass: !!cond, detail: detail == null ? "" : String(detail) });

    // —— 盈利性 ——
    A("年毛利为正", e.grossProfit > 0, "毛利 " + e.grossProfit + " 元");
    A("毛利率 > 10%", e.marginRate > 10, "毛利率 " + e.marginRate + "%");
    A("投资回收期 < 15 年", e.paybackYears != null && e.paybackYears < 15, "回收期 " + (e.paybackYears != null ? e.paybackYears.toFixed(1) : "—") + " 年");
    A("年化 ROI 为正", e.roi != null && e.roi > 0, "ROI " + e.roi + "%");

    // —— 水质可行性 ——
    A("水质未超限(fail)", wq.status !== "fail", "WQ=" + wq.status);
    A("供氧余量 > 0", wq.o2Margin > 0, "o2Margin " + wq.o2Margin + "%");
    A("TAN/NO2/DO 核心指标达标", wq.checks.filter((c) => ["tan", "no2", "do"].includes(c.key)).every((c) => c.status === "ok"), "三项核心指标均 ok");

    // —— 内部一致性（对账 + 公式）——
    let catSum = 0, subRecon = true;
    e.capexBreakdown.forEach((c) => {
      if (c.subtotal) return;   // 小计行仅展示用，不参与对账与总额
      const s = c.subs.reduce((a, x) => a + x.amount, 0);
      if (Math.abs(s - c.total) > 1) subRecon = false;
      catSum += c.total;
    });
    A("CAPEX 子项合计=分类额(容差1元)", subRecon, "");
    A("CAPEX 分类合计=CAPEX 总额(容差8元)", Math.abs(catSum - e.capexTotal) <= 8, "分类和 " + catSum + " / 总额 " + e.capexTotal);

    // 水费公式（用 round 后的补水流量估算，容差 2000 元）
    const expectWater = golden.hydraulics.makeupFlow * 365 * 5;
    A("水费 = 补水×365×水价", Math.abs(e.opexWater - expectWater) < 2000, "实际 " + e.opexWater + " / 估算 " + Math.round(expectWater));

    // 盈利三公式
    if (e.grossProfit > 0) {
      A("回收期 = CAPEX/毛利", Math.abs(e.paybackYears - e.capexTotal / e.grossProfit) < 0.01, "");
      A("ROI = 毛利/CAPEX×100", Math.abs(e.roi - e.grossProfit / e.capexTotal * 100) < 0.2, "");
    }
    if (e.revenue > 0) A("毛利率 = 毛利/营收×100", Math.abs(e.marginRate - e.grossProfit / e.revenue * 100) < 0.2, "");

    // 多品种默认盈利（高价品种应直接可盈利且水质不 fail，证明引擎可产出盈利方案）
    const multiOk = ["salmon", "trout", "turbot"].every((sk) => {
      const d = compute({ speciesKey: sk, annualTons: 100 });
      return d.economics.grossProfit > 0 && d.waterQuality.status !== "fail";
    });
    A("鲑/鳟/鲆 默认市场价下均可盈利且水质不 fail", multiOk, "");

    // 无 NaN / 有限数
    const finite = [e.capexTotal, e.opexTotal, e.costPerKg, e.revenue, e.grossProfit, e.paybackYears, e.roi, e.marginRate]
      .every((v) => v == null || (typeof v === "number" && isFinite(v)));
    A("经济数值均为有限数(无 NaN)", finite, "");

    const pass = checks.every((c) => c.pass);
    return {
      golden, checks, pass,
      summary: {
        species: "加州鲈鱼", scale: "100 t/年", salePrice: 45,
        capex: e.capexTotal, opex: e.opexTotal, costPerKg: e.costPerKg,
        revenue: e.revenue, grossProfit: e.grossProfit, marginRate: e.marginRate,
        paybackYears: e.paybackYears, roi: e.roi, wqStatus: wq.status,
      },
    };
  }

  // 经济数值格式化（人民币）
  function rmb(v) {
    if (v >= 10000) return (v / 10000).toLocaleString("zh-CN", { maximumFractionDigits: 1 }) + " 万元";
    return Math.round(v).toLocaleString("zh-CN") + " 元";
  }

  return { compute, optimize, sensitivity, selfCheck, round, fmt, rmb };
})();
