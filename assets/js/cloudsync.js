/*
 * AquaRAS 云端同步模块
 * 把前端方案库对接 Laravel 后端（/api/ras/designs）做真·多端同步。
 * 纯逻辑、无 DOM，便于在 Node 中单元验证。
 * 字段映射契约与 laravel/app/Http/Controllers/Api/RasController.php 对齐。
 */
window.RAS = window.RAS || {};
(function () {
  "use strict";
  const R = window.RAS;
  const LS_BASE = "ras-cloud-base";
  const LS_MODE = "ras-cloud-mode"; // "local" | "cloud"

  /* 把后端返回的完整计算结果 d 压成对比/列表用的摘要（与前端 compactSummary 同口径） */
  function summarize(d) {
    if (!d) return null;
    const sp = d.species || {};
    return {
      species: sp.name,
      speciesKey: sp.key,
      annual: (d._raw && d._raw.annual) || (d.inputs ? d.inputs.annualTons * 1000 : 0),
      tankCount: d.culture.tankCount,
      tankD: d.culture.tankD,
      totalTankVol: d.culture.totalTankVol,
      recircFlowH: d.hydraulics.recircFlowH,
      waterReuse: d.hydraulics.waterReuse,
      biofilterVol: d.biofilter.totalVol,
      o2Supply: d.oxygen.o2Supply,
      totalPower: d.energy.totalPower,
      energyIntensity: d.energy.energyIntensity,
      buildingArea: d.building.buildingArea,
      actualYield: d.culture.actualYield,
      capexTotal: d.economics.capexTotal,
      opexTotal: d.economics.opexTotal,
      opexWater: d.economics.opexWater,
      costPerKg: d.economics.costPerKg,
      salePrice: d.economics.salePrice,
      revenue: d.economics.revenue,
      grossProfit: d.economics.grossProfit,
      paybackYears: d.economics.paybackYears,
      roi: d.economics.roi,
      marginRate: d.economics.marginRate,
      wqStatus: d.waterQuality ? d.waterQuality.status : null,
      no3: d.waterQuality ? d.waterQuality.checks.find((c) => c.key === "no3").value : null,
      co2: d.waterQuality ? d.waterQuality.checks.find((c) => c.key === "co2").value : null,
    };
  }

  /* 后端 Design JSON -> 前端 scheme 形状 */
  function fromApi(rec) {
    return {
      id: "c" + rec.id,
      _source: "cloud",
      _cloudId: rec.id,
      name: rec.name,
      createdAt: rec.created_at ? Date.parse(rec.created_at) : Date.now(),
      inputs: rec.inputs || {},
      result: rec.result || null,
      summary: summarize(rec.result),
    };
  }

  /* 前端 scheme -> POST /api/ras/designs 的载荷（camelCase，与控制器 validate 对齐） */
  function toPayload(scheme) {
    const inp = scheme.inputs || {};
    return {
      name: scheme.name,
      speciesKey: inp.speciesKey,
      annualTons: inp.annualTons,
      inputs: inp,
      result: scheme.result,
      notes: scheme.notes || null,
    };
  }

  class CloudStore {
    constructor(baseUrl) { this.base = (baseUrl || "").replace(/\/+$/, ""); }
    _url(p) { return this.base + p; }
    async _req(method, path, body) {
      const opt = { method, headers: { Accept: "application/json" } };
      if (body !== undefined) {
        opt.headers["Content-Type"] = "application/json";
        opt.body = JSON.stringify(body);
      }
      const res = await fetch(this._url(path), opt);
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    }
    async list() {
      const j = await this._req("GET", "/api/ras/designs");
      const items = Array.isArray(j) ? j : (j.data || []);
      return items.map(fromApi);
    }
    async get(id) {
      const j = await this._req("GET", "/api/ras/designs/" + id);
      return fromApi(j.data || j);
    }
    async create(payload) {
      const j = await this._req("POST", "/api/ras/designs", payload);
      if (typeof j.id === "number") return j.id;
      throw new Error("no id returned");
    }
    async remove(id) {
      await this._req("DELETE", "/api/ras/designs/" + id);
      return true;
    }
  }

  R.cloud = {
    CloudStore,
    summarize,
    fromApi,
    toPayload,
    getBase: () => (localStorage.getItem(LS_BASE) || "http://localhost:3000").trim(),
    setBase: (v) => localStorage.setItem(LS_BASE, (v || "").trim()),
    getMode: () => localStorage.getItem(LS_MODE) || "local",
    setMode: (v) => localStorage.setItem(LS_MODE, v),
  };
})();
