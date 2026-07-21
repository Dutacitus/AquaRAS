/*
 * 工艺流程图 (PFD) — SVG 生成
 * 主流程 + 回水闭环 + 补水/排污分支，全部 90° 正交、无斜线、无重叠。
 * 视觉与 P&ID 统一：背景面板 / 栅格 / 投影 / 悬停微交互。
 * v1.19 泡沫分离(skimmer)作为主流程节点条件渲染。
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
    const skimmerOn = d.inputs.foamFrac === true;
    const ozoneOn = d.inputs.ozone === true;
    const uvOn = d.inputs.uv !== false;
    const denitOn = d.waterQuality && d.waterQuality.denit && d.waterQuality.denit.removal > 0;

    // 构建主流程节点列表（顺序：养殖池 → 转鼓 → [泡沫分离] → MBBR → 增氧+CO₂ → [臭氧氧化] → [UV]）
    const U = [
      { k: "tk", label: "养殖池组",      sub: `${d.culture.tankCount} 个 · Ø${d.culture.tankD}m`, cls: "c1" },
      { k: "dr", label: "转鼓微滤机",    sub: `${d.solids.units} 台 · ${d.solids.screen}µm`, cls: "c2" },
    ];
    if (skimmerOn) {
      U.push({ k: "sk", label: "泡沫分离", sub: `侧流 ~${Math.round(d.hydraulics.recircFlowH * 0.25)} m³/h`, cls: "c10" });
    }
    U.push(
      { k: "bf", label: "MBBR 生物滤池", sub: `${d.biofilter.units} 座 · ${d.biofilter.totalVol}m³`, cls: "c3" },
      { k: "ot", label: "增氧 + CO₂脱除",sub: `供氧 ${d.oxygen.o2Supply}kg/h`, cls: "c4" },
    );
    if (ozoneOn) {
      const ozoneSub = skimmerOn
        ? `氧化 NO₂+DOC · 接触=蛋白分离器`
        : `氧化 NO₂+DOC · 含接触柱`;
      U.push({ k: "oz", label: "臭氧氧化", sub: ozoneSub, cls: "c11" });
    }
    if (uvOn) {
      U.push({ k: "uv", label: "紫外消毒", sub: "30 mJ/cm²", cls: "c5" });
    }

    const n = U.length;
    // 兼容原有 5 列布局；6/7 列时加宽（最多 7 个主流程单元）
    const W = n >= 7 ? 1560 : (n > 5 ? 1400 : 1200), H = 580;
    const eqY = 150, eqH = 86, eqW = 172;
    const xs = n <= 5
      ? [110, 312, 514, 716, 918]
      : n === 6
        ? [110, 312, 514, 716, 918, 1120]
        : [110, 312, 514, 716, 918, 1120, 1330];

    const cy = eqY + eqH / 2;               // 主流程中心线
    const Q = d.hydraulics.recircFlowH;
    const make = d.hydraulics.makeupFlowH;
    const yRet = eqY + eqH + 70;            // 回水管 y
    const tkCx = xs[0] + eqW / 2;           // 养殖池中心 x
    const lastIdx = n - 1;
    const lastCol = xs[lastIdx];
    const lastColCx = lastCol + eqW / 2;

    // 关键列索引（动态）
    const drIdx = 1;                        // 转鼓始终在索引 1
    const bfIdx = skimmerOn ? 3 : 2;        // 生物滤池索引
    const gap = xs[1] - xs[0] - eqW;        // 列间距

    // ── 主流程节点 ──
    const mainNodes = U.map((u, i) => node(xs[i], eqY, eqW, eqH, u.label, u.sub, u.cls, u.k)).join("\n      ");

    // ── 主流程箭头 + 流量标注 ──
    let mainArrows = "", flowLabels = "";
    for (let i = 0; i < n - 1; i++) {
      mainArrows += arrow(xs[i] + eqW, cy, xs[i + 1], cy) + "\n      ";
      const lx = Math.round(xs[i] + eqW + gap / 2);
      flowLabels += `<text x="${lx}" y="128" class="pfd-flow-label">${Q} m³/h</text>\n      `;
    }

    // ── 换热器位置（回水管中心） ──
    const heCx = Math.round((tkCx + lastColCx) / 2);
    const heX = heCx - 60;
    const retLabelX = Math.round((tkCx + lastColCx) / 2 - 60);

    // ── 反硝化位置（动态跟随生物滤池列） ──
    const dnX = xs[bfIdx];
    const dnPipe1X = dnX + 6;
    const dnPipe2X = dnX + eqW - 6;
    const dnLabelX = dnX + eqW / 2 - 40;

    // ── 排污支路 ──
    const sludgeCenterX = xs[drIdx] + eqW / 2;
    const sludgeTurnX = sludgeCenterX - 83;
    const sludgeLabelX = xs[drIdx] + eqW + 10 - Math.max(0, n - 5) * 30; // 窄间距时标签略左移

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
      ${mainNodes}

      <!-- 主流程箭头 + 流量标注 -->
      ${mainArrows}${flowLabels}
      <!-- 回水（下排 右→左，闭合正交环）-->
      <path d="M ${lastColCx} ${eqY + eqH} L ${lastColCx} ${yRet} L ${tkCx} ${yRet} L ${tkCx} ${eqY + eqH}" class="pfd-line pfd-return"/>
      <polygon points="${tkCx},${eqY + eqH} ${tkCx - 5},${eqY + eqH + 9} ${tkCx + 5},${eqY + eqH + 9}" class="pfd-head pfd-return"/>
      <text x="${retLabelX}" y="${yRet - 8}" class="pfd-flow-label">净化回水 ${Q} m³/h</text>

      <!-- 换热（回水管上）-->
      ${node(heX, yRet - 26, 120, 52, "换热器", `${d.inputs.temp}℃ 控温`, "c8", "he")}

      <!-- 新鲜补水 -->
      ${node(lastCol, 400, eqW, eqH, "新鲜补水", `${make} m³/h`, "c6", "makeup")}
      <g class="pfd-arrow pfd-makeup">
        <path d="M ${lastColCx} 400 L ${lastColCx} ${yRet}" class="pfd-line"/>
        <polygon points="${lastColCx},${yRet} ${lastColCx - 5},${yRet + 10} ${lastColCx + 5},${yRet + 10}" class="pfd-head"/>
      </g>
      <text x="${lastColCx + 14}" y="356" class="pfd-flow-label side">补水 ${make} m³/h</text>

      <!-- 排污（正交绕开回水管，自微滤机底左侧引入污泥处理）-->
      ${node(xs[drIdx], 400, eqW, eqH, "污泥处理", "浓缩 + 脱水", "c7", "sludge")}
      <g class="pfd-arrow pfd-sludge">
        <path d="M ${sludgeCenterX} ${eqY + eqH} L ${sludgeCenterX} 290 L ${sludgeTurnX} 290 L ${sludgeTurnX} 400 L ${xs[drIdx]} 400" class="pfd-line"/>
        <polygon points="${xs[drIdx]},400 ${xs[drIdx] - 1},390 ${xs[drIdx] + 9},390" class="pfd-head"/>
      </g>
      <text x="${sludgeLabelX}" y="282" class="pfd-flow-label">排渣 ~${d.solids.tssDaily} kg/d</text>

      <!-- 反硝化反应器（侧流脱氮；仅 denitRemoval>0 时显示）-->
      ${denitOn ? `${node(dnX, 400, eqW, eqH, "反硝化反应器", d.waterQuality.denit.volume + " m³ · 脱氮 " + Math.round(d.waterQuality.denit.removal * 100) + "%", "c9", "dn")}
      <g class="pfd-arrow pfd-denit">
        <path d="M ${dnPipe1X} ${yRet} L ${dnPipe1X} 400" class="pfd-line"/>
        <polygon points="${dnPipe1X},400 ${dnPipe1X - 5},390 ${dnPipe1X + 5},390" class="pfd-head"/>
      </g>
      <g class="pfd-arrow pfd-denit">
        <path d="M ${dnPipe2X} ${yRet} L ${dnPipe2X} 400" class="pfd-line"/>
        <polygon points="${dnPipe2X},${yRet} ${dnPipe2X - 5},${yRet + 10} ${dnPipe2X + 5},${yRet + 10}" class="pfd-head"/>
      </g>
      <text x="${dnLabelX}" y="352" class="pfd-flow-label">NO₃ 侧流脱氮</text>` : ""}

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
        ${skimmerOn ? `<rect x="430" y="-14" width="14" height="14" rx="3" class="pfd-box c10"/><text x="450" y="-2" class="pfd-sub">泡沫分离</text>` : ""}
        ${ozoneOn ? `<rect x="${skimmerOn ? 530 : 430}" y="-14" width="14" height="14" rx="3" class="pfd-box c11"/><text x="${skimmerOn ? 550 : 450}" y="-2" class="pfd-sub">臭氧氧化</text>` : ""}
        <rect x="${(skimmerOn ? 530 : 430) + (ozoneOn ? 100 : 0)}" y="-14" width="14" height="14" rx="3" class="pfd-box c9"/>
        <text x="${(skimmerOn ? 530 : 430) + (ozoneOn ? 100 : 0) + 20}" y="-2" class="pfd-sub">反硝化</text>
        ${denitOn ? "" : "<!-- 反硝化未启用，图例隐藏 -->"}
        <g class="pfd-swu-wrap">
          <rect x="${(skimmerOn ? 530 : 430) + (ozoneOn ? 100 : 0) + 110}" y="-16" width="208" height="22" rx="11" class="pfd-swu"/>
          <circle cx="${(skimmerOn ? 530 : 430) + (ozoneOn ? 100 : 0) + 126}" cy="-5" r="4.5" class="pfd-swu-dot"/>
          <text x="${(skimmerOn ? 530 : 430) + (ozoneOn ? 100 : 0) + 138}" y="-1" class="pfd-swu-txt">比水耗 ${d.hydraulics.specificWaterUse} m³/kg</text>
        </g>
      </g>
    </svg>`;
  }
  return { render };
})();
