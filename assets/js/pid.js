/*
 * P&ID 与仪表控制点 — SVG 生成
 * 在 PFD 基础上增加 ISA 仪表标签(FT/LT/AT/TT/PT/控制阀)与控制回路(液位/溶氧/温度/流量)。
 */
window.RAS = window.RAS || {};

RAS.pid = (function () {
  function equip(x, y, w, h, tag, title, sub, cls) {
    return `
      <g class="pid-node ${cls || ""}">
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" class="pid-box"/>
        <text x="${x + w / 2}" y="${y + 18}" class="pid-tag">${tag}</text>
        <text x="${x + w / 2}" y="${y + h / 2 + 6}" class="pid-title">${title}</text>
        <text x="${x + w / 2}" y="${y + h / 2 + 24}" class="pid-sub">${sub}</text>
      </g>`;
  }
  function inst(cx, cy, tag, label) {
    return `
      <g class="pid-inst">
        <circle cx="${cx}" cy="${cy}" r="16" class="pid-bubble"/>
        <text x="${cx}" y="${cy + 4}" class="pid-bubble-txt">${tag}</text>
        <text x="${cx}" y="${cy + 30}" class="pid-inst-label">${label}</text>
      </g>`;
  }
  // 正交信号线：传入折点数组 [[x,y],...]，只走 90° 直角，无斜线
  function ortho(pts, cls) {
    const d = "M " + pts.map(p => p[0] + " " + p[1]).join(" L ");
    return `<path d="${d}" class="${cls || "pid-signal"}"/>`;
  }
  // 信号总线（水平母线）
  function bus(x1, x2, y) {
    return `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" class="pid-bus"/>`;
  }
  function pipe(x1, y1, x2, y2, label) {
    const mx = (x1 + x2) / 2;
    return `<g class="pid-pipe"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="pid-line"/>
      <polygon points="${x2},${y2} ${x2 - 9},${y2 - 5} ${x2 - 9},${y2 + 5}" class="pid-head"/>
      ${label ? `<text x="${mx}" y="${y1 - 6}" class="pid-flow-label">${label}</text>` : ""}</g>`;
  }
  function valve(cx, cy, tag) {
    return `<g class="pid-valve">
      <rect x="${cx - 12}" y="${cy - 12}" width="24" height="24" rx="4" class="pid-valve-box" transform="rotate(45 ${cx} ${cy})"/>
      <text x="${cx}" y="${cy + 30}" class="pid-inst-label">${tag}</text></g>`;
  }

  function render(d) {
    const W = 1060, H = 560;
    const y = 150, h = 84, w = 165;
    const xs = [40, 230, 420, 610, 800];
    const Q = d.hydraulics.recircFlowH;
    const yBus = 262; // 信号总线水平母线所在 y（设备行下、回水管上之间的净空）

    return `<svg viewBox="0 0 ${W} ${H}" class="pid-svg" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="P&ID 带仪表控制点">
      <text x="20" y="34" class="pid-header">管道及仪表流程图 (P&ID) · ${d.species.name}</text>
      <text x="20" y="56" class="pid-caption">循环量 ${Q} m³/h · 回用率 ${d.hydraulics.waterReuse}% · 控制回路：液位/溶氧/温度/流量</text>

      <!-- 设备 -->
      ${equip(xs[0], y, w, h, "TK-01", "养殖池组", `${d.culture.tankCount}×Ø${d.culture.tankD}m`, "c1")}
      ${equip(xs[1], y, w, h, "DR-01", "转鼓微滤机", `${d.solids.screen}µm`, "c2")}
      ${equip(xs[2], y, w, h, "BF-01", "MBBR 滤池", `${d.biofilter.totalVol}m³`, "c3")}
      ${equip(xs[3], y, w, h, "OT-01", "增氧+CO₂脱除", `${d.oxygen.o2Supply}kg/h`, "c4")}
      ${equip(xs[4], y, w, h, "UV-01", "紫外消毒", "30 mJ/cm²", "c5")}

      <!-- 主管路 -->
      ${pipe(xs[0] + w, y + h / 2, xs[1], y + h / 2, Q + " m³/h")}
      ${pipe(xs[1] + w, y + h / 2, xs[2], y + h / 2)}
      ${pipe(xs[2] + w, y + h / 2, xs[3], y + h / 2)}
      ${pipe(xs[3] + w, y + h / 2, xs[4], y + h / 2)}

      <!-- 回水管 -->
      ${pipe(xs[4], y + h + 70, xs[0] + w, y + h + 70, "净化回水")}
      <path d="M ${xs[4] + w / 2} ${y + h} L ${xs[4] + w / 2} ${y + h + 70} L ${xs[0] + w / 2} ${y + h + 70} L ${xs[0] + w / 2} ${y + h}" class="pid-line pid-return"/>

      <!-- 换热器（回水管上） -->
      ${equip(420, y + h + 70 - 26, 120, 52, "HE-01", "换热器", `${d.inputs.temp}℃`, "c8")}

      <!-- 补水 + 控制阀 -->
      ${equip(800, y + h + 120, w, h, "MAKEUP", "新鲜补水", `${d.hydraulics.makeupFlowH} m³/h`, "c6")}
      ${valve(800 + w / 2, y + h + 70, "FV-01")}
      ${pipe(800 + w / 2, y + h + 120, 800 + w / 2, y + h + 82, "补水")}

      <!-- 排污 -->
      ${equip(230, y + h + 120, w, h, "SLUDGE", "污泥处理", "脱水", "c7")}
      <path d="M ${230 + w / 2} ${y + h} L ${230 + w / 2} ${y + h + 120}" class="pid-line pid-sludge"/>
      <polygon points="${230 + w / 2},${y + h + 120} ${230 + w / 2 - 5},${y + h + 110} ${230 + w / 2 + 5},${y + h + 110}" class="pid-head pid-sludge"/>

      <!-- 仪表（置于清晰列，垂直落入信号总线，避免穿越设备）-->
      ${inst(20, 110, "LT-01", "液位")}
      ${inst(20, 150, "AT-01", "溶氧DO")}
      ${inst(215, 120, "TT-01", "温度")}
      ${inst(215, 160, "FT-01", "流量")}
      ${inst(215, 200, "AT-02", "pH")}
      ${inst(787, 120, "PT-01", "压力")}
      ${inst(70, 328, "LSH-01", "高液位报警")}

      <!-- 控制系统 -->
      <g class="pid-dcs">
        <rect x="300" y="${H - 96}" width="460" height="78" rx="14" class="pid-box c8"/>
        <text x="320" y="${H - 74}" class="pid-title">集中控制系统 (PLC / DCS)</text>
        <text x="320" y="${H - 54}" class="pid-sub">LIC-01 液位→FV-01 补水 · AIC-01 溶氧→氧锥 · TIC-01 温度→HE-01 · FIC-01 流量→P-01</text>
        <text x="320" y="${H - 36}" class="pid-sub">联锁：LSH-01 高液位停泵 · DO&lt;${d.species.doMin} 报警 · 备用发电机/纯氧自启</text>
      </g>
      <!-- 信号总线 + 仪表→总线 正交连接（仅 90° 直角，无斜线）-->
      ${bus(20, 791, yBus)}
      ${ortho([[20, 110], [20, yBus]])}
      ${ortho([[20, 150], [20, yBus]])}
      ${ortho([[215, 120], [215, yBus]])}
      ${ortho([[215, 160], [215, yBus]])}
      ${ortho([[215, 200], [215, yBus]])}
      ${ortho([[787, 120], [787, yBus]])}
      ${ortho([[70, 328], [70, yBus]])}
      <!-- 总线→集中控制系统（单点引入）-->
      ${ortho([[530, yBus], [530, H - 96]])}
      <!-- 控制信号（DCS→FV-01 阀门，正交阶梯路由）-->
      ${ortho([[740, H - 96], [740, 340], [868, 340], [868, 304], [800 + w / 2, 304]])}

      <!-- 图例 -->
      <g class="pid-legend" transform="translate(40, ${H - 8})">
        <circle cx="8" cy="-8" r="9" class="pid-bubble"/><text x="22" y="-4" class="pid-sub">仪表测点</text>
        <rect x="120" y="-16" width="14" height="14" rx="3" class="pid-box c8"/><text x="140" y="-4" class="pid-sub">控制系统</text>
        <rect x="240" y="-16" width="14" height="14" rx="3" class="pid-valve-box" transform="rotate(45 247 -9)"/><text x="260" y="-4" class="pid-sub">控制阀</text>
        <line x1="360" y1="-8" x2="380" y2="-8" class="pid-signal"/><text x="386" y="-4" class="pid-sub">信号线</text>
      </g>
    </svg>`;
  }
  return { render };
})();
