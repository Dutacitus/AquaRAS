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
    const annual = (inputs.annualTons != null ? inputs.annualTons : 100) * 1000; // kg/年（annualTons 缺省按 100t 计，避免下游 NaN 级联）
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
    // v1.15.0 M5：FCR–密度耦合（仅当用户未自定义 FCR 时生效；用户自定义优先，绝不覆盖）
    const fcrDensityCoef = K.process.fcrDensityCoef != null ? K.process.fcrDensityCoef : 0;
    const fcrEffBase = sp.fcr * (1 + fcrDensityCoef * (density - sp.stockingDensity)); // 高密度→FCR 升高（拥挤应激/代谢效率↓）
    const fcr = (inputs.fcr && inputs.fcr > 0) ? inputs.fcr : fcrEffBase;
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

    // P1-3 水足迹（取水侧基础项）：年取水 = makeupFlow×365；开放池面蒸发量（真水平衡的"蒸发"项，其余损耗项在 tssDaily 之后补全）
    const evapRateP13 = (K.equipment.heat.evapRate) * (temp / (K.equipment.heat.evapTempRef || 25));
    const waterSurfaceArea = totalTankVol / tankH;
    const evapKgH = waterSurfaceArea * evapRateP13;                 // kg/h 开放池面蒸发量
    const evapVolYr = evapKgH * 24 * 365 / 1000;                    // m³/年 蒸发损失
    const makeupVolYr = makeupFlow * 365;                           // m³/年 补水量(=取水)
    const recircVolYr = recircFlow * 365;                           // m³/年 循环量
    const evapFracOfRecirc = recircVolYr > 0 ? evapVolYr / recircVolYr : (makeup + 1); // 蒸发占循环量比例
    const waterFootprint = specificWaterUse;                       // m³/kg（=取水/产量）

    // —— 4. 生物滤池 (MBBR) ——
    const bf = K.equipment.biofilter;
    // P0-3 两段硝化（v1.6.0）：温度修正速率。AOB(亚硝化)为限速步用于定容；NOB(硝化)更快用于 NO₂ 稳态
    const nitrTheta = bf.nitrTheta != null ? bf.nitrTheta : 1.08;        // 统用兜底 θ（旧版单一系数）
    const nitrThetaAOB = bf.nitrThetaAOB != null ? bf.nitrThetaAOB : nitrTheta; // AOB 亚硝化温度系数 θ（v1.15.0 M2）
    const nitrThetaNOB = bf.nitrThetaNOB != null ? bf.nitrThetaNOB : nitrTheta; // NOB 硝化温度系数 θ（v1.15.0 M2：低温更敏感，捕捉 NO₂ 积累）
    const nitrRate = bf.rate * Math.pow(nitrTheta, temp - 25);                  // AOB 限速步：生物滤池定容
    const rNitrit = (bf.rateNitritation != null ? bf.rateNitritation : bf.rate) * Math.pow(nitrThetaAOB, temp - 25); // TAN→NO₂（AOB 温度敏感）
    const rNitrat = (bf.rateNitratation != null ? bf.rateNitratation : bf.rate) * Math.pow(nitrThetaNOB, temp - 25); // NO₂→NO₃（NOB 温度敏感，低温失活更快→NO₂ 积累）
    // （生物滤池定容已移至碳酸盐/pH 求解之后：用 pH 折减后的有效速率 rNitritEff 定容，与稳态校核口径统一；见 §水质 前 M1 v1.14.0）

    // —— 5. 增氧与 CO2 脱除 ——
    const ox = K.equipment.oxygen;
    const o2PerFeed = (sp.o2PerFeed || ox.o2PerFeed || 1.0) * (K.process.o2FishCal != null ? K.process.o2FishCal : 1);   // 品种相关氧耗系数(kg O2/kg 饲料)，o2FishCal 为鱼呼吸氧耗标定因子(真实鱼代谢仅约 0.35–0.5，原默认偏高)
    // P2-1 鱼代谢 Q10 温度修正：鱼呼吸耗氧随水温升高（每 10℃ 约翻倍，文献 1.8–2.4），以 o2RefTemp 为标定基准
    const o2RefTemp = K.process.o2RefTemp != null ? K.process.o2RefTemp : 25;        // ℃ 氧耗标定参考温度
    const q10O2 = K.process.q10O2 != null ? K.process.q10O2 : 2.0;                  // 鱼代谢 Q10
    const o2PerFeedEff = o2PerFeed * Math.pow(q10O2, (temp - o2RefTemp) / 10);       // 温度修正后鱼呼吸氧耗系数（高温↑/低温↓）
    const o2Daily = dailyFeedAvg * o2PerFeedEff;
    const o2Peak = dailyFeedPeak * o2PerFeedEff;
    const o2HourPeak = o2Peak / 24;
    // P0-1 溶氧闭环（v1.6.0）：供氧能力按「峰值鱼代谢 + 硝化耗氧」定容(含安全系数)，确保池内可达 DO
    const nitrifO2Daily = K.process.nitrifO2 * tanDaily;       // kg/天 硝化耗氧
    const o2DemandH = (o2Peak + nitrifO2Daily) / 24;          // kg/h 峰值总氧耗(鱼代谢 + 硝化)
    const o2Supply = o2DemandH / ox.transferEff * sf;         // 设计供氧能力(覆盖鱼代谢+硝化，含 SF)
    const deg = K.equipment.degasser;
    // CO₂ 预算 = 鱼呼吸 CO₂ + 硝化产 CO₂（碱度消耗→CO₂，为 RAS 主要 CO₂ 源，原模型漏算）
    const co2Prod = o2Daily * K.process.co2Ratio + tanDaily * (K.process.co2PerN != null ? K.process.co2PerN : 0);
    const co2Hour = co2Prod / 24;

    // —— 6. 固废处理 ——
    const df = K.equipment.drumFilter;
    const tssPerFeed = K.process.tssPerFeed;
    const tssDaily = dailyFeedAvg * tssPerFeed;

    // P1-3 水足迹真水平衡（v1.13.0）：取水 = 蒸发 + 排污(bleed) + 污泥带水 + 脱气塔雾损（此前仅 evap+bleed 两项，未闭合）
    const sludgeCakeWc = K.process.sludgeCakeWc != null ? K.process.sludgeCakeWc : 0.80; // 脱水饼含水率
    const sludgeDryYr = tssDaily * 365;                                                     // kg/年 干固形物
    const sludgeWaterVolYr = sludgeDryYr * sludgeCakeWc / (1 - sludgeCakeWc) / 1000;        // m³/年 脱水饼带水(不返还)
    const drumBackwashVolYr = makeupVolYr * (K.process.drumBackwashFrac != null ? K.process.drumBackwashFrac : 0.08); // m³/年 微滤机反冲洗(占取水,不返还)
    const degasserMistVolYr = makeupVolYr * (K.process.degasserMistFrac != null ? K.process.degasserMistFrac : 0.005); // m³/年 脱气塔雾损(占取水,不返还)
    const lossOtherVolYr = sludgeWaterVolYr + drumBackwashVolYr + degasserMistVolYr;        // m³/年 其他损耗合计
    const bleedVolYr = Math.max(0, makeupVolYr - evapVolYr - lossOtherVolYr);               // m³/年 排污=取水−蒸发−其他损耗
    // P1-2b 尾水深度处理单元（v1.13.9）：按文献去除率对排放口二次削减 + 计入经济账
    const twTechKey = (inputs && inputs.tailwaterTech && K.tailwaterTreatment && K.tailwaterTreatment[inputs.tailwaterTech]) ? inputs.tailwaterTech : "none";
    const twTech = (K.tailwaterTreatment && K.tailwaterTreatment[twTechKey]) || { name: "无（直排）", tn: 0, tp: 0, cod: 0, ss: 0, capexPerM3d: 0, opexPerM3: 0, footprintPerM3d: 0 };
    const twTreatedM3d = (bleedVolYr + drumBackwashVolYr + degasserMistVolYr) / 365; // m³/d 处理流量=排污+反冲洗+雾损(液排出部分)
    const capexTail = twTech.capexPerM3d * twTreatedM3d;       // 元 单元投资
    const opexTailYr = twTech.opexPerM3 * twTreatedM3d * 365;  // 元/年 单元运行
    const footprintTail = twTech.footprintPerM3d * twTreatedM3d; // m² 占地
    const totalLossVolYr = evapVolYr + lossOtherVolYr;                                      // m³/年 不返还总损耗(>取水则水位下降)
    const waterCovered = totalLossVolYr <= makeupVolYr;                                     // 补水率是否覆盖全部损耗
    const waterConsumption = totalLossVolYr / annual;                                       // m³/kg 消耗性水足迹(蒸发+污泥带水+雾损)
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
    // v1.16.0 修复：管径随流量选取，使主管流速封顶 velocityMax，避免固定管径下大流量时
    // v∝Q、摩擦扬程 hf∝v²∝Q² 导致泵功随规模超线性暴涨（非物理，1000t 曾达 v=16.9m/s/head=133m）。
    // 小场 pDneeded<基准管径→沿用基准（golden@100t 完全不变）；大场自动放大管径→流速封顶、泵功随流量近线性。
    const pDNom = pu.pipeDiameter != null ? pu.pipeDiameter : 0.35;      // m 基准管径（小场）
    const vMax = pu.velocityMax != null ? pu.velocityMax : 2.5;         // m/s 设计最大流速
    const pDneeded = Math.sqrt(4 * pumpQ / (Math.PI * vMax));           // 维持 v<=vMax 所需最小管径
    const pD = Math.max(pDNom, pDneeded);                               // m 实际管径（大场自动放大）
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
    const makeupKgH = makeupFlowH * swDensity;                              // kg/h 补水质量流量（按实际水体密度，淡水1000/海水~1025）
    const heatRecoveryEff = heat.heatRecoveryEff != null ? heat.heatRecoveryEff : 0; // v1.15.0 M6：补水/排污余热回收效率
    const internalW = pumpPower * 1000 * (heat.pumpLossFrac != null ? heat.pumpLossFrac : 0.12) + totalTankVol * heat.internalLoadW; // 室内得热(泵损+照明/代谢)
    const evapW = evapKgH * (heat.evapLatent || 2.44e6) / 3600;             // W 蒸发潜热负荷（复用第3节水足迹的 evapKgH）
    // 单点设计工况（年均气温 amb）：用于参考显示
    const liftSp = temp - amb;
    const envWsp = UA * liftSp;
    const makeupWsp = makeupKgH * cl.cpWater * liftSp / 3600 * (1 - heatRecoveryEff); // M6：补水显热×余热回收
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
      const makeupWm = makeupKgH * cl.cpWater * liftM / 3600 * (1 - heatRecoveryEff); // M6：补水显热×余热回收
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

    // P1 电力碳足迹（v1.13.0）：年电耗 × 地区电网排放因子 → 电力碳排放(kgCO₂e)；地区优先，回退全国均值
    const carbonFactor = (regionDef && regionDef.carbonFactor != null) ? regionDef.carbonFactor
                       : (K.defaults.carbonFactor != null ? K.defaults.carbonFactor : 0.58); // kgCO₂e/kWh
    const annualCarbon = annualEnergy * 1000 * carbonFactor;  // MWh/年 ×1000=kWh/年 → ×因子 = kgCO₂e/年
    const carbonPerKg = annual > 0 ? annualCarbon / annual : 0; // kgCO₂e/kg鱼

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

    // v1.16.0 PV 光伏投资模块：用户可选输入 pvKWp(容量 kWp) / pvFraction(按年负载比例自动定容) / batteryKWh(储能 kWh)
    // 模型系数来自 K.pv（造价/等效小时/上网价/运维/衰减/自用率/储能），不碰用户可自定义经营数据；
    // 未启用 PV 时全部为 0，对基线完全中性。
    const PV = K.pv || {};
    const pvUserKWp = inputs.pvKWp > 0 ? inputs.pvKWp : 0;
    const pvFraction = inputs.pvFraction > 0 ? inputs.pvFraction : 0;
    const batteryKWh = inputs.batteryKWh > 0 ? inputs.batteryKWh : 0;
    const pvAutoKWp = pvFraction > 0 ? (annualEnergy * 1000 * pvFraction) / (PV.capacityHours != null ? PV.capacityHours : 1100) : 0;
    const pvKWp = pvUserKWp > 0 ? pvUserKWp : pvAutoKWp;
    const pvGenKwh = pvKWp * (PV.capacityHours != null ? PV.capacityHours : 1100);          // kWh/年 发电量
    let pvSelfUse = PV.selfUseBase != null ? PV.selfUseBase : 0.80;                          // 自用率(发电量被自发自用比例)
    if (batteryKWh > 0) {                                                                   // 配储能提升自用率(上限 0.95)
      const dailyAvgLoadKwh = annualEnergy * 1000 / 365;
      const boost = Math.min(0.13, (batteryKWh / Math.max(1, dailyAvgLoadKwh)) * 0.13);
      pvSelfUse = Math.min(0.95, pvSelfUse + boost);
    }
    const pvSelfKwh = pvGenKwh * pvSelfUse;                                                 // 自用电量(抵电网)
    const pvExportKwh = pvGenKwh * (1 - pvSelfUse);                                         // 上网电量
    const pvElecSaved = pvSelfKwh * elecPrice;                                              // 节省电网电费(元/年)
    const pvExportIncome = pvExportKwh * (PV.exportPrice != null ? PV.exportPrice : 0.35);  // 上网收入(元/年)
    const pvOpex = pvGenKwh * (PV.omPerKwh != null ? PV.omPerKwh : 0.06);                   // 运维(元/年)
    const pvCapex = pvKWp * 1000 * (PV.capexPerW != null ? PV.capexPerW : 3.65)
                  + batteryKWh * 1000 * (PV.batteryCapexPerWh != null ? PV.batteryCapexPerWh : 0.80); // 元(光伏+储能)
    // PV 独立视角回收期/IRR（25 年寿命、年衰减；不依赖项目融资口径）
    let pvPayback = null, pvIrr = null;
    if (pvCapex > 0) {
      const pvNetY1 = pvElecSaved + pvExportIncome - pvOpex;                                // 元/年 净现金流(首年)
      const lifeY = PV.lifetimeYears != null ? PV.lifetimeYears : 25;
      const deg = PV.degradation != null ? PV.degradation : 0.005;
      if (pvNetY1 > 0) {
        pvPayback = pvCapex / pvNetY1;
        const npvPv = (r) => -pvCapex + Array.from({ length: lifeY }, (_, t) =>
          pvNetY1 * Math.pow(1 - deg, t) / Math.pow(1 + r, t + 1)).reduce((a, b) => a + b, 0);
        let lo = -0.9, hi = 0.5, f = null;
        if (npvPv(hi) <= 0) { for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (npvPv(mid) > 0) lo = mid; else hi = mid; } f = (lo + hi) / 2; }
        pvIrr = f;
      }
    }
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
    const matlKeys = { tanks: 1, pumps: 1, controls: 1 };                     // 仅腐蚀敏感设备受材质溢价
    const directRows = directDefs.map((c) => {
      const split = cdet[c.key].split != null ? cdet[c.key].split : 1;        // P2-8 可变比例
      const effScale = (1 - split) + split * scaleFactor;                     // 固定段不随规模变化
      const matl = matlKeys[c.key] ? matlFactor : 1;                         // 海水品种(>1)对池体/水泵/自控加材质溢价，与 cpx 口径一致
      const subs = cdet[c.key].subs.map((s) => ({
        label: s[0], rate: round(s[1] * effScale * regCost * matl), amount: round(c.qty * s[1] * effScale * regCost * matl),
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
    const opexElec = (annualEnergy * 1000 - pvSelfKwh) * elecPrice;     // 净电网电费 = (总电量 − 光伏自用) × 电价
    const opexLabor = laborPrice * laborCount;
    const opexWater = makeupFlow * 365 * waterPrice;   // 生产补水费（补水流量 × 年 × 水价）
    const opexTotal = opexFeed + opexFinger + opexElec + opexLabor + opexMaint + opexWater + opexSolids + opexTailYr + pvOpex;
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
    const pvRow = pvCapex > 0 ? [{
      key: "pv", label: "光伏/储能系统(可选)", unit: "", qty: "—", indirect: false,
      subs: [{ label: `光伏 ${round(pvKWp, 0)} kWp${batteryKWh > 0 ? " + 储能 " + round(batteryKWh, 0) + " kWh" : ""}`, rate: 0, amount: round(pvCapex) }],
      total: round(pvCapex),
    }] : [];
    const capexCostRows = [...directRows, ...directSubtotalRow, ...indirectRows, ...indirectSubtotalRow, ...landRow, ...pvRow];
    const capexBreakdown = capexCostRows;          // 小计行仅供阅读，不计入总额
    const capexTotal = capexCostRows.filter((c) => !c.subtotal).reduce((a, c) => a + c.total, 0) + capexTail;

    /* —— 盈利 / 投资回报 —— */
    const revenue = annual * salePrice + pvExportIncome;                 // 元/年（含光伏余电上网收入）
    const grossProfit = revenue - opexTotal;                             // 元/年（未计折旧/财务）
    const profitPerKg = annual > 0 ? grossProfit / annual : 0;          // 元/kg
    const paybackYears = grossProfit > 0 ? capexTotal / grossProfit : null;   // 简单回收期(年)
    const roi = capexTotal > 0 ? (grossProfit / capexTotal) * 100 : null;      // 年化 ROI(%)
    const marginRate = revenue > 0 ? (grossProfit / revenue) * 100 : null;     // 毛利率(%)

    // v1.15.0 M11：投资评估 + 融资模型（NPV / IRR / 折现回收期 / EBITDA / 权益投资），纯新增输出不改动基线
    const fin = K.economics.finance || { discountRate: 0.08, loanRatio: 0.6, loanRate: 0.045, loanYears: 10, depYears: 15 };
    const discountRate = fin.discountRate != null ? fin.discountRate : 0.08;
    const loanRatio = fin.loanRatio != null ? fin.loanRatio : 0.6;
    const loanRate = fin.loanRate != null ? fin.loanRate : 0.045;
    const loanYears = fin.loanYears != null ? fin.loanYears : 10;
    const depYears = fin.depYears != null ? fin.depYears : 15;
    const projectLife = 15;                                  // 项目评价期(年)
    const ebitda = grossProfit;                              // 息税折旧摊销前利润 ≈ 毛利（opexTotal 不含折旧/利息）
    const depreciation = capexTotal / Math.max(1, depYears);// 直线法年折旧(非现金)
    const loanPrincipal = capexTotal * loanRatio;            // 贷款本金
    const equityInvest = capexTotal * (1 - loanRatio);       // 权益投资(初始自有资金)
    const annualInterest = loanPrincipal * loanRate;         // 年利息
    const annualPrincipal = loanYears > 0 ? loanPrincipal / loanYears : 0; // 年等额还本
    const cf = [-equityInvest];                              // 权益口径现金流：t=0 权益投入；还债期 ebitda−利息−还本；还债后 ebitda（忽略所得税，折旧非现金已不含于 ebitda）
    for (let t = 1; t <= projectLife; t++) {
      const debtSvc = t <= loanYears ? (annualInterest + annualPrincipal) : 0;
      cf.push(Math.max(0, ebitda) - debtSvc);
    }
    const npvOf = (rate) => cf.reduce((a, c, t) => a + c / Math.pow(1 + rate, t), 0);
    const npv = npvOf(discountRate);
    let cum = 0, discountedPayback = null;                   // 折现回收期：累计折现现金流首次非负之年
    for (let t = 0; t <= projectLife; t++) {
      cum += cf[t] / Math.pow(1 + discountRate, t);
      if (cum >= 0 && discountedPayback == null) { discountedPayback = t; break; }
    }
    let irr = null;                                          // IRR（二分法，NPV 关于 rate 单调）；无解返回 null
    if (cf[0] < 0 && ebitda > 0) {
      let lo = -0.9, hi = 3.0;
      if (npvOf(hi) <= 0) {
        for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (npvOf(mid) > 0) lo = mid; else hi = mid; }
        irr = (lo + hi) / 2;
      }
    }

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
    // —— 碳酸盐体系闭环（v1.12.0）：碱度守恒 + pH 子模型 + NH₃ 毒性 ——
    // 先算 CO₂ 稳态（脱气塔主动 + 开放水面天然挥发被动 + 补水稀释），以驱动 pH
    const co2Kla = K.process.co2Kla != null ? K.process.co2Kla : 0;       // 开放水面 CO₂ 体积传质系数(/天)
    const co2Star = K.process.co2Star != null ? K.process.co2Star : 0.5; // 与大气(≈420ppm)平衡的水体 CO₂(aq) mg/L
    const co2StripFlow = co2Kla * totalTankVol;                          // m³/天 等效天然挥发去除流量
    const cCo2 = (co2Prod * 1000 + co2StripFlow * co2Star)
               / (deg.co2Removal * recircFlow + makeupFlow + co2StripFlow);
    const co2Stripped = deg.co2Removal * recircFlow * cCo2 / 1000;       // kg/天 脱气塔(主动)脱除量
    const co2Natural = co2StripFlow * Math.max(0, cCo2 - co2Star) / 1000; // kg/天 开放水面天然挥发(被动)脱除量

    // 1) 碱度稳态：硝化每氧化 1g N 耗 7.14g 碱度(以CaCO₃计)；碱度仅随补水交换流失，不被滤池/脱气去除
    const alkPerN = K.process.alkPerN != null ? K.process.alkPerN : 7.14;      // kg CaCO₃ / kg TAN-N
    const alkTarget = K.process.alkTarget != null ? K.process.alkTarget : 120; // mg/L 目标操作碱度
    const alkMin = K.process.alkMin != null ? K.process.alkMin : 80;          // mg/L 碱度下限
    const bgAlk = bg.alk != null ? bg.alk : 150;                              // mg/L 源水碱度
    // v1.15.0 M3：碱度净核算 = 硝化耗碱 − 反硝化产碱（反硝化每还原 1 mol NO₃-N 产 1 mol 碱度）
    const alkProdDenit = K.process.alkProdDenit != null ? K.process.alkProdDenit : 3.57; // kg CaCO₃ / kg N 反硝化产碱
    const denitR = K.process.denitRemoval != null ? K.process.denitRemoval : 0.85;        // 反硝化脱氮率（仅碱度净核算用；L469 另有 const 声明，此处不复用避免重复）
    const alkConsumeDay = Math.max(0, tanDaily * alkPerN - tanDaily * denitR * alkProdDenit); // kg CaCO₃/天 净耗碱
    const consM = alkConsumeDay * 1e6;                                        // mg/天
    const srcM = makeupFlow * bgAlk * 1000;                                  // mg/天 源水补入（makeupFlow[m³/天]×bgAlk[mg/L]×1000 = mg/天，与 consM 同量纲）
    const alkNat = makeupFlow > 0 ? bgAlk - consM / (makeupFlow * 1000) : -1e9; // mg/L 无投加时稳态碱度（consM/makeupFlow 单位 mg/m³ → ÷1000 转 mg/L）
    let cAlkSys, doseM;
    if (alkNat >= alkTarget) { cAlkSys = alkNat; doseM = 0; }
    else { cAlkSys = alkTarget; doseM = Math.max(0, consM - srcM + makeupFlow * alkTarget * 1000); } // 投加量 mg/天：源水与维持目标两项均×1000 与 consM(mg/天) 同量纲
    const nahco3Day = doseM > 0 ? doseM / 1e6 / (K.process.nahco3Eff != null ? K.process.nahco3Eff : 0.5957) : 0; // kg NaHCO₃/天
    const nahco3PerKgFish = nahco3Day * 365 / Math.max(1, annual);           // kg/kg 鱼

    // 2) pH 子模型：CO₂(aq) + 总碱度 → 碳酸平衡数值求解 [H⁺]（温度/盐度修正 pK）
    const pK1 = (K.process.pK1_25 != null ? K.process.pK1_25 : 6.35) - 0.012 * (temp - 25) - (matlFactor > 1 ? 0.5 : 0);
    const pK2 = (K.process.pK2_25 != null ? K.process.pK2_25 : 10.33) - 0.013 * (temp - 25) - (matlFactor > 1 ? 0.2 : 0);
    const K1 = Math.pow(10, -pK1), K2 = Math.pow(10, -pK2), Kw = 1e-14;
    const Aeq = cAlkSys / 50000;                   // eq/L（50 g/eq CaCO₃）
    const Cmol = Math.max(1e-6, cCo2) / 44000;     // mol/L（44 g/mol CO₂）
    const fPH = (H) => Aeq - (K1 * Cmol / H + 2 * K1 * K2 * Cmol / (H * H) + Kw / H - H);
    let Hlo = 1e-11, Hhi = 1e-4, flo = fPH(Hlo), fhi = fPH(Hhi);
    let pH = 7.0;
    if (flo * fhi <= 0) {
      for (let i = 0; i < 60; i++) {
        const Hm = Math.sqrt(Hlo * Hhi);
        const fm = fPH(Hm);
        if (flo * fm <= 0) { Hhi = Hm; fhi = fm; } else { Hlo = Hm; flo = fm; }
      }
      pH = -Math.log10(Math.sqrt(Hlo * Hhi));
    }
    pH = Math.min(14, Math.max(0, pH));

    // 3) pH→硝化速率折减（第二限速步：低 pH 抑制 AOB/NOB，稳态 TAN 反弹）
    const phNf = pH >= 7.0 ? 1.0 : Math.max(0.2, Math.pow(0.85, (7.0 - pH) / 0.1));
    const rNitritEff = rNitrit * phNf;
    const rNitratEff = rNitrat * phNf;

    // M1(v1.14.0)：生物滤池定容改用 pH 折减后的有效硝化速率 rNitritEff，与稳态校核口径统一
    // （pH<7 时有效速率下降，滤池自动增大，避免"按最优pH定容、运行pH下买小了"的口径分裂）
    const bfReactorVol = tanDaily / rNitritEff;
    const bfReactorVolSf = bfReactorVol * sf;
    const bfTotalVol = bfReactorVolSf / bf.mediaFill;
    const bfUnits = Math.max(2, Math.ceil(bfTotalVol / 40));
    const bfUnitVol = bfTotalVol / bfUnits;

    // P0-3 两段硝化（用 pH 折减后有效速率）：TAN 由 AOB 去除；NO₂ 由 NOB 去除
    const denomBf = (k) => k * bfReactorVolSf + makeupFlow;
    const cTan = (tanDaily * 1000 + makeupFlow * bgTan) / denomBf(rNitritEff * 1000 / tanHard); // mg/L as N
    const cNo2 = (tanDaily * 1000 + makeupFlow * bgNo2) / denomBf(rNitratEff * 1000 / no2Hard); // mg/L as N

    // P1-6 / P0-4：NO₃ 稳态 = 硝化生成×(1−反硝化去除) + 水源背景，随补水交换(以 N 计)
    const denitRemoval = K.process.denitRemoval != null ? K.process.denitRemoval : 0;
    const no3Nmg = makeupFlow > 0
      ? (tanDaily * 1000 * (1 - denitRemoval) + makeupFlow * bgNo3) / makeupFlow
      : 9999; // mg/L as N（无补水排换则累积）
    const denitVol = (tanDaily * (1 - denitRemoval)) / (K.process.denitRate != null ? K.process.denitRate : 0.25);

    // 4) 非离子氨 NH₃：pH + 温度决定离解比例（pKa 随温度下降）
    const pKaNH3 = (K.process.pKaNH3_25 != null ? K.process.pKaNH3_25 : 9.25) - 0.03 * (temp - 25);
    const fNH3 = 1 / (1 + Math.pow(10, pKaNH3 - pH));
    const cNH3 = cTan * fNH3;   // mg/L as N
    // NH₃ 毒性阈值随温度修正（EPA 1989 温度依赖：暖水更毒→限值更严；25℃ 时回到基准 0.02/0.01 mg/L(N)）
    const nh3TempCoef = K.process.nh3TempCoef != null ? K.process.nh3TempCoef : 0.0283; // 每℃ 修正指数（≈Q10 1.9 / 10℃）
    const nh3AcuteT = (K.process.nh3Acute != null ? K.process.nh3Acute : 0.02) * Math.pow(10, nh3TempCoef * (25 - temp));
    const nh3ChronicT = (K.process.nh3Chronic != null ? K.process.nh3Chronic : 0.01) * Math.pow(10, nh3TempCoef * (25 - temp));

    // v1.17.0：微滤机(单级 df.tssRemoval) + 二级固液分离(secondarySolidsCapture)串联，
    // 有效去除率 = 1 − (1−drum)(1−secondary)；仅用于 TSS 稳态校核，不改经济/能耗口径。
    const tssRemovalEff = 1 - (1 - df.tssRemoval) * (1 - (K.process.secondarySolidsCapture != null ? K.process.secondarySolidsCapture : 0));
    const cTss = (tssDaily * 1000) / (tssRemovalEff * recircFlow + makeupFlow);
    // v1.17.0：pH 限值按水型区分——海水/半咸水(matlFactor>1)用更宽的海水带(phLowMarine/phHighMarine)，
    // 避免把海水碳酸平衡(pK1 更低→稳态 pH 偏低)误判为超限。
    const phLo = matlFactor > 1 ? (wq.phLowMarine != null ? wq.phLowMarine : wq.phLow) : wq.phLow;
    const phHi = matlFactor > 1 ? (wq.phHighMarine != null ? wq.phHighMarine : wq.phHigh) : wq.phHigh;
    // P0-1 DO 闭环：供氧覆盖鱼代谢+硝化时池内可达 DO；供氧不足按比例下降并计缺口
    const o2Delivered = o2Supply * ox.transferEff;                    // kg/h 实际注入水体的氧（扣除传质损失）
    const o2Margin = o2DemandH > 0 ? (o2Delivered - o2DemandH) / o2DemandH * 100 : 999;
    const o2Ratio = o2DemandH > 0 ? Math.min(1, o2Delivered / o2DemandH) : 1;
    const o2Achieved = o2Ratio >= 1 ? doTarget : round(doTarget * o2Ratio, 2);
    const o2Deficit = Math.max(0, round(doMinV - o2Achieved, 2));
    // P2-2 CO₂–O₂ 交互：高 CO₂（鱼类高碳酸血经 Bohr 效应）降低氧利用率→有效溶解氧低于仪表读数
    const co2DoeThresh = K.process.co2DoeThresh != null ? K.process.co2DoeThresh : 16;  // mg/L CO₂ 折减起效阈值（典型 RAS 控 CO₂<15）
    const co2DoeScale = K.process.co2DoeScale != null ? K.process.co2DoeScale : 40;     // mg/L 折减尺度（超出阈值每 40 mg/L 折减 1.0，封顶 50%）
    const co2DoePenalty = cCo2 > co2DoeThresh ? Math.min(0.5, (cCo2 - co2DoeThresh) / co2DoeScale) : 0;
    const effectiveDo = o2Achieved * (1 - co2DoePenalty);
    const effDoDeficit = Math.max(0, round(doMinV - effectiveDo, 2));
    const st = (v, hard, soft, lowerBetter) => lowerBetter
      ? (v > hard ? "fail" : v > soft ? "warn" : "ok")
      : (v < hard ? "fail" : v < soft ? "warn" : "ok");
    const checks = [
      { key: "tan", name: "总氨氮 TAN", value: round(cTan, 2), unit: "mg/L", limit: tanHard, status: st(cTan, tanHard, tanHard * 1.5, true), note: "AOB 亚硝化 + 补水稀释" },
      { key: "no2", name: "亚硝态氮 NO₂", value: round(cNo2, 2), unit: "mg/L", limit: no2Hard, status: st(cNo2, no2Hard, no2Hard * 1.5, true), note: "NOB 硝化(NO₂→NO₃)，速率高于 AOB" },
      { key: "no3", name: "硝态氮 NO₃-N", value: round(no3Nmg, 1), unit: "mg/L（以 N 计）", limit: 300, status: st(no3Nmg, 300, wq.no3SoftCap, true), note: denitRemoval > 0 ? `反硝化脱除 ${Math.round(denitRemoval * 100)}%，剩余随补水交换` : "仅随补水交换，需排换水或反硝化" },
      { key: "co2", name: "二氧化碳 CO₂", value: round(cCo2, 1), unit: "mg/L", limit: wq.co2Max * 2, status: st(cCo2, wq.co2Max * 2, wq.co2Max, true), note: `脱气塔脱除 ${round(co2Stripped, 1)} kg/天 + 开放水面天然挥发 ~${round(co2Natural, 1)} kg/天 + 补水稀释` },
      { key: "alk", name: "碱度(以CaCO₃计)", value: round(cAlkSys, 0), unit: "mg/L", limit: alkMin, status: (nahco3PerKgFish > 1.5 || cAlkSys < alkMin) ? "fail" : (nahco3PerKgFish > 0.8 || (doseM === 0 && cAlkSys < alkTarget)) ? "warn" : "ok", note: doseM > 0 ? `需投加 NaHCO₃ ${round(nahco3Day, 1)} kg/天(≈${round(nahco3PerKgFish, 3)} kg/kg鱼)` : "源水碱度充足，无需投加" },
      { key: "ph", name: "pH", value: round(pH, 2), unit: "", limit: `${phLo}–${phHi}${matlFactor > 1 ? "（海水带）" : ""}`, status: (pH < phLo || pH > wq.phHighHard) ? "fail" : (pH > phHi ? "warn" : "ok"), note: `CO₂ ${round(cCo2, 1)} mg/L + 碱度 ${round(cAlkSys, 0)} mg/L 碳酸平衡${matlFactor > 1 ? "（海水碳酸标度）" : ""}` },
      { key: "nh3", name: "非离子氨 NH₃", value: round(cNH3, 4), unit: "mg/L(N)", limit: round(nh3AcuteT, 4), status: cNH3 > nh3AcuteT ? "fail" : (cNH3 > nh3ChronicT ? "warn" : "ok"), note: `TAN ${round(cTan, 2)} × 离解率 ${round(fNH3 * 100, 1)}% (pKa ${round(pKaNH3, 2)})；温度修正限值 急${round(nh3AcuteT, 4)}/慢${round(nh3ChronicT, 4)} @${Math.round(temp)}℃` },
      { key: "tss", name: "悬浮固体 TSS", value: round(cTss, 1), unit: "mg/L", limit: wq.ssMax, status: st(cTss, wq.ssMax, wq.ssMax * 1.5, true), note: "微滤机去除" },
      { key: "do", name: "有效溶氧 DO", value: round(effectiveDo, 1), unit: "mg/L", limit: doMinV, status: effDoDeficit > 0.1 ? "fail" : "ok", note: "池内实测 " + round(o2Achieved, 1) + " mg/L" + (co2DoePenalty > 0 ? "；高 CO₂(" + round(cCo2, 1) + " mg/L)经 Bohr 效应折减 " + Math.round(co2DoePenalty * 100) + "%→有效 " + round(effectiveDo, 1) : "") + "；供氧余量 " + round(o2Margin, 0) + "%" },
    ];
    // P1-2 尾水排放污染物浓度（v1.13.8，对照 DB44/2462-2024 合规）：稳态质量平衡推算排放口浓度（与循环水同浓度）
    const cTn = cTan + cNo2 + no3Nmg; // mg/L as N — 总氮 = TAN + NO₂ + NO₃（均以 N 计）
    const pDaily = dailyFeedAvg * (K.process.feedPContent != null ? K.process.feedPContent : 0.012)
                 * (K.process.pExcreteFrac != null ? K.process.pExcreteFrac : 0.35); // kg P/天 排泄磷负荷
    const cTp = makeupFlow > 0
      ? (pDaily * 1000) / ((K.process.pCapture != null ? K.process.pCapture : 0.85) * recircFlow + makeupFlow)
      : 9999; // mg/L 总磷（无补水排换则累积）
    const codDaily = dailyFeedAvg * (K.process.codPerFeed != null ? K.process.codPerFeed : 0.45); // kg COD/天 有机负荷
    const cCod = makeupFlow > 0
      ? (codDaily * 1000) / ((K.process.codCapture != null ? K.process.codCapture : 0.80) * recircFlow + makeupFlow)
      : 9999; // mg/L COD(Mn)（无补水排换则累积）
    const waterType = (matlFactor > 1 || (sp.salinity != null && sp.salinity > 0.5)) ? "seawater" : "freshwater";
    const dischargeLevel = (inputs && inputs.dischargeLevel === 1) ? 1 : 2;
    // v1.13.9 末端处理二次削减：排放口经尾水单元处理后浓度
    const cTnPol = cTn * (1 - twTech.tn);
    const cTpPol = cTp * (1 - twTech.tp);
    const cCodPol = cCod * (1 - twTech.cod);
    const cTssPol = cTss * (1 - twTech.ss);
    const tailwater = tailwaterCompliance({ cTn: cTnPol, cTp: cTpPol, cCod: cCodPol, cTss: cTssPol, pH, waterType, dischargeLevel }, K);
    const wqStatus = checks.some((c) => c.status === "fail") ? "fail"
      : (checks.some((c) => c.status === "warn") ? "warn" : "ok");
    const waterQuality = {
      checks, status: wqStatus, feasible: wqStatus !== "fail",
      o2Margin: round(o2Margin, 0), o2Sat: round(o2SatV, 1), doTarget: round(doTarget, 1),
      o2Achieved: round(o2Achieved, 2), o2Deficit: round(o2Deficit, 2),
      effectiveDo: round(effectiveDo, 2), effDoDeficit: round(effDoDeficit, 2), co2DoePenalty: round(co2DoePenalty, 3),
      co2Stripped: round(co2Stripped, 1),
      co2Natural: round(co2Natural, 1),
      ph: round(pH, 2),
      cAlk: round(cAlkSys, 0),
      alkConsumeDay: round(alkConsumeDay, 1),
      nahco3Day: round(nahco3Day, 1),
      nahco3PerKgFish: round(nahco3PerKgFish, 3),
      nh3: round(cNH3, 4),
      fNH3: round(fNH3, 4),
      no3N: round(no3Nmg, 1),
      denit: {
        removal: round(denitRemoval, 2),
        volume: round(denitVol, 1),
        no3NLoadDaily: round(tanDaily * (1 - denitRemoval), 2),
      },
      cTn: round(cTn, 2),
      cTp: round(cTp, 3),
      cCod: round(cCod, 1),
      tailwater,
    };

    return {
      species: sp,
      inputs: { annual, density, cycles, turns, makeup, sf, temp, elec, fcr, salePrice,
        feedPrice: inputs.feedPrice || null, fingerlingPrice: inputs.fingerlingPrice || null,
        elecPrice: inputs.elecPrice || null, waterPrice: inputs.waterPrice || null,
        pvKWp: inputs.pvKWp || null, pvFraction: inputs.pvFraction || null, batteryKWh: inputs.batteryKWh || null,
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
        sludgeWaterVolYr: round(sludgeWaterVolYr),
        drumBackwashVolYr: round(drumBackwashVolYr),
        degasserMistVolYr: round(degasserMistVolYr),
        waterConsumption: round(waterConsumption, 5),
        evapFrac: round(evapFracOfRecirc, 4),
        evapCovered: waterCovered,
        waterCovered: waterCovered,
      },
      environment: {
        carbonFactor: round(carbonFactor, 3),
        gridLabel: regionDef && regionDef.name ? regionDef.name : "未指定地区(全国均值)",
        annualCarbon: round(annualCarbon),
        annualCarbonT: round(annualCarbon / 1000, 2),
        carbonPerKg: round(carbonPerKg, 4),
      },
      biofilter: {
        type: bf.type, rate: round(nitrRate, 3), rateEff: round(rNitritEff, 3),
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
        capexDirect: round(capexDirect),
        capexEpcm: round(capexEpcm),
        capexCommissioning: round(capexCommissioning),
        capexContingency: round(capexContingency),
        capexOther: round(capexOther),
        capexIndirect: round(capexIndirect),
        capexLand: round(capexLand),
        capexTotal: round(capexTotal),
        capexTailwater: round(capexTail),
        opexTailwater: round(opexTailYr),
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
        finance: {
          discountRate, loanRatio, loanRate, loanYears, depYears,
          npv: round(npv), irr: irr != null ? round(irr * 100, 1) : null,
          discountedPayback: discountedPayback != null ? round(discountedPayback, 1) : null,
          ebitda: round(ebitda), equityInvest: round(equityInvest),
          loanPrincipal: round(loanPrincipal), annualInterest: round(annualInterest), annualPrincipal: round(annualPrincipal),
        },
        // v1.16.0 PV 光伏模块输出（接入项目 NPV/IRR：pvCapex 已并入 capexTotal，pvOpex/上网收入已并入 opex/revenue）
        pv: {
          enabled: pvKWp > 0,
          kWp: round(pvKWp, 1),
          batteryKWh: round(batteryKWh, 0),
          selfUseRatio: pvKWp > 0 ? round(pvSelfUse, 3) : null,
          annualGenKwh: round(pvGenKwh),
          selfKwh: round(pvSelfKwh),
          exportKwh: round(pvExportKwh),
          elecSaved: round(pvElecSaved),
          exportIncome: round(pvExportIncome),
          opex: round(pvOpex),
          capex: round(pvCapex),
          paybackYears: pvPayback != null ? round(pvPayback, 2) : null,
          irr: pvIrr != null ? round(pvIrr * 100, 1) : null,
        },
      },
      waterQuality,
      compliance: tailwater,
      tailwaterTreatment: {
        key: twTechKey, name: twTech.name,
        cTnRaw: round(cTn, 2), cTnPol: round(cTnPol, 2),
        cTpRaw: round(cTp, 3), cTpPol: round(cTpPol, 3),
        cCodRaw: round(cCod, 1), cCodPol: round(cCodPol, 1),
        cTssRaw: round(cTss, 1), cTssPol: round(cTssPol, 1),
        treatedM3d: round(twTreatedM3d, 1),
        capex: round(capexTail), opexYr: round(opexTailYr), footprint: round(footprintTail, 1),
        removal: { tn: round(twTech.tn, 2), tp: round(twTech.tp, 2), cod: round(twTech.cod, 2), ss: round(twTech.ss, 2) },
      },
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
      // M13(v1.14.0)：硬约束水质可行性——拒绝 WQ=fail 的"最优解"（除非显式 opts.requireWqOk=false 关闭）
      if (opts.requireWqOk !== false && d.waterQuality && d.waterQuality.feasible === false) return false;
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
      // 固定产量，搜索密度/循环/池径/补水/安全系数/温度/地区，按目标最小化
      // v1.15.0 M15：FCR 不再作为独立决策变量，改由密度经 M5 耦合推导（compute() 不传 fcr 即生效）
      const energyObj = (obj === "minEnergy" || obj === "pareto");
      const densList = range(sp.stockingDensity * 0.7, sp.stockingDensity * 1.25, energyObj ? 10 : 5);
      const turnsList = energyObj ? [8, 10, 12, 14] : [6, 8, 10, 12, 14, 16, 18, 20];
      const diamList = [6, 8, 10, 12];
      const makeList = [0.005, 0.01, 0.02, 0.03];
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
              for (const sf of sfList)
                for (const dt of tempList)
                  for (const [rkey, rdef] of ambEntries) {
                    const d = compute({
                      speciesKey: opts.speciesKey, annualTons: opts.annualTons,
                      targetDensity: density, recircTurns: turns, makeupRate: mk,
                      safety: sf, designTemp: dt, ambientTemp: rdef.ambient, region: rkey,
                    });
                    if (!feasible(d)) continue;
                    candidates.push({
                      d, cost: d.economics.capexTotal, energy: d.energy.energyIntensity,
                      area: d.building.buildingArea,
                      vars: { density, turns, tankD: D, makeup: mk, fcr: d.inputs.fcr, sf, designTemp: dt, ambientTemp: rdef.ambient, region: rkey },
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
    // v1.15.0 M14：maxMargin 最大化毛利率；minRisk 最小化"能耗+资本"归一化暴露（越稳越优）
    else if (obj === "maxMargin") chosen = candidates.slice().sort((a, b) => (b.d.economics.marginRate || -1e9) - (a.d.economics.marginRate || -1e9))[0];
    else if (obj === "minRisk") {
      const eMin = candidates.reduce((m, c) => Math.min(m, c.energy), Infinity);
      const eMax = candidates.reduce((m, c) => Math.max(m, c.energy), -Infinity);
      const cMin = candidates.reduce((m, c) => Math.min(m, c.cost), Infinity);
      const cMax = candidates.reduce((m, c) => Math.max(m, c.cost), -Infinity);
      const norm = (v, lo, hi) => hi > lo ? (v - lo) / (hi - lo) : 0;
      const riskOf = (c) => norm(c.energy, eMin, eMax) + norm(c.cost, cMin, cMax);
      chosen = candidates.slice().sort((a, b) => riskOf(a) - riskOf(b))[0];
    }
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
    // 用户可自定义输入的有效当前值（未显式设置时回退到品种/知识库默认），用于水价/电价等敏感度
    const sp0 = (d.inputs.speciesKey && K.species && K.species[d.inputs.speciesKey]) || null;
    const op0 = (K.economics && K.economics.opex) || {};
    const reg0 = (d.inputs.region && K.climate.regions && K.climate.regions[d.inputs.region]) || null;
    const regPower0 = reg0 && reg0.powerIndex != null ? reg0.powerIndex : 1;
    const effCur = {
      fcr: (d.inputs.fcr && d.inputs.fcr > 0) ? d.inputs.fcr : (sp0 ? sp0.fcr : 1.3),
      waterPrice: (d.inputs.waterPrice > 0) ? d.inputs.waterPrice : (op0.waterPrice != null ? op0.waterPrice : 5),
      elecPrice: (d.inputs.elecPrice > 0) ? d.inputs.elecPrice : (op0.elecPrice != null ? op0.elecPrice : 0.7) * regPower0,
      salePrice: (d.inputs.salePrice > 0) ? d.inputs.salePrice : (sp0 && sp0.marketPrice ? sp0.marketPrice : (K.economics.salePrice != null ? K.economics.salePrice : 22)),
    };
    const drivers = [
      { label: "放养密度", effKey: "density", setKey: "targetDensity", pct: 0.2 },
      { label: "日循环次数", effKey: "turns", setKey: "recircTurns", pct: 0.2 },
      { label: "补水率", effKey: "makeup", setKey: "makeupRate", pct: 0.5 },
      { label: "饲料系数 FCR", effKey: "fcr", setKey: "fcr", pct: 0.2 },
      { label: "安全系数", effKey: "sf", setKey: "safety", pct: 0.2 },
      { label: "生产水价", effKey: "waterPrice", setKey: "waterPrice", pct: 0.4 },
      { label: "电价", effKey: "elecPrice", setKey: "elecPrice", pct: 0.3 },
    ];
    // 售价仅影响利润类指标；对成本/能耗指标纳入会产生恒为 0 的误导跨度，故仅 grossProfit 时列入
    if (metric === "grossProfit") {
      drivers.push({ label: "预估鱼价", effKey: "salePrice", setKey: "salePrice", pct: 0.2 });
    }
    const rows = drivers.map((dr) => {
      const v0 = (effCur[dr.effKey] != null) ? effCur[dr.effKey] : eff[dr.effKey];
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

  /* ============== Sobol 全局敏感性 · 主导因子方差分解（P1-3） ==============
   * 对 knowledge.uncertainty.params 的模型系数做 Saltelli(2010) 方差分解：
   *   一阶  S_i  = (1/N·Σ Y_B·Y_ABi − f0²) / V          // 该系数单独贡献的方差占比
   *   总阶  ST_i = (1/(2N)·Σ (Y_A − Y_ABi)²) / V         // 含与其他系数交互的总贡献
   * 抽样覆盖"模型系数"(K.uncertainty.params) 与"用户可自定义输入"(饲料系数/生产水价/电价/鱼价，
   * 围绕当前生效值 ±band 采样) 两组，复用与 monteCarlo 相同的三角分布；模型系数经 withOverrides
   * 注入知识库、用户参数经 inputs 注入。分组见各 index 的 group 字段(model/user)。
   * 采样：A/B 独立矩阵 + 各 A_Bi（A 第 i 列替换为 B 的第 i 列）→ 总评估 N·(k+2)。
   * 内置可复现 PRNG(mulberry32)，同一 seed 结果固定，便于审计与复核。
   */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // 用户可自定义输入的"敏感度扩展集"：围绕当前生效值做 ±band 三角采样，
  // 与模型系数一起纳入 Sobol 全局方差分解。这些是用户自设的经营/经济参数，
  // 对成本与利润影响显著（饲料系数/生产水价/电价/鱼价），敏感度分析必须覆盖。
  // 注意：蒙特卡洛(monteCarlo)仍只扰动模型系数，保持"不改用户数据"原则；
  // 此处仅把用户参数作为"敏感度输入"参与方差分解（只读、不改写用户值）。
  function buildUserSensParams(inp) {
    const sp = (inp && inp.speciesKey && K.species && K.species[inp.speciesKey]) || null;
    const ec = K.economics || {};
    const op = (ec && ec.opex) || {};
    const reg = (inp && inp.region && K.climate.regions && K.climate.regions[inp.region]) || null;
    const regPower = reg && reg.powerIndex != null ? reg.powerIndex : 1;
    const defs = [
      { key: "fcr", label: "饲料系数 FCR", band: 0.20,
        cur: (inp && inp.fcr && inp.fcr > 0) ? inp.fcr : (sp ? sp.fcr : 1.3) },
      { key: "waterPrice", label: "生产水价", band: 0.40,
        cur: (inp && inp.waterPrice > 0) ? inp.waterPrice : (op.waterPrice != null ? op.waterPrice : 5) },
      { key: "elecPrice", label: "电价", band: 0.30,
        cur: (inp && inp.elecPrice > 0) ? inp.elecPrice : (op.elecPrice != null ? op.elecPrice : 0.7) * regPower },
      { key: "salePrice", label: "预估鱼价", band: 0.20,
        cur: (inp && inp.salePrice && inp.salePrice > 0) ? inp.salePrice : (sp && sp.marketPrice ? sp.marketPrice : (ec.salePrice != null ? ec.salePrice : 22)) },
    ];
    return defs.map((d) => ({
      key: d.key, label: d.label, group: "user", inputKey: d.key,
      low: round(d.cur * (1 - d.band), 4), exp: round(d.cur, 4), high: round(d.cur * (1 + d.band), 4),
    }));
  }
  function sobol(inputs, opts) {
    opts = opts || {};
    const N = opts.N && opts.N > 0 ? opts.N : 1024;
    const modelParams = (K.uncertainty && K.uncertainty.params) || [];
    const userSens = buildUserSensParams(inputs);
    const params = modelParams.concat(userSens);
    const k = params.length;
    const metrics = ["costPerKg", "energyIntensity", "capexTotal", "grossProfit", "paybackYears", "marginRate"];
    const metricUnit = { costPerKg: "元/kg", energyIntensity: "kWh/kg", capexTotal: "元", grossProfit: "元", paybackYears: "年", marginRate: "%" };
    function pickMetric(d, key) {
      if (key === "energyIntensity") return d.energy.energyIntensity;
      if (key === "capexTotal") return d.economics.capexTotal;
      if (key === "grossProfit") return d.economics.grossProfit;
      if (key === "paybackYears") return d.economics.paybackYears;
      if (key === "marginRate") return d.economics.marginRate;
      return d.economics.costPerKg;
    }
    if (!k) return { N, seed: opts.seed != null ? opts.seed : 0x9e3779b9, params: [], metrics: {} };

    const seed0 = opts.seed != null ? opts.seed : 0x9e3779b9;
    const rng = mulberry32(seed0);
    function triR(low, mode, high) {
      if (!(high > low)) return mode;
      const u = rng();
      const fc = (mode - low) / (high - low);
      if (u < fc) return low + Math.sqrt(u * (high - low) * (mode - low));
      return high - Math.sqrt((1 - u) * (high - low) * (high - mode));
    }
    // 采样矩阵 A / B（均 N×k）
    const A = [], B = [];
    for (let j = 0; j < N; j++) {
      const ra = new Array(k), rb = new Array(k);
      for (let i = 0; i < k; i++) { ra[i] = triR(params[i].low, params[i].exp, params[i].high); rb[i] = triR(params[i].low, params[i].exp, params[i].high); }
      A.push(ra); B.push(rb);
    }
    // 整行评估（同时注入全部 k 个系数）——inputKey 经 inputs、其余经知识库 withOverrides
    function evalRow(row) {
      const inp = Object.assign({}, inputs);
      const over = {};
      for (let i = 0; i < k; i++) {
        const p = params[i];
        if (p.inputKey) inp[p.inputKey] = row[i];
        else over[p.path] = row[i];
      }
      return withOverrides(over, () => compute(inp));
    }
    // Y_A, Y_B
    const yA = {}, yB = {};
    metrics.forEach((m) => { yA[m] = new Array(N); yB[m] = new Array(N); });
    for (let j = 0; j < N; j++) {
      const dA = evalRow(A[j]), dB = evalRow(B[j]);
      metrics.forEach((m) => { yA[m][j] = pickMetric(dA, m); yB[m][j] = pickMetric(dB, m); });
    }
    // Y_ABi：A 第 i 列替换为 B 第 i 列
    const yAB = [];
    for (let i = 0; i < k; i++) { yAB[i] = {}; metrics.forEach((m) => (yAB[i][m] = new Array(N))); }
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < N; j++) {
        const row = A[j].slice(); row[i] = B[j][i];
        const dAB = evalRow(row);
        metrics.forEach((m) => (yAB[i][m][j] = pickMetric(dAB, m)));
      }
    }
    const clamp01 = (x) => (x > 1 ? 1 : x < 0 ? 0 : x);
    const out = { N, seed: seed0, params: params.map((p) => ({ key: p.key, label: p.label, group: p.group || "model" })), metrics: {} };
    metrics.forEach((m) => {
      // 有限性预检（任一非有限则跳过该指标）
      let ok = true;
      for (let j = 0; j < N && ok; j++) { if (!isFinite(yA[m][j]) || !isFinite(yB[m][j])) ok = false; }
      for (let i = 0; i < k && ok; i++) for (let j = 0; j < N && ok; j++) { if (!isFinite(yAB[i][m][j])) ok = false; }
      if (!ok) { out.metrics[m] = { unit: metricUnit[m], valid: false, indices: [], dominant: null, note: "存在非有限输出，已跳过" }; return; }
      let mean = 0; for (let j = 0; j < N; j++) mean += yA[m][j]; mean /= N;
      let varr = 0; for (let j = 0; j < N; j++) { const dd = yA[m][j] - mean; varr += dd * dd; } varr /= N;
      if (varr < 1e-15) { out.metrics[m] = { unit: metricUnit[m], mean: round(mean, 3), valid: true, indices: [], dominant: null, note: "输出方差≈0（结果对各因子均不敏感）" }; return; }
      const indices = [];
      for (let i = 0; i < k; i++) {
        let sumS = 0, sumST = 0;
        for (let j = 0; j < N; j++) {
          const yb = yB[m][j], ya = yA[m][j], yab = yAB[i][m][j];
          sumS += yb * yab;                       // Saltelli 2010 一阶
          sumST += (ya - yab) * (ya - yab);       // Saltelli 2010 总阶
        }
        let S = (sumS / N - mean * mean) / varr;
        let ST = (sumST / (2 * N)) / varr;
        S = clamp01(S); ST = clamp01(ST);
        indices.push({ key: params[i].key, label: params[i].label, group: params[i].group || "model", S: round(S, 3), ST: round(ST, 3), interaction: round(Math.max(0, ST - S), 3) });
      }
      indices.sort((a, b) => b.ST - a.ST);
      out.metrics[m] = {
        unit: metricUnit[m], valid: true, mean: round(mean, 3), variance: round(varr, 4),
        indices, dominant: indices[0] ? indices[0].label : null,
        top2: indices.slice(0, 2).map((x) => x.label),
        stSum: round(indices.reduce((s, x) => s + x.ST, 0), 3),
      };
    });
    return out;
  }

  // 经济数值格式化（人民币）
  function rmb(v) {
    if (v >= 10000) return (v / 10000).toLocaleString("zh-CN", { maximumFractionDigits: 1 }) + " 万元";
    return Math.round(v).toLocaleString("zh-CN") + " 元";
  }

  /*
   * 尾水排放合规判定（v1.13.8）
   * 对照广东省《水产养殖尾水排放标准》DB44/2462-2024 淡水/海水 × 一级/二级 五项限值
   * 判定 pH / 悬浮物 / COD(Mn) / 总氮 TN / 总磷 TP 是否达标。
   * opts: { cTn, cTp, cCod, cTss, pH, waterType: "freshwater"|"seawater", dischargeLevel: 1|2 }
   * 返回 { available, standardName, waterType, level, limit, items[], allPass, status }
   *   items[]: { key, name, value, unit, limit, pass, status }
   */
  function tailwaterCompliance(opts, K2) {
    const KK = K2 || K;
    const std = (KK.standards && KK.standards.db44_2462_2024) || null;
    if (!std) return { available: false };
    const wt = opts.waterType === "seawater" ? "seawater" : "freshwater";
    const lvl = opts.dischargeLevel === 1 ? 1 : 2;
    const lim = std[wt]["level" + lvl];
    const items = [
      { key: "ph", name: "pH", value: round(opts.pH, 2), unit: "",
        limitStr: `${lim.phLow}–${lim.phHigh}`, limit: lim.phHigh,
        pass: opts.pH >= lim.phLow && opts.pH <= lim.phHigh },
      { key: "ss", name: "悬浮物 SS", value: round(opts.cTss, 1), unit: "mg/L",
        limitStr: `${lim.ss}`, limit: lim.ss, pass: opts.cTss <= lim.ss },
      { key: "cod", name: "化学需氧量 COD(Mn)", value: round(opts.cCod, 1), unit: "mg/L",
        limitStr: `${lim.cod}`, limit: lim.cod, pass: opts.cCod <= lim.cod },
      { key: "tn", name: "总氮 TN", value: round(opts.cTn, 2), unit: "mg/L（以 N 计）",
        limitStr: `${lim.tn}`, limit: lim.tn, pass: opts.cTn <= lim.tn },
      { key: "tp", name: "总磷 TP", value: round(opts.cTp, 3), unit: "mg/L",
        limitStr: `${lim.tp}`, limit: lim.tp, pass: opts.cTp <= lim.tp },
    ];
    items.forEach((it) => { it.status = it.pass ? "ok" : "fail"; });
    const allPass = items.every((it) => it.pass);
    return {
      available: true,
      standardName: std.name,
      waterType: wt,
      level: lvl,
      limit: lim,
      items,
      allPass,
      status: allPass ? "ok" : "fail",
    };
  }

  return { compute, optimize, sensitivity, monteCarlo, sobol, round, fmt, rmb, tailwaterCompliance };
})();
