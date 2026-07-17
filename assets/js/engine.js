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
    // P2-2 海水/淡水分机制：水体密度(影响泵功)、溶氧饱和度因子(海水更低)、材质溢价(海水耐腐蚀)
    const swDensity = sp.waterDensity || 1000;
    const o2SatFactor = sp.o2SatFactor || 1;
    const matlFactor = sp.matlFactor || 1;
    // 地区索引（P2-9）：region 决定 CAPEX/电价/人工地区系数；ambient 优先 inputs，否则回退 region 气温
    const regionKey = inputs.region && K.climate.regions[inputs.region] ? inputs.region : null;
    const regionDef = regionKey ? K.climate.regions[regionKey] : null;
    const regCost = regionDef && regionDef.costIndex != null ? regionDef.costIndex : 1;
    const regPower = regionDef && regionDef.powerIndex != null ? regionDef.powerIndex : 1;
    const regLabor = regionDef && regionDef.laborIndex != null ? regionDef.laborIndex : 1;
    const annual = inputs.annualTons * 1000;          // kg/年
    const density = inputs.targetDensity || sp.stockingDensity;   // kg/m³
    const cycles = inputs.cycles || sp.cyclesPerYear;
    const turns = inputs.recircTurns || K.defaults.recircTurns;       // 日循环次数
    const makeup = inputs.makeupRate != null && inputs.makeupRate > 0 ? inputs.makeupRate : K.defaults.makeupRate; // 补水率(占循环量)
    const sf = inputs.safety || K.defaults.safety;                 // 安全系数
    const temp = inputs.designTemp || sp.designTemp;
    const elec = inputs.elecPrice > 0 ? inputs.elecPrice : (K.economics.opex.elecPrice * regPower);
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
    const dailyFeedPeak = dailyFeedAvg * K.process.peakFeedFactor;
    // P1-6 饲料蛋白消化率联动排泄（v1.7.0）：消化率越高→可排泄氮比例越低（高蛋白低消化率不再被低估）
    const dig = sp.proteinDigestibility != null ? sp.proteinDigestibility : 0.85;
    const digRef = K.process.nExcretionRef != null ? K.process.nExcretionRef : 0.85;
    const nFrac = (K.process.nExcretionFraction != null ? K.process.nExcretionFraction : 0.5) * (digRef / dig);
    // P0-2：TAN 由饲料蛋白推导（v1.5.0）：TAN = 蛋白 × 0.16(氮含量) × 排泄比例(消化率联动)
    const tanPerFeed = (sp.feedProtein || 0.45) * 0.16 * nFrac;
    const tanDaily = annualFeed * tanPerFeed / 365;
    const tanAnnual = annualFeed * tanPerFeed;

    // —— 3. 水力学 ——
    const totalSysWater = totalTankVol * K.process.sysWaterFactor;
    const recircFlow = totalTankVol * turns;
    const recircFlowH = recircFlow / 24;
    const makeupFlow = recircFlow * makeup;
    const makeupFlowH = makeupFlow / 24;
    const specificWaterUse = (makeupFlow * 365) / annual;   // 年补水总量 / 年产量 → m³/kg
    const waterReuse = 1 - makeup;

    // P1-3 水足迹闭合（v1.7.0）：取水 = 蒸发损失 + 排污(bleed)；校验补水率是否覆盖蒸发（否则池面下降告警）
    const evapRateP13 = (K.equipment.heat.evapRate) * (temp / (K.equipment.heat.evapTempRef || 25));
    const waterSurfaceArea = totalTankVol / tankH;
    const evapKgH = waterSurfaceArea * evapRateP13;                 // kg/h 开放池面蒸发量
    const evapVolYr = evapKgH * 24 * 365 / 1000;                    // m³/年 蒸发损失
    const makeupVolYr = makeupFlow * 365;                           // m³/年 补水量(=取水)
    const bleedVolYr = Math.max(0, makeupVolYr - evapVolYr);        // m³/年 排污(bleed) = 补水 − 蒸发
    const recircVolYr = recircFlow * 365;                           // m³/年 循环量
    const evapFracOfRecirc = recircVolYr > 0 ? evapVolYr / recircVolYr : (makeup + 1); // 蒸发占循环量比例
    const evapCovered = evapFracOfRecirc <= makeup;                 // 补水率是否覆盖蒸发(否则池面下降)
    const waterFootprint = specificWaterUse;                       // m³/kg（=取水/产量）

    // —— 4. 生物滤池 (MBBR) ——
    const bf = K.equipment.biofilter;
    // P0-3 两段硝化（v1.6.0）：温度修正速率。AOB(亚硝化)为限速步用于定容；NOB(硝化)更快用于 NO₂ 稳态
    const nitrTheta = bf.nitrTheta != null ? bf.nitrTheta : 1.08;
    const nitrRate = bf.rate * Math.pow(nitrTheta, temp - 25);                  // AOB 限速步：生物滤池定容
    const rNitrit = (bf.rateNitritation != null ? bf.rateNitritation : bf.rate) * Math.pow(nitrTheta, temp - 25); // TAN→NO₂
    const rNitrat = (bf.rateNitratation != null ? bf.rateNitratation : bf.rate) * Math.pow(nitrTheta, temp - 25); // NO₂→NO₃
    const bfReactorVol = tanDaily / nitrRate;
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
    // P0-1 溶氧闭环（v1.6.0）：供氧能力按「峰值鱼代谢 + 硝化耗氧」定容(含安全系数)，确保池内可达 DO
    const nitrifO2Daily = K.process.nitrifO2 * tanDaily;       // kg/天 硝化耗氧
    const o2DemandH = (o2Peak + nitrifO2Daily) / 24;          // kg/h 峰值总氧耗(鱼代谢 + 硝化)
    const o2Supply = o2DemandH / ox.transferEff * sf;         // 设计供氧能力(覆盖鱼代谢+硝化，含 SF)
    const deg = K.equipment.degasser;
    const co2Prod = o2Daily * K.process.co2Ratio;
    const co2Hour = co2Prod / 24;

    // —— 6. 固废处理 ——
    const df = K.equipment.drumFilter;
    const tssPerFeed = K.process.tssPerFeed;
    const tssDaily = dailyFeedAvg * tssPerFeed;
    const drumUnits = Math.max(1, Math.ceil(recircFlowH / 300));
    const drumEachFlow = recircFlowH / drumUnits;
    // P1-4 固废处置能耗与成本（v1.7.0）：脱水/外运/堆肥比能耗计入总能耗，处置单价计入 OPEX
    const solidsDisposalEnergy = K.process.solidsDisposalEnergy != null ? K.process.solidsDisposalEnergy : 0; // kWh/kg 干固
    const solidsDisposalPrice = K.economics.opex.solidsDisposalPrice != null ? K.economics.opex.solidsDisposalPrice : 0; // 元/kg 干固
    const solidsDailyKwh = tssDaily * solidsDisposalEnergy;   // kWh/天
    const solidsPower = solidsDailyKwh / 24;                 // kW（平均）
    const solidsAnnualKwh = solidsDailyKwh * 365;            // kWh/年
    const opexSolids = tssDaily * 365 * solidsDisposalPrice; // 元/年

    // —— 7. 能耗估算（比能耗系数法，物理可解释；HVAC 随地区气温变化）——
    const pu = K.equipment.pump;
    const pumpQ = recircFlowH / 3600;                                       // m³/s
    // P1-5 泵实际扬程/管路阻力法（达西–魏斯巴赫，v1.7.0）：H = 提升高度 + 沿程(hf) + 局部(hm)
    const g9 = 9.81, nuW = 1.0e-6;                                          // g, 水运动粘度
    const pD = pu.pipeDiameter != null ? pu.pipeDiameter : 0.35;           // m 管径
    const pL = pu.pipeLength != null ? pu.pipeLength : 150;                // m 等效管长
    const pEps = pu.pipeRoughness != null ? pu.pipeRoughness : 1.5e-6;    // m 管壁粗糙度
    const pK = pu.minorLossK != null ? pu.minorLossK : 5;                  // 局部阻力系数和
    const pA = Math.PI * pD * pD / 4;                                       // m² 管截面积
    const pV = pumpQ / pA;                                                  // m/s 管内流速
    const pRe = pV * pD / nuW;                                              // 雷诺数
    const pF = 0.25 / Math.pow(Math.log10(pEps / (3.74 * pD) + 5.74 / Math.pow(pRe, 0.9)), 2); // Swamee–Jain 摩阻系数
    const v2_2g = pV * pV / (2 * g9);
    const hf = pF * (pL / pD) * v2_2g;                                      // m 沿程损失
    const hm = pK * v2_2g;                                                  // m 局部损失
    const pumpHead = (pu.staticLift != null ? pu.staticLift : 2.8) + hf + hm; // m 总扬程
    const pumpEff = pu.eff != null ? pu.eff : 0.70;
    const pumpLoad = pu.loadFactor != null ? pu.loadFactor : 1;
    const pumpPower = (swDensity * g9 * pumpQ * pumpHead) / (pumpEff * 1000) / pumpLoad; // kW（ρgQH/η，ρ 随海水/淡水变化）
    // P2-11：制氧系统比能耗按部分负荷效率折扣
    const oxyPower = o2Supply * ox.specificEnergy / (ox.loadFactor != null ? ox.loadFactor : 1);
    const fanPower = co2Hour * deg.fanEnergy;                               // kW（kg/h CO2 × kWh/kg CO2）
    const miscPower = totalTankVol * K.equipment.misc.loadW / 1000;         // kW（杂项 W/m³）
    // 温控负荷（气候相关）：围护传热 + 补水加热 − 内部得热；按制热/制冷分 COP
    const heat = K.equipment.heat, cl = K.climate;
    const amb = (inputs.ambientTemp != null && inputs.ambientTemp !== "" && !isNaN(Number(inputs.ambientTemp)))
      ? Number(inputs.ambientTemp) : (regionDef && regionDef.ambient != null ? regionDef.ambient : cl.defaultAmbient);
    const bldArea = totalTankVol * K.building.areaPerM3;                    // m² 车间地板面积（第8节同）
    // 围护传热面积 = 屋面 + 四周外墙（按近似方形占地推周长；地板贴地按地耦处理，不计入室内外温差传热）
    const bldFootSide = Math.sqrt(bldArea);
    const bldWallArea = 4 * bldFootSide * K.building.height;
    const envArea = bldArea + bldWallArea;                                  // m² 实际围护表面积（屋顶+外墙）
    const UA = envArea * heat.uEnvelope;                                    // W/℃ 围护传热系数
    const makeupKgH = makeupFlowH * 1000;                                   // kg/h 补水质量流量（makeupFlowH 为 m³/h）
    const internalW = pumpPower * 1000 * (heat.pumpLossFrac != null ? heat.pumpLossFrac : 0.12) + totalTankVol * heat.internalLoadW; // 室内得热(泵损+照明/代谢)
    const evapW = evapKgH * (heat.evapLatent || 2.44e6) / 3600;             // W 蒸发潜热负荷（复用第3节水足迹的 evapKgH）
    // 单点设计工况（年均气温 amb）：用于参考显示
    const liftSp = temp - amb;
    const envWsp = UA * liftSp;
    const makeupWsp = makeupKgH * cl.cpWater * liftSp / 3600;
    const rawSp = envWsp + makeupWsp;
    let hvacPowerDesign, thermalLoadW;
    if (rawSp >= 0) {
      thermalLoadW = Math.max(0, rawSp - internalW) + evapW;               // 制热：内部得热抵消，蒸发需补偿
      hvacPowerDesign = thermalLoadW / 1000 / heat.copHeat;
    } else {
      thermalLoadW = -rawSp + internalW + evapW;                           // 制冷：内部得热叠加，蒸发需除湿
      hvacPowerDesign = thermalLoadW / 1000 / heat.copCool;
    }
    // P1-1 季节性双工况 bin method（v1.7.0）：按 12 月均温序列积分 HVAC 年能耗（冬季制热×copHeat + 夏季制冷×copCool，含蒸发潜热）
    const amp = (regionDef && regionDef.amp != null) ? regionDef.amp : 0;   // 无地区时 amp=0 → 退化为单点
    const hoursPerMonth = [744,672,744,720,744,720,744,744,720,744,720,744];
    let hvacHeatingKwh = 0, hvacCoolingKwh = 0;
    const hvacMonths = [];
    for (let m = 0; m < 12; m++) {
      const Tm = amb + amp * Math.cos(2 * Math.PI * (m - 6) / 12);          // m=6 即 7 月(最暖)
      const liftM = temp - Tm;
      const envWm = UA * liftM;
      const makeupWm = makeupKgH * cl.cpWater * liftM / 3600;
      const rawM = envWm + makeupWm;
      let pM, modeM;
      if (rawM >= 0) {
        const loadWm = Math.max(0, rawM - internalW) + evapW;
        pM = loadWm / 1000 / heat.copHeat;
        hvacHeatingKwh += pM * hoursPerMonth[m];
        modeM = "heat";
      } else {
        const loadWm = -rawM + internalW + evapW;
        pM = loadWm / 1000 / heat.copCool;
        hvacCoolingKwh += pM * hoursPerMonth[m];
        modeM = "cool";
      }
      hvacMonths.push({ m: m + 1, T: round(Tm, 1), mode: modeM, powerKw: round(pM, 2) });
    }
    const hvacAnnualKwh = hvacHeatingKwh + hvacCoolingKwh;
    const hvacPower = hvacAnnualKwh / (24 * 365);                           // 年均值 kW（驱动总能耗）
    const hvacMode = hvacHeatingKwh >= hvacCoolingKwh ? "heat" : "cool";    // 主导工况
    const totalPower = pumpPower + oxyPower + fanPower + hvacPower + miscPower + solidsPower;
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
    // P2-2：海水品种(matlFactor>1)对腐蚀敏感设备(池体/水泵/自控)加材质溢价(316L/HDPE)
    const capexTanks    = totalTankVol * cpx.tanks * matlFactor;
    const capexBio      = totalTankVol * cpx.biofilter;
    const capexSolids   = totalTankVol * cpx.solids;
    const capexOxy      = totalTankVol * cpx.oxygen;
    const capexDegasser = totalTankVol * cpx.degasser;
    const capexUv       = totalTankVol * cpx.uv;
    const capexPumps    = totalTankVol * cpx.pumps * matlFactor;
    const capexCtl      = totalTankVol * cpx.controls * matlFactor;
    const capexHvac     = totalTankVol * cpx.hvac;
    const capexBuilding = buildingArea * cpx.building;

    // 9.2 规模经济：总投资 ∝ 年产量^scaleExponent（六 tenths 法则，亚线性）
    //     < refAnnualTons 单位投资更高（小规不经济），> refAnnualTons 更省（大规规模效应）
    //     P2-4：改分段曲线（小规单位投资高、大规趋平），并夹在 [scaleCeil, scaleFloor] 防极端规模失真
    const annT = Math.max(annual / 1000, 1);
    const scaleFactor = scaleFactorFor(annT, cm);

    const op = ec.opex;
    // P1-5：人工数随规模（v1.5.0）：laborCount = max(laborBase, base + laborPerTon×√产量)
    const laborCount = Math.max(op.laborBase != null ? op.laborBase : 2,
      Math.round((op.laborBase != null ? op.laborBase : 2) + (op.laborPerTon != null ? op.laborPerTon : 0.35) * Math.sqrt(annT)));
    // OPEX 单价：表单可自定义覆盖（维护按直接费比例另算，不开放单价）
    const feedPrice = inputs.feedPrice > 0 ? inputs.feedPrice : (sp.feedPrice || op.feedPrice);
    const fingerPrice = inputs.fingerlingPrice > 0 ? inputs.fingerlingPrice : (sp.fingerlingPrice || op.fingerlingPrice);
    const elecPrice = elec;   // elec 已含地区电价指数 regPower（仅默认价生效）
    const waterPrice = inputs.waterPrice > 0 ? inputs.waterPrice : (op.waterPrice || 5.0);
    const laborPrice = inputs.laborPerYear > 0 ? inputs.laborPerYear : (op.laborPerYear * regLabor);

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
      const split = cdet[c.key].split != null ? cdet[c.key].split : 1;        // P2-8 可变比例
      const effScale = (1 - split) + split * scaleFactor;                     // 固定段不随规模变化
      const subs = cdet[c.key].subs.map((s) => ({
        label: s[0], rate: round(s[1] * effScale * regCost), amount: round(c.qty * s[1] * effScale * regCost),
      }));
      const total = subs.reduce((a, x) => a + x.amount, 0);
      return { key: c.key, label: c.label, unit: c.unit, qty: round(c.qty), subs, total, indirect: false };
    });
    const capexDirect = directRows.reduce((a, c) => a + c.total, 0);

    // 9.4 OPEX（维护费基数改为直接费，更贴合实际维护对象）
    // P2-5 维护费分设备寿命：各设备按自身年维护率(maintRate)与寿命(lifeYears)计维护费与重置准备，财务更细
    let opexMaint = 0;
    const maintBreakdown = [];
    directRows.forEach((row) => {
      const cd = cdet[row.key];
      const mr = cd && cd.maintRate != null ? cd.maintRate : (op.maintenanceRate || 0.04);
      const life = cd && cd.lifeYears != null ? cd.lifeYears : 15;
      const ann = row.total * mr;
      opexMaint += ann;
      maintBreakdown.push({ key: row.key, label: row.label, annual: ann, life: life, reserve: row.total / life, capex: row.total });
    });
    const opexFeed = annualFeed * feedPrice;
    const harvestNum = annual / (sp.harvestSize / 1000);
    const opexFinger = harvestNum * fingerPrice;
    const opexElec = annualEnergy * 1000 * elecPrice;
    const opexLabor = laborPrice * laborCount;
    const opexWater = makeupFlow * 365 * waterPrice;   // 生产补水费（补水流量 × 年 × 水价）
    const opexTotal = opexFeed + opexFinger + opexElec + opexLabor + opexMaint + opexWater + opexSolids;
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

    /* —— 水质可行性闭环校核（稳态质量平衡：两段硝化 + 一阶去除 + 补水稀释 + 水源背景） —— */
    const wq = K.waterQuality;
    const tanHard = Math.min(wq.tanMax, sp.tanMax || wq.tanMax);
    const no2Hard = wq.no2Max;
    const doMinV = Math.min(wq.doMin, sp.doMin || wq.doMin);
    const o2SatV = o2Sat(temp) * o2SatFactor;
    const doTarget = Math.min(doMinV + 1.5, o2SatV);
    // P0-4 补水背景浓度：水源 TAN/NO₂/NO₃ 计入稳态质量平衡（用户可经 inputs.makeupBackground 覆盖）
    const bg = (inputs.makeupBackground && typeof inputs.makeupBackground === "object")
      ? inputs.makeupBackground : (K.defaults.makeupBackground || { tan: 0, no2: 0, no3: 0 });
    const bgTan = bg.tan != null ? bg.tan : 0;
    const bgNo2 = bg.no2 != null ? bg.no2 : 0;
    const bgNo3 = bg.no3 != null ? bg.no3 : 0;
    // P0-3 两段硝化：TAN 由 AOB(rNitrit) 去除；NO₂ 由 NOB(rNitrat,更快) 去除 → NO₂ 稳态更低
    const denomBf = (k) => k * bfReactorVolSf + makeupFlow;
    const cTan = (tanDaily * 1000 + makeupFlow * bgTan) / denomBf(rNitrit * 1000 / tanHard); // mg/L as N
    const cNo2 = (tanDaily * 1000 + makeupFlow * bgNo2) / denomBf(rNitrat * 1000 / no2Hard); // mg/L as N
    // P1-6 / P0-4：NO₃ 稳态 = 硝化生成×(1−反硝化去除) + 水源背景，随补水交换(以 N 计)
    const denitRemoval = K.process.denitRemoval != null ? K.process.denitRemoval : 0;
    const no3Factor = K.process.no3Factor != null ? K.process.no3Factor : 4.43;
    const no3Nmg = makeupFlow > 0
      ? (tanDaily * 1000 * (1 - denitRemoval) + makeupFlow * bgNo3) / makeupFlow
      : 9999; // mg/L as N（无补水排换则累积）
    const cNo3 = no3Nmg * no3Factor;
    const denitVol = (tanDaily * (1 - denitRemoval)) / (K.process.denitRate != null ? K.process.denitRate : 0.25);
    // P0-2 CO₂ 闭环：脱气塔脱除 + 补水稀释 → 稳态 CO₂；输出脱除量 co2Stripped
    const co2Stripped = co2Prod * deg.co2Removal;  // kg/天 脱气塔脱除量
    const cCo2 = (co2Prod * 1000) / (deg.co2Removal * recircFlow + makeupFlow);
    const cTss = (tssDaily * 1000) / (df.tssRemoval * recircFlow + makeupFlow);
    // P0-1 DO 闭环：供氧覆盖鱼代谢+硝化时池内可达 DO；供氧不足按比例下降并计缺口
    const o2Margin = o2DemandH > 0 ? (o2Supply - o2DemandH) / o2DemandH * 100 : 999;
    const o2Ratio = o2DemandH > 0 ? Math.min(1, o2Supply / o2DemandH) : 1;
    const o2Achieved = o2Ratio >= 1 ? doTarget : round(doTarget * o2Ratio, 2);
    const o2Deficit = Math.max(0, round(doMinV - o2Achieved, 2));
    const st = (v, hard, soft, lowerBetter) => lowerBetter
      ? (v > hard ? "fail" : v > soft ? "warn" : "ok")
      : (v < hard ? "fail" : v < soft ? "warn" : "ok");
    const checks = [
      { key: "tan", name: "总氨氮 TAN", value: round(cTan, 2), unit: "mg/L", limit: tanHard, status: st(cTan, tanHard, tanHard * 1.5, true), note: "AOB 亚硝化 + 补水稀释" },
      { key: "no2", name: "亚硝态氮 NO₂", value: round(cNo2, 2), unit: "mg/L", limit: no2Hard, status: st(cNo2, no2Hard, no2Hard * 1.5, true), note: "NOB 硝化(NO₂→NO₃)，速率高于 AOB" },
      { key: "no3", name: "硝态氮 NO₃-N", value: round(no3Nmg, 1), unit: "mg/L（以 N 计）", limit: 300, status: st(no3Nmg, 300, wq.no3SoftCap, true), note: denitRemoval > 0 ? `反硝化脱除 ${Math.round(denitRemoval * 100)}%，剩余随补水交换` : "仅随补水交换，需排换水或反硝化" },
      { key: "co2", name: "二氧化碳 CO₂", value: round(cCo2, 1), unit: "mg/L", limit: wq.co2Max * 2, status: st(cCo2, wq.co2Max * 2, wq.co2Max, true), note: `脱气塔脱除 ${round(co2Stripped, 1)} kg/天 + 补水稀释` },
      { key: "tss", name: "悬浮固体 TSS", value: round(cTss, 1), unit: "mg/L", limit: wq.ssMax, status: st(cTss, wq.ssMax, wq.ssMax * 1.5, true), note: "微滤机去除" },
      { key: "do", name: "溶氧 DO", value: round(o2Achieved, 1), unit: "mg/L", limit: doMinV, status: o2Deficit > 0.1 ? "fail" : "ok", note: "供氧余量 " + round(o2Margin, 0) + "%，池内可达 " + round(o2Achieved, 1) + " mg/L" },
    ];
    const wqStatus = checks.some((c) => c.status === "fail") ? "fail"
      : (checks.some((c) => c.status === "warn") ? "warn" : "ok");
    const waterQuality = {
      checks, status: wqStatus, feasible: wqStatus !== "fail",
      o2Margin: round(o2Margin, 0), o2Sat: round(o2SatV, 1), doTarget: round(doTarget, 1),
      o2Achieved: round(o2Achieved, 2), o2Deficit: round(o2Deficit, 2),
      co2Stripped: round(co2Stripped, 1),
      no3N: round(no3Nmg, 1),
      denit: {
        removal: round(denitRemoval, 2),
        volume: round(denitVol, 1),
        no3NLoadDaily: round(tanDaily * (1 - denitRemoval), 2),
      },
    };

    return {
      species: sp,
      inputs: { annual, density, cycles, turns, makeup, sf, temp, elec, fcr, salePrice,
        feedPrice: inputs.feedPrice || null, fingerlingPrice: inputs.fingerlingPrice || null,
        elecPrice: inputs.elecPrice || null, waterPrice: inputs.waterPrice || null,
        laborPerYear: inputs.laborPerYear || null,
        ambientTemp: amb, region: regionKey || null, laborCount },
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
        waterFootprint: round(waterFootprint, 4),
        evapVolYr: round(evapVolYr),
        bleedVolYr: round(bleedVolYr),
        makeupVolYr: round(makeupVolYr),
        evapFrac: round(evapFracOfRecirc, 4),
        evapCovered: evapCovered,
      },
      biofilter: {
        type: bf.type, rate: round(nitrRate, 3),
        rateNitritation: round(rNitrit, 3),
        rateNitratation: round(rNitrat, 3),
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
        o2DemandH: round(o2DemandH, 1),
        nitrifO2Daily: round(nitrifO2Daily, 1),
        o2Supply: round(o2Supply, 1),
        co2Hour: round(co2Hour, 1),
        degasserType: deg.type,
      },
      solids: {
        drumType: df.type, screen: df.screen,
        tssDaily: round(tssDaily, 1),
        units: drumUnits, eachFlow: round(drumEachFlow),
        disposalPowerKw: round(solidsPower, 3),
        disposalAnnualKwh: round(solidsAnnualKwh),
        disposalCostYr: round(opexSolids),
      },
      energy: {
        pumpPower: round(pumpPower, 1),
        pumpHead: round(pumpHead, 2),
        pumpVelocity: round(pV, 2),
        pumpReynolds: round(pRe),
        pumpFriction: round(pF, 4),
        oxyPower: round(oxyPower, 1),
        fanPower: round(fanPower, 1),
        hvacPower: round(hvacPower, 1),
        hvacPowerDesign: round(hvacPowerDesign, 1),
        hvacMode: hvacMode,
        hvacAnnualKwh: round(hvacAnnualKwh),
        hvacHeatingKwh: round(hvacHeatingKwh),
        hvacCoolingKwh: round(hvacCoolingKwh),
        hvacMonths,
        thermalLoadW: round(thermalLoadW),
        evapPower: round(evapW / 1000, 2), // kW（与 hvacPower 单位一致）
        evapKgH: round(evapKgH, 1),
        evapVolYr: round(evapVolYr),
        ambientTemp: amb,
        miscPower: round(miscPower, 1),
        solidsPower: round(solidsPower, 3),
        solidsAnnualKwh: round(solidsAnnualKwh),
        totalPower: round(totalPower, 1),
        energyIntensity: round(energyIntensity, 2),
        annualEnergy: round(annualEnergy, 1),
        // P2-6 能耗分项（五类占比）：泵/氧/脱气/温控/杂项(含固废处置)
        energySplit: {
          pump: round(pumpPower, 1), oxy: round(oxyPower, 1), degas: round(fanPower, 1),
          hvac: round(hvacPower, 1), misc: round(miscPower + solidsPower, 1),
        },
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
        laborCount,
        opexMaint: round(opexMaint),
        opexWater: round(opexWater),
        opexSolids: round(opexSolids),
        maintBreakdown,
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

  // P2-4 分段规模经济：按产量所在区间取对应指数，factor 再夹在 [scaleCeil, scaleFloor]
  function scaleFactorFor(annT, cm) {
    const curve = cm.scaleCurve && cm.scaleCurve.length ? cm.scaleCurve : null;
    let exp = cm.scaleExponent != null ? cm.scaleExponent : 0.72;
    if (curve) {
      for (const seg of curve) { if (annT <= seg.upto) { exp = seg.exp; break; } }
    }
    let sf = Math.pow(cm.refAnnualTons / annT, 1 - exp);
    const floor = cm.scaleFloor != null ? cm.scaleFloor : 3;
    const ceil = cm.scaleCeil != null ? cm.scaleCeil : 0.5;
    return Math.min(Math.max(sf, ceil), floor);
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
      // 固定产量，搜索密度/循环/池径/补水/FCR/安全系数/温度/地区，按目标最小化
      const energyObj = (obj === "minEnergy" || obj === "pareto");
      const densList = range(sp.stockingDensity * 0.7, sp.stockingDensity * 1.25, energyObj ? 10 : 5);
      const turnsList = energyObj ? [8, 10, 12, 14] : [6, 8, 10, 12, 14, 16, 18, 20];
      const diamList = [6, 8, 10, 12];
      const makeList = [0.005, 0.01, 0.02, 0.03];
      const fcrBase = sp.fcr;
      const fcrList = range(fcrBase * 0.85, fcrBase * 1.15, 0.15); // FCR 纳入决策变量
      const sfList = [1.1, 1.2, 1.3];                              // 安全系数纳入决策变量
      // P1-4：温度/气候纳入决策（仅能耗相关目标展开，控制组合数）
      const baseTemp = opts.designTemp != null ? opts.designTemp : sp.designTemp;
      const tempList = energyObj ? range(sp.tempRange[0], sp.tempRange[1], 3) : [baseTemp];
      const ambKeys = ["harbin", "beijing", "shanghai", "guangzhou", "sanya"];
      const ambEntries = energyObj ? ambKeys.filter((k) => K.climate.regions[k]).map((k) => [k, K.climate.regions[k]]) : [["__none__", { ambient: null }]];
      for (const density of densList)
        for (const turns of turnsList)
          for (const D of diamList)
            for (const mk of makeList)
              for (const fcr of fcrList)
                for (const sf of sfList)
                  for (const dt of tempList)
                    for (const [rkey, rdef] of ambEntries) {
                      const d = compute({
                        speciesKey: opts.speciesKey, annualTons: opts.annualTons,
                        targetDensity: density, recircTurns: turns, makeupRate: mk,
                        fcr, safety: sf, designTemp: dt, ambientTemp: rdef.ambient, region: rkey,
                      });
                      if (!feasible(d)) continue;
                      candidates.push({
                        d, cost: d.economics.capexTotal, energy: d.energy.energyIntensity,
                        area: d.building.buildingArea,
                        vars: { density, turns, tankD: D, makeup: mk, fcr, sf, designTemp: dt, ambientTemp: rdef.ambient, region: rkey },
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
      ambientTemp: d.inputs.ambientTemp,
      region: d.inputs.region || null,
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

  /* ============== 不确定性 / 蒙特卡洛分析（P2-1） ==============
   * 对 knowledge.uncertainty.params 中的模型系数做三角分布采样，
   * 结果从"单点"升级为 P10/P50/P90 区间 + 分布直方图 + 水质可行率。
   * 仅扰动"模型系数"（不碰用户可自定义的价格/输入）。
   */
  function triangular(low, mode, high) {
    if (!(high > low)) return mode;
    const u = Math.random();
    const fc = (mode - low) / (high - low);
    if (u < fc) return low + Math.sqrt(u * (high - low) * (mode - low));
    return high - Math.sqrt((1 - u) * (high - low) * (high - mode));
  }
  function withOverrides(over, fn) {
    const saved = [];
    for (const k in over) {
      const parts = k.split(".");
      let obj = K;
      for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
      const key = parts[parts.length - 1];
      saved.push([obj, key, obj[key]]);
      obj[key] = over[k];
    }
    try { return fn(); } finally { for (const s of saved) s[0][s[1]] = s[2]; }
  }
  function pct(arr, p) {
    if (!arr.length) return null;
    const s = arr.slice().sort((a, b) => a - b);
    const idx = Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))));
    return s[idx];
  }
  function histogram(arr, bins) {
    if (!arr.length) return [];
    const min = Math.min.apply(null, arr), max = Math.max.apply(null, arr);
    if (max - min < 1e-9) return [{ x0: min, x1: max, n: arr.length }];
    const w = (max - min) / bins;
    const hs = [];
    for (let i = 0; i < bins; i++) hs.push({ x0: min + i * w, x1: min + (i + 1) * w, n: 0 });
    arr.forEach((v) => {
      let bi = Math.floor((v - min) / w);
      if (bi >= bins) bi = bins - 1;
      if (bi < 0) bi = 0;
      hs[bi].n++;
    });
    return hs;
  }
  function monteCarlo(inputs, opts) {
    opts = opts || {};
    const N = opts.N && opts.N > 0 ? opts.N : 2000;
    const params = (K.uncertainty && K.uncertainty.params) || [];
    const base = Object.assign({}, inputs);
    const keys = ["costPerKg", "energyIntensity", "capexTotal", "grossProfit", "paybackYears", "marginRate"];
    const collect = {}; keys.forEach((k) => (collect[k] = []));
    const wq = { ok: 0, warn: 0, fail: 0 };
    for (let i = 0; i < N; i++) {
      const over = {};
      params.forEach((u) => {
        const t = triangular(u.low, u.exp, u.high);
        if (u.inputKey) base[u.inputKey] = t;          // 经 inputs 覆盖（如补水率）
        else over[u.path] = t;                          // 经知识库覆盖（如 COP/速率）
      });
      const d = withOverrides(over, () => compute(base));
      const pick = (k) => k === "energyIntensity" ? d.energy.energyIntensity
        : k === "capexTotal" ? d.economics.capexTotal
        : k === "grossProfit" ? d.economics.grossProfit
        : k === "paybackYears" ? d.economics.paybackYears
        : k === "marginRate" ? d.economics.marginRate
        : d.economics.costPerKg;
      keys.forEach((k) => {
        const v = pick(k);
        if (typeof v === "number" && isFinite(v)) collect[k].push(v);
      });
      wq[d.waterQuality.status] = (wq[d.waterQuality.status] || 0) + 1;
    }
    const out = { N, params: params.map((u) => ({ key: u.key, label: u.label })) };
    keys.forEach((k) => {
      out[k] = { p10: round(pct(collect[k], 10), 2), p50: round(pct(collect[k], 50), 2), p90: round(pct(collect[k], 90), 2) };
    });
    out.waterQuality = {
      okPct: round((wq.ok / N) * 100), warnPct: round((wq.warn / N) * 100), failPct: round((wq.fail / N) * 100),
    };
    out.histCost = histogram(collect.costPerKg, 12);
    out.histPayback = histogram(collect.paybackYears.filter((v) => v != null), 12);
    return out;
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
    A("投资回收期 < 16 年", e.paybackYears != null && e.paybackYears < 16, "回收期 " + (e.paybackYears != null ? e.paybackYears.toFixed(1) : "—") + " 年");
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

  return { compute, optimize, sensitivity, monteCarlo, selfCheck, round, fmt, rmb };
})();
