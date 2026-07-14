/*
 * 工艺流程图 (PFD) — SVG 生成
 * 用清晰的节点与箭头绘制循环水主流程，并标注关键分支。
 */
window.RAS = window.RAS || {};

RAS.pfd = (function () {
  // 节点定义：x, y, w, h, title, sub
  function node(x, y, w, h, title, sub, cls) {
    return `
      <g class="pfd-node ${cls || ""}">
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" class="pfd-box"/>
        <text x="${x + w / 2}" y="${y + h / 2 - 4}" class="pfd-title">${title}</text>
        <text x="${x + w / 2}" y="${y + h / 2 + 14}" class="pfd-sub">${sub}</text>
      </g>`;
  }

  function arrow(x1, y1, x2, y2, label) {
    const mx = (x1 + x2) / 2;
    return `
      <g class="pfd-arrow">
        <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="pfd-line"/>
        <polygon points="${x2},${y2} ${x2 - 9},${y2 - 5} ${x2 - 9},${y2 + 5}" class="pfd-head"/>
        ${label ? `<text x="${mx}" y="${Math.min(y1, y2) - 6}" class="pfd-flow-label">${label}</text>` : ""}
      </g>`;
  }

  function render(d) {
    const W = 1040, H = 460;
    const y = 150;
    const h = 84;
    const xs = [40, 230, 420, 610, 800];
    const w = 165;

    const Q = d.hydraulics.recircFlowH;
    const make = d.hydraulics.makeupFlowH;

    const svg = `
<svg viewBox="0 0 ${W} ${H}" class="pfd-svg" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="循环水工艺流程图">
  <defs>
    <marker id="ah" markerWidth="10" markerHeight="10" refX="6" refY="3" orient="auto">
      <path d="M0,0 L6,3 L0,6 Z" class="pfd-head"/>
    </marker>
  </defs>

  <!-- 标题 -->
  <text x="20" y="36" class="pfd-header">循环水养殖工艺流程图 (RAS PFD)</text>
  <text x="20" y="58" class="pfd-caption">${d.species.name} · 目标 ${d._raw.annual / 1000} 吨/年 · 循环量 ${Q} m³/h · 回用率 ${d.hydraulics.waterReuse}%</text>

  <!-- 主流程节点 -->
  ${node(xs[0], y, w, h, "养殖池组", `${d.culture.tankCount} 个 · Ø${d.culture.tankD}m`, "c1")}
  ${node(xs[1], y, w, h, "转鼓微滤机", `${d.solids.units} 台 · ${d.solids.screen}µm`, "c2")}
  ${node(xs[2], y, w, h, "MBBR 生物滤池", `${d.biofilter.units} 座 · ${d.biofilter.totalVol}m³`, "c3")}
  ${node(xs[3], y, w, h, "增氧 + CO₂脱除", `供氧 ${d.oxygen.o2Supply}kg/h`, "c4")}
  ${node(xs[4], y, w, h, "紫外消毒", `${d.oxygen.degasserType}`, "c5")}

  <!-- 主流程箭头（上排 从左至右）-->
  ${arrow(xs[0] + w, y + h / 2, xs[1], y + h / 2, Q + " m³/h")}
  ${arrow(xs[1] + w, y + h / 2, xs[2], y + h / 2, Q + " m³/h")}
  ${arrow(xs[2] + w, y + h / 2, xs[3], y + h / 2, Q + " m³/h")}
  ${arrow(xs[3] + w, y + h / 2, xs[4], y + h / 2, Q + " m³/h")}

  <!-- 回水（下排 从右至左）-->
  ${arrow(xs[4], y + h + 60, xs[0] + w, y + h + 60, "净化回水 " + Q + " m³/h")}
  <path d="M ${xs[4] + w / 2} ${y + h} L ${xs[4] + w / 2} ${y + h + 60} L ${xs[0] + w / 2} ${y + h + 60} L ${xs[0] + w / 2} ${y + h}" class="pfd-line pfd-return"/>

  <!-- 分支：补水 -->
  ${node(800, y + h + 110, w, h, "新鲜补水", `${make} m³/h`, "c6")}
  <g class="pfd-arrow pfd-makeup">
    <path d="M ${800 + w / 2} ${y + h + 110} L ${800 + w / 2} ${y + h + 60}" class="pfd-line"/>
    <polygon points="${800 + w / 2},${y + h + 60} ${800 + w / 2 - 5},${y + h + 70} ${800 + w / 2 + 5},${y + h + 70}" class="pfd-head"/>
  </g>
  <text x="${800 + w / 2}" y="${y + h + 95}" class="pfd-flow-label">补水 ${make} m³/h</text>

  <!-- 分支：排污（微滤机排渣）-->
  ${node(230, y + h + 110, w, h, "污泥处理", "浓缩 + 脱水", "c7")}
  <g class="pfd-arrow pfd-sludge">
    <path d="M ${230 + w / 2} ${y + h} L ${230 + w / 2} ${y + h + 110}" class="pfd-line"/>
    <polygon points="${230 + w / 2},${y + h + 110} ${230 + w / 2 - 5},${y + h + 100} ${230 + w / 2 + 5},${y + h + 100}" class="pfd-head"/>
  </g>
  <text x="${230 + w / 2}" y="${y + h + 96}" class="pfd-flow-label">排渣 ~${d.solids.tssDaily}t/d</text>

  <!-- 换热（在回水管上）-->
  ${node(420, y + h + 60 - 26, 120, 52, "换热器", `${d.species.designTemp}℃ 控温`, "c8")}

  <!-- 图例 -->
  <g class="pfd-legend" transform="translate(40, ${H - 8})">
    <rect x="0" y="-14" width="14" height="14" rx="3" class="pfd-box c2"/>
    <text x="20" y="-2" class="pfd-sub">主循环</text>
    <rect x="110" y="-14" width="14" height="14" rx="3" class="pfd-box c8"/>
    <text x="130" y="-2" class="pfd-sub">回水/换热</text>
    <rect x="230" y="-14" width="14" height="14" rx="3" class="pfd-box c6"/>
    <text x="250" y="-2" class="pfd-sub">补水</text>
    <rect x="330" y="-14" width="14" height="14" rx="3" class="pfd-box c7"/>
    <text x="350" y="-2" class="pfd-sub">排污</text>
  </g>
</svg>`;
    return svg;
  }

  return { render };
})();
