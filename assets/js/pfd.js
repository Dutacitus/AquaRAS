/*
 * 工艺流程图 (PFD) — SVG 生成
 * 主流程 + 回水闭环 + 补水/排污分支，全部 90° 正交、无斜线、无重叠。
 * 视觉与 P&ID 统一：背景面板 / 栅格 / 投影 / 悬停微交互。
 */
window.RAS = window.RAS || {};

RAS.pfd = (function () {
  function node(x, y, w, h, title, sub, cls, key) {
    return `
      <g class="pfd-node ${cls || ""}" data-key="${key || ""}">
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" class="pfd-box" filter="url(#pfdShadow)"/>
        <text x="${x + w / 2}" y="${y + h / 2 - 4}" class="pfd-title">${title}</text>
        <text x="${x + w / 2}" y="${y + h / 2 + 14}" class="pfd-sub">${sub}</text>
      </g>`;
  }
  function arrow(x1, y1, x2, y2, cls) {
    return `
      <g class="pfd-arrow ${cls || ""}">
        <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="pfd-line"/>
        <polygon points="${x2},${y2} ${x2 - 9},${y2 - 5} ${x2 - 9},${y2 + 5}" class="pfd-head"/>
      </g>`;
  }

  function render(d) {
    const W = 1200, H = 580;
    const eqY = 150, eqH = 86, eqW = 172;
    const xs = [110, 312, 514, 716, 918];
    const cy = eqY + eqH / 2;                 // 主流程中心线 = 193
    const Q = d.hydraulics.recircFlowH;
    const make = d.hydraulics.makeupFlowH;
    const yRet = eqY + eqH + 70;              // 回水管 = 306
    const tkCx = xs[0] + eqW / 2;             // 236
    const uvCx = xs[4] + eqW / 2;             // 1044

    return `<svg viewBox="0 0 ${W} ${H}" class="pfd-svg" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="循环水工艺流程图">
      <defs>
        <filter id="pfdShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#000" flood-opacity="0.16"/>
        </filter>
        <pattern id="pfdGrid" width="30" height="30" patternUnits="userSpaceOnUse">
          <circle cx="1.2" cy="1.2" r="1.1" fill="rgba(120,140,170,0.16)"/>
        </pattern>
      </defs>

      <rect x="6" y="6" width="${W - 12}" height="${H - 12}" rx="18" class="pid-bg"/>
      <rect x="6" y="6" width="${W - 12}" height="${H - 12}" rx="18" fill="url(#pfdGrid)"/>
      <text x="24" y="36" class="pid-header">循环水养殖工艺流程图 (RAS PFD)</text>
      <text x="24" y="58" class="pid-caption">${d.species.name} · 目标 ${d._raw.annual / 1000} 吨/年 · 循环量 ${Q} m³/h · 回用率 ${d.hydraulics.waterReuse}%</text>

      <!-- 主流程节点 -->
      ${node(xs[0], eqY, eqW, eqH, "养殖池组", `${d.culture.tankCount} 个 · Ø${d.culture.tankD}m`, "c1", "tk")}
      ${node(xs[1], eqY, eqW, eqH, "转鼓微滤机", `${d.solids.units} 台 · ${d.solids.screen}µm`, "c2", "dr")}
      ${node(xs[2], eqY, eqW, eqH, "MBBR 生物滤池", `${d.biofilter.units} 座 · ${d.biofilter.totalVol}m³`, "c3", "bf")}
      ${node(xs[3], eqY, eqW, eqH, "增氧 + CO₂脱除", `供氧 ${d.oxygen.o2Supply}kg/h`, "c4", "ot")}
      ${node(xs[4], eqY, eqW, eqH, "紫外消毒", `30 mJ/cm²`, "c5", "uv")}

      <!-- 主流程箭头（上排 左→右，流量标注置于节点行上方净空）-->
      ${arrow(xs[0] + eqW, cy, xs[1], cy)}
      ${arrow(xs[1] + eqW, cy, xs[2], cy)}
      ${arrow(xs[2] + eqW, cy, xs[3], cy)}
      ${arrow(xs[3] + eqW, cy, xs[4], cy)}
      <text x="297" y="128" class="pfd-flow-label">${Q} m³/h</text>
      <text x="499" y="128" class="pfd-flow-label">${Q} m³/h</text>
      <text x="701" y="128" class="pfd-flow-label">${Q} m³/h</text>
      <text x="903" y="128" class="pfd-flow-label">${Q} m³/h</text>

      <!-- 回水（下排 右→左，闭合正交环；箭头自回水管上行进入养殖池底）-->
      <path d="M ${uvCx} ${eqY + eqH} L ${uvCx} ${yRet} L ${tkCx} ${yRet} L ${tkCx} ${eqY + eqH}" class="pfd-line pfd-return"/>
      <polygon points="${tkCx},${eqY + eqH} ${tkCx - 5},${eqY + eqH + 9} ${tkCx + 5},${eqY + eqH + 9}" class="pfd-head pfd-return"/>
      <text x="600" y="${yRet - 8}" class="pfd-flow-label">净化回水 ${Q} m³/h</text>

      <!-- 换热（回水管上）-->
      ${node(540, yRet - 26, 120, 52, "换热器", `${d.inputs.temp}℃ 控温`, "c8", "he")}

      <!-- 分支：新鲜补水（立管自补水罐上行接回水管）-->
      ${node(xs[4], 400, eqW, eqH, "新鲜补水", `${make} m³/h`, "c6", "makeup")}
      <g class="pfd-arrow pfd-makeup">
        <path d="M ${uvCx} 400 L ${uvCx} ${yRet}" class="pfd-line"/>
        <polygon points="${uvCx},${yRet} ${uvCx - 5},${yRet + 10} ${uvCx + 5},${yRet + 10}" class="pfd-head"/>
      </g>
      <text x="${uvCx + 14}" y="356" class="pfd-flow-label side">补水 ${make} m³/h</text>

      <!-- 分支：排污（正交绕开回水管，自微滤机底左侧引入污泥处理）-->
      ${node(xs[1], 400, eqW, eqH, "污泥处理", "浓缩 + 脱水", "c7", "sludge")}
      <g class="pfd-arrow pfd-sludge">
        <path d="M ${xs[1] + eqW / 2} ${eqY + eqH} L ${xs[1] + eqW / 2} 290 L 315 290 L 315 400 L ${xs[1]} 400" class="pfd-line"/>
        <polygon points="${xs[1]},400 ${xs[1] - 1},390 ${xs[1] + 9},390" class="pfd-head"/>
      </g>
      <text x="376" y="282" class="pfd-flow-label">排渣 ~${d.solids.tssDaily} kg/d</text>

      <!-- 图例 -->
      <g class="pfd-legend" transform="translate(150, ${H - 16})">
        <rect x="0" y="-14" width="14" height="14" rx="3" class="pfd-box c2"/>
        <text x="20" y="-2" class="pfd-sub">主循环</text>
        <rect x="110" y="-14" width="14" height="14" rx="3" class="pfd-box c8"/>
        <text x="130" y="-2" class="pfd-sub">回水/换热</text>
        <rect x="230" y="-14" width="14" height="14" rx="3" class="pfd-box c6"/>
        <text x="250" y="-2" class="pfd-sub">补水</text>
        <rect x="330" y="-14" width="14" height="14" rx="3" class="pfd-box c7"/>
        <text x="350" y="-2" class="pfd-sub">排污</text>
        <g class="pfd-swu-wrap">
          <rect x="430" y="-16" width="208" height="22" rx="11" class="pfd-swu"/>
          <circle cx="446" cy="-5" r="4.5" class="pfd-swu-dot"/>
          <text x="458" y="-1" class="pfd-swu-txt">比水耗 ${d.hydraulics.specificWaterUse} m³/kg</text>
        </g>
      </g>
    </svg>`;
  }
  return { render };
})();
