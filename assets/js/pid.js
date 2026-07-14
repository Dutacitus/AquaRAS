/*
 * P&ID 与仪表控制点 — SVG 生成
 * 在 PFD 基础上增加 ISA 仪表标签(FT/LT/AT/TT/PT/控制阀)与控制回路(液位/溶氧/温度/流量)。
 * 布局：左侧仪表轨 + 信号竖母线 + 水平总线 → 集中控制系统；全部 90° 正交，无斜线、无重叠。
 */
window.RAS = window.RAS || {};

RAS.pid = (function () {
  function equip(x, y, w, h, tag, title, sub, cls) {
    return `
      <g class="pid-node ${cls || ""}">
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" class="pid-box" filter="url(#pidShadow)"/>
        <text x="${x + w / 2}" y="${y + 20}" class="pid-tag">${tag}</text>
        <text x="${x + w / 2}" y="${y + h / 2 + 6}" class="pid-title">${title}</text>
        <text x="${x + w / 2}" y="${y + h / 2 + 24}" class="pid-sub">${sub}</text>
      </g>`;
  }
  // 仪表：labelPos 'bottom'(默认) 或 'right'(标签右侧，避免与下方气泡重叠)
  function inst(cx, cy, tag, label, labelPos) {
    const labelEl = labelPos === "right"
      ? `<text x="${cx + 21}" y="${cy + 4}" class="pid-inst-label side">${label}</text>`
      : `<text x="${cx}" y="${cy + 30}" class="pid-inst-label">${label}</text>`;
    return `
      <g class="pid-inst">
        <circle cx="${cx}" cy="${cy}" r="15" class="pid-bubble"/>
        <text x="${cx}" y="${cy + 3.5}" class="pid-bubble-txt">${tag}</text>
        ${labelEl}
      </g>`;
  }
  // 正交信号线：折点数组，仅 90°
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
      ${label ? `<text x="${mx}" y="${y1 - 7}" class="pid-flow-label">${label}</text>` : ""}</g>`;
  }
  function valve(cx, cy, tag) {
    return `<g class="pid-valve">
      <rect x="${cx - 12}" y="${cy - 12}" width="24" height="24" rx="4" class="pid-valve-box" transform="rotate(45 ${cx} ${cy})"/>
      <text x="${cx}" y="${cy + 32}" class="pid-inst-label side">${tag}</text></g>`;
  }

  function render(d) {
    const W = 1180, H = 600;
    const eqY = 160, eqH = 86, eqW = 172;
    const xs = [150, 352, 554, 756, 958];
    const cy = eqY + eqH / 2;           // 设备中心 y = 203
    const Q = d.hydraulics.recircFlowH;
    const yRet = eqY + eqH + 78;        // 回水管 y = 324
    const yBus = 472;                   // 信号总线 y
    const dcsX = 300, dcsY = 488, dcsW = 640, dcsH = 70;
    const railX = 52, railBusX = 106;   // 仪表轨中心 & 轨内竖母线 x
    const dcsEntryX = 340;              // 总线进入 DCS 的 x
    const instYs = [104, 158, 212, 266, 320, 374, 428];

    // 仪表：[tag, 中文名, 轨内序号]
    const insts = [
      ["LT-01", "液位", 0],
      ["AT-01", "溶氧DO", 1],
      ["FT-01", "流量", 2],
      ["AT-02", "pH", 3],
      ["TT-01", "温度", 4],
      ["PT-01", "压力", 5],
      ["LSH-01", "高液位报警", 6],
    ];

    // 仪表轨 + 各仪表短横支线 + 轨内竖母线
    let railSvg = `<rect x="16" y="82" width="124" height="372" rx="14" class="pid-rail"/>`;
    insts.forEach(([tag, label, i]) => {
      const yi = instYs[i];
      railSvg += inst(railX, yi, tag, label, "right");
      railSvg += ortho([[railX, yi], [railBusX, yi], [railBusX, yBus]]);
    });
    // 主总线 → DCS
    const busSvg = `${bus(railBusX, dcsEntryX, yBus)}${ortho([[dcsEntryX, yBus], [dcsEntryX, dcsY]])}`;

    return `<svg viewBox="0 0 ${W} ${H}" class="pid-svg" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="P&ID 带仪表控制点">
      <defs>
        <filter id="pidShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#000" flood-opacity="0.16"/>
        </filter>
        <pattern id="pidGrid" width="30" height="30" patternUnits="userSpaceOnUse">
          <circle cx="1.2" cy="1.2" r="1.1" fill="rgba(120,140,170,0.16)"/>
        </pattern>
      </defs>

      <rect x="6" y="6" width="${W - 12}" height="${H - 12}" rx="18" class="pid-bg"/>
      <rect x="6" y="6" width="${W - 12}" height="${H - 12}" rx="18" fill="url(#pidGrid)"/>
      <text x="24" y="36" class="pid-header">管道及仪表流程图 (P&ID) · ${d.species.name}</text>
      <text x="24" y="58" class="pid-caption">循环量 ${Q} m³/h · 回用率 ${d.hydraulics.waterReuse}% · 控制回路：液位 / 溶氧 / 温度 / 流量</text>

      ${railSvg}
      ${busSvg}

      <!-- 设备 -->
      ${equip(xs[0], eqY, eqW, eqH, "TK-01", "养殖池组", `${d.culture.tankCount}×Ø${d.culture.tankD}m`, "c1")}
      ${equip(xs[1], eqY, eqW, eqH, "DR-01", "转鼓微滤机", `${d.solids.screen}µm`, "c2")}
      ${equip(xs[2], eqY, eqW, eqH, "BF-01", "MBBR 滤池", `${d.biofilter.totalVol}m³`, "c3")}
      ${equip(xs[3], eqY, eqW, eqH, "OT-01", "增氧+CO₂脱除", `${d.oxygen.o2Supply}kg/h`, "c4")}
      ${equip(xs[4], eqY, eqW, eqH, "UV-01", "紫外消毒", "30 mJ/cm²", "c5")}

      <!-- 主管路 -->
      ${pipe(xs[0] + eqW, cy, xs[1], cy, Q + " m³/h")}
      ${pipe(xs[1] + eqW, cy, xs[2], cy)}
      ${pipe(xs[2] + eqW, cy, xs[3], cy)}
      ${pipe(xs[3] + eqW, cy, xs[4], cy)}

      <!-- 回水管(闭合正交环) -->
      ${pipe(xs[4], yRet, xs[0] + eqW, yRet, "净化回水")}
      <path d="M ${xs[4] + eqW / 2} ${eqY + eqH} L ${xs[4] + eqW / 2} ${yRet} L ${xs[0] + eqW / 2} ${yRet} L ${xs[0] + eqW / 2} ${eqY + eqH}" class="pid-line pid-return"/>

      <!-- 换热器(回水管上) -->
      ${equip(540, yRet - 26, 120, 52, "HE-01", "换热器", `${d.inputs.temp}℃`, "c8")}

      <!-- 新鲜补水 + 控制阀 FV-01 -->
      ${equip(xs[4], 420, eqW, eqH, "MAKEUP", "新鲜补水", `${d.hydraulics.makeupFlowH} m³/h`, "c6")}
      ${valve(xs[4] + eqW / 2, 372, "FV-01")}
      ${pipe(xs[4] + eqW / 2, 420, xs[4] + eqW / 2, yRet, "补水")}

      <!-- 排污(正交绕开回水管，自 DR-01 底部左侧引入 SLUDGE) -->
      <path d="M ${xs[1] + eqW / 2} ${eqY + eqH} L ${xs[1] + eqW / 2} 300 L 315 300 L 315 420 L ${xs[1]} 420" class="pid-line pid-sludge"/>
      <polygon points="${xs[1]},420 ${xs[1] - 1},410 ${xs[1] + 9},410" class="pid-head pid-sludge"/>
      ${equip(xs[1], 420, eqW, eqH, "SLUDGE", "污泥处理", "脱水", "c7")}

      <!-- 集中控制系统 -->
      <g class="pid-dcs" filter="url(#pidShadow)">
        <rect x="${dcsX}" y="${dcsY}" width="${dcsW}" height="${dcsH}" rx="14" class="pid-box c8"/>
        <text x="${dcsX + 18}" y="${dcsY + 24}" class="pid-title left">集中控制系统 (PLC / DCS)</text>
        <text x="${dcsX + 18}" y="${dcsY + 44}" class="pid-sub left">控制回路：LIC 液位→FV-01 · AIC 溶氧→氧锥 · TIC 温度→HE-01 · FIC 流量→P-01</text>
        <text x="${dcsX + 18}" y="${dcsY + 62}" class="pid-sub left">联锁：LSH-01 高液位停泵 · DO 低于 ${d.species.doMin} 报警 · 备用纯氧 / 发电机自启</text>
      </g>
      <!-- 控制信号(DCS→FV-01，正交阶梯) -->
      ${ortho([[900, dcsY], [900, 372], [xs[4] + eqW / 2, 372]], "pid-control")}

      <!-- 图例 -->
      <g class="pid-legend" transform="translate(${dcsX}, ${H - 18})">
        <circle cx="8" cy="-8" r="9" class="pid-bubble"/><text x="22" y="-4" class="pid-sub">仪表测点</text>
        <rect x="120" y="-16" width="14" height="14" rx="3" class="pid-box c8"/><text x="140" y="-4" class="pid-sub">控制系统</text>
        <rect x="230" y="-16" width="14" height="14" rx="3" class="pid-valve-box" transform="rotate(45 237 -9)"/><text x="250" y="-4" class="pid-sub">控制阀</text>
        <line x1="330" y1="-8" x2="356" y2="-8" class="pid-signal"/><text x="362" y="-4" class="pid-sub">信号线</text>
        <line x1="430" y1="-8" x2="456" y2="-8" class="pid-control"/><text x="462" y="-4" class="pid-sub">控制信号</text>
      </g>
    </svg>`;
  }
  return { render };
})();
