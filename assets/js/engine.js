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
    const makeup = inputs.makeupRate || 0.01;         // 补水率(占循环量)
    const sf = inputs.safety || 1.15;                 // 安全系数
    const temp = inputs.designTemp || sp.designTemp;
    const elec = inputs.elecPrice || K.economics.opex.elecPrice;

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
    const tanPerFeed = 0.037;
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
    const o2Daily = dailyFeedAvg * ox.o2PerFeed;
    const o2Peak = dailyFeedPeak * ox.o2PerFeed;
    const o2HourPeak = o2Peak / 24;
    const o2Supply = o2HourPeak / ox.transferEff * sf;
    const deg = K.equipment.degasser;
    const co2Prod = o2Daily * 0.9;
    const co2Hour = co2Prod / 24;

    // —— 6. 固废处理 ——
    const df = K.equipment.drumFilter;
    const tssPerFeed = 0.25;
    const tssDaily = dailyFeedAvg * tssPerFeed;
    const drumUnits = Math.max(1, Math.ceil(recircFlowH / 300));
    const drumEachFlow = recircFlowH / drumUnits;

    // —— 7. 能耗估算 ——
    const pu = K.equipment.pump;
    const pumpQ = recircFlowH / 3600;
    const pumpPower = (1000 * 9.81 * pumpQ * pu.head) / (pu.eff * 1000);
    const oxyPower = o2Supply / 3.0;
    const fanPower = co2Hour * 0.05;
    const tempLoad = totalTankVol * 0.012;
    const hvacPower = tempLoad / pu.eff;
    const miscPower = totalTankVol * 0.003;
    const totalPower = pumpPower + oxyPower + fanPower + hvacPower + miscPower;
    const energyIntensity = (totalPower * 24 * 365) / annual;
    const annualEnergy = totalPower * 24 * 365 / 1000;

    // —— 8. 建筑面积 ——
    const tankFootprint = tankCount * (tankD * 1.4) * (tankD * 1.4);
    const equipArea = bfTotalVol * 6 + drumUnits * 12 + 120;
    const buildingArea = (tankFootprint + equipArea) * 1.15;
    const buildingVol = buildingArea * 6;

    // —— 9. 经济估算 ——
    const ec = K.economics;
    const cpx = ec.capexPerM3;
    const capexTanks = totalTankVol * cpx.tanks;
    const capexBio = totalTankVol * cpx.biofilter;
    const capexSolids = totalTankVol * cpx.solids;
    const capexOxy = totalTankVol * cpx.oxygen;
    const capexPumps = totalTankVol * cpx.pumps;
    const capexCtl = totalTankVol * cpx.controls;
    const capexBuilding = buildingArea * cpx.building;
    const capexHvac = totalTankVol * cpx.hvac;
    const capexTotal =
      capexTanks + capexBio + capexSolids + capexOxy +
      capexPumps + capexCtl + capexBuilding + capexHvac;

    const op = ec.opex;
    const opexFeed = annualFeed * op.feedPrice;
    const harvestNum = annual / (sp.harvestSize / 1000);
    const opexFinger = harvestNum * op.fingerlingPrice;
    const opexElec = annualEnergy * 1000 * op.elecPrice;
    const opexLabor = op.laborPerYear * op.laborCount;
    const opexMaint = capexTotal * op.maintenanceRate;
    const opexTotal = opexFeed + opexFinger + opexElec + opexLabor + opexMaint;
    const costPerKg = opexTotal / annual;

    return {
      species: sp,
      inputs: { annual, density, cycles, turns, makeup, sf, temp, elec, fcr },
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
        capexTanks: round(capexTanks),
        capexBio: round(capexBio),
        capexSolids: round(capexSolids),
        capexOxy: round(capexOxy),
        capexPumps: round(capexPumps),
        capexCtl: round(capexCtl),
        capexBuilding: round(capexBuilding),
        capexHvac: round(capexHvac),
        capexTotal: round(capexTotal),
        opexFeed: round(opexFeed),
        opexFinger: round(opexFinger),
        opexElec: round(opexElec),
        opexLabor: round(opexLabor),
        opexMaint: round(opexMaint),
        opexTotal: round(opexTotal),
        costPerKg: round(costPerKg, 1),
        harvestNum: Math.round(harvestNum),
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
        candidates.push({ d, score: -d._raw.annual, vars: { annualTons: p, density: dens, turns } });
      }
    } else {
      // 固定产量，搜索密度/循环/池径/补水，按目标最小化
      const densList = range(sp.stockingDensity * 0.7, sp.stockingDensity * 1.25, 5);
      const turnsList = [6, 8, 10, 12, 14, 16, 18, 20];
      const diamList = [6, 8, 10, 12];
      const makeList = [0.005, 0.01, 0.02, 0.03];
      for (const density of densList)
        for (const turns of turnsList)
          for (const D of diamList)
            for (const mk of makeList) {
              const d = compute({
                speciesKey: opts.speciesKey, annualTons: opts.annualTons,
                targetDensity: density, recircTurns: turns, makeupRate: mk, designTemp: opts.designTemp,
              });
              if (!feasible(d)) continue;
              let score;
              if (obj === "minEnergy") score = d.energy.energyIntensity;
              else score = d.economics.capexTotal; // minCost
              candidates.push({ d, score, vars: { density, turns, tankD: D, makeup: mk } });
            }
    }

    if (!candidates.length) {
      const reasons = [];
      if (c.maxBudget) reasons.push(`预算≤${c.maxBudget}万元`);
      if (c.maxArea) reasons.push(`面积≤${c.maxArea}m²`);
      if (c.maxEnergy) reasons.push(`能耗≤${c.maxEnergy}kWh/kg`);
      return { ok: false, baseline, reason: "无满足约束的方案，请放宽 " + (reasons.join(" / ") || "约束") };
    }

    candidates.sort((a, b) => a.score - b.score);
    const best = candidates[0].d;
    const top = candidates.slice(0, 6).map((cand) => ({
      yield: cand.d.culture.actualYield,
      capEx: cand.d.economics.capexTotal,
      costPerKg: cand.d.economics.costPerKg,
      energy: cand.d.energy.energyIntensity,
      area: cand.d.building.buildingArea,
      vars: cand.vars,
    }));
    return { ok: true, baseline, best, vars: candidates[0].vars, top, count: candidates.length };
  }

  // 经济数值格式化（人民币）
  function rmb(v) {
    if (v >= 10000) return (v / 10000).toLocaleString("zh-CN", { maximumFractionDigits: 1 }) + " 万元";
    return Math.round(v).toLocaleString("zh-CN") + " 元";
  }

  return { compute, optimize, round, fmt, rmb };
})();
