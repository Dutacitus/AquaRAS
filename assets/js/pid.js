/*
 * P&ID 与仪表控制点 — SVG 生成
 * 在 PFD 基础上增加 ISA 仪表标签(FT/LT/AT/TT/PT/控制阀)与控制回路(液位/溶氧/温度/流量)。
 * 布局：左侧仪表轨 + 信号竖母线 + 水平总线 → 集中控制系统；全部 90° 正交，无斜线、无重叠。
 * v1.19 泡沫分离(skimmer)作为主流程节点条件渲染。
 */
window.RAS = window.RAS || {};

RAS.pid = (function () {
  // 估算文本像素宽度（CJK 全宽、ASCII 半宽），用于判断是否需压缩以贴合方框
  function estWidth(s, fs) {
    let w = 0;
    for (const ch of String(s)) {
      const c = ch.codePointAt(0);
      w += c > 0x2e80 ? fs : (c === 0x20 ? fs * 0.3 : fs * 0.55);
    }
    return w;
  }
  function fitLen(s, fs, maxW) {
    const ew = estWidth(s, fs);
    return ew > maxW ? Math.max(24, Math.round(maxW)) : 0;
  }
  function equip(x, y, w, h, tag, title, sub, cls, key) {
    const tLen = fitLen(title, 14, w - 16);
    const sLen = fitLen(sub, 11.5, w - 12);
    return `
      <g class="pid-node ${cls || ""}" data-key="${key || ""}">
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" class="pid-box" filter="url(#pidShadow)"/>
        <text x="${x + w / 2}" y="${y + 20}" class="pid-tag">${tag}</text>
        <text x="${x + w / 2}" y="${y + h / 2 + 6}" class="pid-title"${tLen ? ` textLength="${tLen}" lengthAdjust="spacingAndGlyphs"` : ""}>${title}</text>
        <text x="${x + w / 2}" y="${y + h / 2 + 24}" class="pid-sub"${sLen ? ` textLength="${sLen}" lengthAdjust="spacingAndGlyphs"` : ""}>${sub}</text>
      </g>`;
  }
  // 仪表：labelPos 'bottom'(默认) 或 'right'(标签右侧，避免与下方气泡重叠)
  function inst(cx, cy, tag, label, labelPos, key) {
    const labelEl = labelPos === "right"
      ? `<text x="${cx + 21}" y="${cy + 4}" class="pid-inst-label side">${label}</text>`
      : `<text x="${cx}" y="${cy + 30}" class="pid-inst-label">${label}</text>`;
    return `
      <g class="pid-inst" data-key="${key || ""}">
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
  function pipe(x1, y1, x2, y2, label, labelY) {
    const mx = (x1 + x2) / 2;
    const ly = labelY !== undefined ? labelY : Math.min(y1, y2) - 7;
    return `<g class="pid-pipe"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="pid-line"/>
      <polygon points="${x2},${y2} ${x2 - 9},${y2 - 5} ${x2 - 9},${y2 + 5}" class="pid-head"/>
      ${label ? `<text x="${mx}" y="${ly}" class="pid-flow-label">${label}</text>` : ""}</g>`;
  }
  function valve(cx, cy, tag) {
    return `<g class="pid-valve">
      <rect x="${cx - 12}" y="${cy - 12}" width="24" height="24" rx="4" class="pid-valve-box" transform="rotate(45 ${cx} ${cy})"/>
      <text x="${cx + 20}" y="${cy + 6}" class="pid-inst-label side">${tag}</text></g>`;
  }

  function render(d) {
    const skimmerOn = d.inputs.foamFrac === true;
    const ozoneOn = d.inputs.ozone === true;
    const uvOn = d.inputs.uv !== false;
    const denitOn = d.waterQuality && d.waterQuality.denit && d.waterQuality.denit.removal > 0;

    // 构建主流程设备列表（顺序与 PFD 一致）
    const U = [
      { k: "tk", tag: "TK-01", label: "养殖池组",      sub: `${d.culture.tankCount}×Ø${d.culture.tankD}m`, cls: "c1" },
      { k: "dr", tag: "DR-01", label: "转鼓微滤机",    sub: `${d.solids.screen}µm`, cls: "c2" },
    ];
    if (skimmerOn) {
      U.push({ k: "sk", tag: "SK-01", label: "泡沫分离", sub: `侧流 ~${Math.round(d.hydraulics.recircFlowH * 0.25)} m³/h`, cls: "c10" });
    }
    U.push(
      { k: "bf", tag: "BF-01", label: "MBBR 滤池",     sub: `${d.biofilter.totalVol}m³`, cls: "c3" },
      { k: "ot", tag: "OT-01", label: "增氧+CO₂脱除",  sub: `${d.oxygen.o2Supply}kg/h`, cls: "c4" },
    );
    if (ozoneOn) {
      const ozoneSub = skimmerOn ? `接触=蛋白分离器` : `含接触柱+尾气破坏`;
      U.push({ k: "oz", tag: "OZ-01", label: "臭氧氧化", sub: ozoneSub, cls: "c11" });
    }
    if (uvOn) {
      U.push({ k: "uv", tag: "UV-01", label: "紫外消毒", sub: "30 mJ/cm²", cls: "c5" });
    }

    const n = U.length;
    const W = n > 5 ? (n >= 7 ? 1600 : 1400) : 1180, H = 650;
    const eqY = 160, eqH = 86, eqW = 172;
    const margin = 150; // 左侧为仪表轨留空间
    const xs = n <= 5
      ? [150, 352, 554, 756, 958]
      : n === 6
        ? [150, 352, 554, 756, 958, 1160]
        : [150, 352, 554, 756, 958, 1160, 1370];

    const cy = eqY + eqH / 2;             // 设备中心 y = 203
    const Q = d.hydraulics.recircFlowH;
    const yRet = eqY + eqH + 78;          // 回水管 y = 324
    const lastIdx = n - 1;
    const lastCol = xs[lastIdx];
    const lastColCx = lastCol + eqW / 2;
    const drIdx = 1;                      // 转鼓索引
    const bfIdx = skimmerOn ? 3 : 2;      // 生物滤池索引

    const yBus = 472;                     // 信号总线 y
    const dcsX = 300, dcsY = 512, dcsW = W - 300 - 80, dcsH = 70;
    const dcsLine1 = `控制回路：LIC 液位→FV-01 · AIC 溶氧→氧染 · TIC 温度→HE-01 · FIC 流量→P-01 · AIC 硝酸氮→碳源投加(DN-01)`;
    const dcsLine2 = `联锁：LSH-01 高液位停泵 · DO 低于 ${d.species.doMin} 报警 · 备用纯氧 / 发电机自启`;
    const railX = 52, railBusX = 106;     // 仪表轨中心 & 轨内竖母线 x
    const dcsEntryX = 340;                // 总线进入 DCS 的 x
    const instYs = [104, 158, 212, 266, 320, 374, 428, 484];

    // 仪表定义
    const insts = [
      ["LT-01", "液位", 0, "tk"],
      ["AT-01", "溶氧DO", 1, "ot"],
      ["FT-01", "流量", 2, "tk"],
      ["AT-02", "pH", 3, "tk"],
      ["TT-01", "温度", 4, "he"],
      ["PT-01", "压力", 5, "uv"],
      ["LSH-01", "高液位报警", 6, "tk"],
      ["AT-03", "硝酸氮NO₃", 7, "dn"],
    ];

    // 仪表轨 + 各仪表短横支线 + 轨内竖母线
    let railSvg = `<rect x="16" y="82" width="124" height="430" rx="14" class="pid-rail"/>`;
    insts.forEach(([tag, label, i, key]) => {
      const yi = instYs[i];
      railSvg += inst(railX, yi, tag, label, "right", key);
      railSvg += ortho([[railX, yi], [railBusX, yi], [railBusX, yBus]]);
    });
    // 主总线 → DCS
    const busSvg = `${bus(railBusX, dcsEntryX, yBus)}${ortho([[dcsEntryX, yBus], [dcsEntryX, dcsY]])}`;

    // ── 主流程设备 ──
    const mainEquips = U.map((u, i) => equip(xs[i], eqY, eqW, eqH, u.tag, u.label, u.sub, u.cls, u.k)).join("\n      ");

    // ── 主管路 ──
    let mainPipes = pipe(xs[0] + eqW, cy, xs[1], cy, Q + " m³/h", eqY - 12) + "\n      ";
    for (let i = 1; i < n - 1; i++) {
      mainPipes += pipe(xs[i] + eqW, cy, xs[i + 1], cy) + "\n      ";
    }

    // ── 换热器位置（回水管中心） ──
    const heCx = Math.round((xs[0] + eqW / 2 + lastColCx) / 2);
    const heX = heCx - 60;

    // ── 反硝化位置 ──
    const dnX = xs[bfIdx];
    const dnPipe1X = dnX + 60;   // 下行管
    const dnPipe2X = dnX + eqW - 60; // 上行回注管

    // ── 排污支路 ──
    const sludgeCenterX = xs[drIdx] + eqW / 2;
    const sludgeTurnX = sludgeCenterX - 83;

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
      ${mainEquips}

      <!-- 主管路 -->
      ${mainPipes}
      <!-- 回水管(闭合正交环) -->
      ${pipe(lastCol, yRet, xs[0] + eqW, yRet, "净化回水", yRet + 52)}
      <path d="M ${lastColCx} ${eqY + eqH} L ${lastColCx} ${yRet} L ${xs[0] + eqW / 2} ${yRet} L ${xs[0] + eqW / 2} ${eqY + eqH}" class="pid-line pid-return"/>

      <!-- 换热器(回水管上) -->
      ${equip(heX, yRet - 26, 120, 52, "HE-01", "换热器", `${d.inputs.temp}℃`, "c8", "he")}

      <!-- 新鲜补水 + 控制阀 FV-01 -->
      ${equip(lastCol, 420, eqW, eqH, "MAKEUP", "新鲜补水", `${d.hydraulics.makeupFlowH} m³/h`, "c6", "makeup")}
      ${valve(lastColCx, 372, "FV-01")}
      ${pipe(lastColCx, 420, lastColCx, yRet, "补水")}

      <!-- 排污(正交绕开回水管，自 DR-01 底部左侧引入 SLUDGE) -->
      <path d="M ${sludgeCenterX} ${eqY + eqH} L ${sludgeCenterX} 300 L ${sludgeTurnX} 300 L ${sludgeTurnX} 420 L ${xs[drIdx]} 420" class="pid-line pid-sludge"/>
      <polygon points="${xs[drIdx]},420 ${xs[drIdx] - 1},410 ${xs[drIdx] + 9},410" class="pid-head pid-sludge"/>
      ${equip(xs[drIdx], 420, eqW, eqH, "SLUDGE", "污泥处理", "脱水", "c7", "sludge")}

      <!-- 反硝化反应器 DN-01（侧流脱氮；仅 denitRemoval>0 时显示）-->
      ${denitOn ? `${equip(dnX, 420, eqW, eqH, "DN-01", "反硝化反应器", d.waterQuality.denit.volume + "m³ · 脱氮" + Math.round(d.waterQuality.denit.removal * 100) + "%", "c9", "dn")}
      <g class="pid-pipe pid-denit">
        <line x1="${dnPipe1X}" y1="${yRet}" x2="${dnPipe1X}" y2="420" class="pid-line"/>
        <polygon points="${dnPipe1X},420 ${dnPipe1X - 5},410 ${dnPipe1X + 5},410" class="pid-head"/>
      </g>
      <text x="${dnPipe1X + 10}" y="392" class="pid-flow-label denit-txt">侧流</text>
      <g class="pid-pipe pid-denit">
        <line x1="${dnPipe2X}" y1="420" x2="${dnPipe2X}" y2="${yRet}" class="pid-line"/>
        <polygon points="${dnPipe2X},${yRet} ${dnPipe2X - 5},${yRet + 10} ${dnPipe2X + 5},${yRet + 10}" class="pid-head"/>
      </g>
      <text x="${dnPipe2X + 10}" y="392" class="pid-flow-label denit-txt">回注</text>` : ""}

      <!-- 集中控制系统 -->
      <g class="pid-dcs" filter="url(#pidShadow)">
        <rect x="${dcsX}" y="${dcsY}" width="${dcsW}" height="${dcsH}" rx="14" class="pid-box c8"/>
        <text x="${dcsX + 18}" y="${dcsY + 24}" class="pid-title left">集中控制系统 (PLC / DCS)</text>
        <text x="${dcsX + 18}" y="${dcsY + 44}" class="pid-sub left"${fitLen(dcsLine1, 11.5, dcsW - 40) ? ` textLength="${fitLen(dcsLine1, 11.5, dcsW - 40)}" lengthAdjust="spacingAndGlyphs"` : ""}>${dcsLine1}</text>
        <text x="${dcsX + 18}" y="${dcsY + 62}" class="pid-sub left"${fitLen(dcsLine2, 11.5, dcsW - 40) ? ` textLength="${fitLen(dcsLine2, 11.5, dcsW - 40)}" lengthAdjust="spacingAndGlyphs"` : ""}>${dcsLine2}</text>
      </g>
      <!-- 控制信号(DCS→FV-01，正交阶梯) -->
      ${ortho([[dcsX + dcsW - 40, dcsY], [dcsX + dcsW - 40, 372], [lastColCx, 372]], "pid-control")}

      <!-- 图例 -->
      <g class="pid-legend" transform="translate(${dcsX}, ${H - 36})">
        <circle cx="8" cy="-8" r="9" class="pid-bubble"/><text x="22" y="-4" class="pid-sub">仪表测点</text>
        <rect x="120" y="-16" width="14" height="14" rx="3" class="pid-box c8"/><text x="140" y="-4" class="pid-sub">控制系统</text>
        <rect x="230" y="-16" width="14" height="14" rx="3" class="pid-valve-box" transform="rotate(45 237 -9)"/><text x="250" y="-4" class="pid-sub">控制阀</text>
        <line x1="320" y1="-8" x2="346" y2="-8" class="pid-signal"/><text x="352" y="-4" class="pid-sub">信号线</text>
        <line x1="420" y1="-8" x2="446" y2="-8" class="pid-control"/><text x="452" y="-4" class="pid-sub">控制信号</text>
        ${skimmerOn ? `<rect x="520" y="-16" width="14" height="14" rx="3" class="pid-box c10"/><text x="540" y="-4" class="pid-sub">泡沫分离</text>` : ""}
        ${ozoneOn ? `<rect x="${skimmerOn ? 620 : 520}" y="-16" width="14" height="14" rx="3" class="pid-box c11"/><text x="${skimmerOn ? 640 : 540}" y="-4" class="pid-sub">臭氧氧化</text>` : ""}
        <rect x="${(skimmerOn ? 620 : 520) + (ozoneOn ? 100 : 0)}" y="-16" width="14" height="14" rx="3" class="pid-box c9"/><text x="${(skimmerOn ? 620 : 520) + (ozoneOn ? 100 : 0) + 20}" y="-4" class="pid-sub">反硝化</text>
        ${denitOn ? "" : "<!-- 反硝化未启用，图例隐藏 -->"}
        <g class="pid-swu-wrap">
          <rect x="${(skimmerOn ? 620 : 520) + (ozoneOn ? 100 : 0) + 110}" y="-16" width="208" height="22" rx="11" class="pid-swu"/>
          <circle cx="${(skimmerOn ? 620 : 520) + (ozoneOn ? 100 : 0) + 126}" cy="-5" r="4.5" class="pid-swu-dot"/>
          <text x="${(skimmerOn ? 620 : 520) + (ozoneOn ? 100 : 0) + 138}" y="-1" class="pid-swu-txt">比水耗 ${d.hydraulics.specificWaterUse} m³/kg</text>
        </g>
      </g>
    </svg>`;
  }
  return { render };
})();
