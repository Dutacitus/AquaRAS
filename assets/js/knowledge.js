/*
 * RAS 工艺设计知识库
 * ----------------------------------------------------------------------------
 * 数据来源综合：
 *  - Timmons & Ebeling (2010). Recirculating Aquaculture, 2nd Ed. (经典 RAS 工程圣经)
 *  - Badiola et al. (2012). Recirculating Aquaculture Systems (RAS) analysis.
 *  - d'Aquin & Timmons (2012). Specific nitrification rates in MBBR biofilters.
 *  - 中国水产科学研究院渔业机械仪器研究所. 陆基工厂化循环水养殖系统设计（全流程参数计算）.
 *  - Minnuo (2025). What Size PSA Oxygen Generator Does Your RAS System Actually Need?
 *  - Global Seafood Advocate (2025). A look at unit processes in RAS systems.
 *  - Klatta et al. (2025). In search of electricity use patterns for RAS — A systematic review. Aquaculture.
 *  - Aydın et al. (2026). Thermodynamics assessment of a near-zero discharged RAS for turbot. Aquacultural Engineering.
 *
 * v1.2.0 (2025–2026 工程校准)：在 v1.1.0 经济性/价格校准基础上，依据全网公开工程文献
 *   复核并更新"计算模型系数"（非用户可自定义的价格/输入）：
 *   - 生物滤池：MBBR 温水硝化速率 0.5–1.2 → 设计值 0.60 kg TAN/m³·天；填料填充率 0.50→0.60（K1 60–70%）
 *   - 氧气：比能耗 0.33→0.80 kWh/kg O₂（商业实测 ~0.7，Liuzhou 鲈鱼 RAS）；品种相关氧耗系数（salmon 0.7/温水 1.0+）
 *   - 微滤机：60µm TSS 去除率 0.92→0.90（文献 72–90%）；固废产率 0.25→0.28 kg/kg 饲料
 *   - 脱气塔：CO₂ 去除率 0.85→0.88（厂商 80–90%）；风机比能耗 0.08 kWh/kg CO₂
 *   - 能耗模型：改为"比能耗系数法"（泵按流体力学公式；氧/脱气/温控/杂项按可校准 kWh 系数）
 *   - 建筑：按单位养殖水体占地 areaPerM3=4.2 m²/m³（含通道与辅助用房；文献 30–50 m²/t·年）
 *   - 补水默认 1%→0.75%（≈日换水 9%，真实 RAS 5–15%；单位水耗落入 0.05–0.5 m³/kg）
 *   - 品种：新增 o2PerFeed / hvacLoadW（温控负荷 W/m³，冷水制冷更高）；罗非密度 70→80 kg/m³
 *   经济性/价格等用户可自定义数据保持 v1.1.0（不在此轮调整）。
 *
 * v1.3.0 (2026 投资估算模型重构)：依据全网最新工程/财务数据，将 CAPEX 从"固定 per-m³ 直接费"升级为
 *   含规模经济与间接费的完整投资模型：
 *   - 补全缺失的 CAPEX 分项：UV 消毒(0.90 去除残留病原)、CO₂ 脱气塔(此前仅在设备库定义、未计入投资)
 *   - 规模经济：总投资 ∝ 年产量^scaleExponent(0.72)，参考规模 300 t/年；小规(<300)单位投资更高、大规更省
 *     （依据 BC 政府 RAS CAPEX 区间 CAD $7–40/kg 年产能、aquaculture-engineer 技术 CAPEX $6.5k–17k/吨）
 *   - 间接费：EPCM 12% + 调试培训 4% + 不可预见 6% + 许可环评其他 3% = 直接费 25%（合计上限 indirectCap=25%，超出按比例封顶）
 *     （依据 financialmodelslab 隐藏成本结构、环江项目 工程费56%/其他费20%/预备费2.3%，并收紧间接费占比至 25% 上限）
 *   - 可选土地费(默认0，用户可经 landCost 覆盖)；营运资金已取消，不再计入总投资
 *   维护费基数由"含间接费的总投资"改为"直接费"(更贴合实际资产维护对象)。
 *
 * v1.5.0 (2026 模型保真度增强，全部为「计算模型系数/结构」优化，用户可自定义数据不动)：
 *   - P0 硝化速率温度修正：biofilter.nitrTheta(1.08)，有效速率 = rate × theta^(T−25)，冷水品种反应器更合理
 *   - P0 TAN 改用饲料蛋白：tanPerFeed 现 = feedProtein × 0.16 × nExcretionFraction(0.50)，高蛋白排泄更高
 *   - P1 HVAC 蒸发潜热：heat.evapLatent/evapRate/evapTempRef，水面蒸发潜热纳入温控负荷
 *   - P1 人工随规模：opex.laborBase + laborPerTon×√产量，取代固定 4 人
 *   - P1 反硝化/NO3：process.denitRemoval(0.85)+denitRate(0.25)，NO3 稳态计入生物脱氮 + 脱氮反应器容积
 *   - P1 价格 asOf/confidence：economics.priceMeta + meta.dataAsOf/confidence
 *   - P2 CAPEX 固定/可变分段：capexDetail[].split(可变比例)，规模因子仅作用于可变段
 *   - P2 地区索引：regions[].costIndex/powerIndex/laborIndex，影响 CAPEX/电价/人工
 *   - P2 魔法数收回：defaults/makeupRate/recircTurns/safety、process.peakFeedFactor/sysWaterFactor/no3Factor、heat.pumpLossFrac、equipment.*.loadFactor
 *   - P2 设备工况修正：oxygen/pump 加 loadFactor(部分负荷效率折扣)
 *
 * 所有数值为"设计基准值"，引擎在计算时会结合安全系数与用户自定义微调。
 */
window.RAS_KNOWLEDGE = {
  meta: {
    version: "1.5.0",
    title: "RAS 工艺设计知识库",
    dataAsOf: "2025–2026",
    confidence: "中",
    note: "v1.1.0 校准经济性/价格；v1.2.0 校准工程模型系数；v1.3.0 重构投资估算(规模经济+间接费+UV/脱气塔)；v1.4.0 HVAC 气候化(地区气温驱动温控)；v1.4.1 间接费收紧至直接费25%上限、取消营运资金。v1.5.0 模型增强：P0 MBBR 硝化速率加温度修正(theta)+TAN 改用饲料蛋白；P1 HVAC 补蒸发潜热/寻优纳入温度与地区/人工随规模/反硝化NO3模型/价格加asOf与置信度；P2 CAPEX 固定+可变分段/地区成本·电价·人工指数/引擎魔法数收回知识库/设备能耗加工况修正/知识库模块化与引用绑定。用户可自定义数据(售价/密度/FCR/气温取值/土地费/单价覆盖项)不在此轮优化。",
    sourceMap: {
      "MBBR 硝化速率": "d'Aquin & Timmons (2012); 渔业机械仪器研究所 (2025)",
      "HVAC 能耗(含蒸发潜热)": "Aydın et al. (2026); 工程经验",
      "CAPEX 规模经济": "BC Government (2022); Aquaculture Engineer (2026)",
      "价格/单价": "广东省水产协会 (2025); 国网 (2025); 鱼粉 Mysteel (2025)",
      "反硝化/NO3": "Timmons & Ebeling (2010); 工程经验",
    },
  },

  // 通用循环水水质控制目标（集约化淡水 RAS 设计阈值）
  waterQuality: {
    tanMax: 1.0,      // mg/L 总氨氮(TAN)上限
    no2Max: 0.5,      // mg/L 亚硝态氮上限
    no3SoftCap: 120,  // mg/L 硝态氮软上限（需排换水控制）
    doMin: 5.0,       // mg/L 溶氧下限（养殖池）
    co2Max: 15,       // mg/L CO2 上限
    phLow: 6.8,
    phHigh: 7.5,
    o2SatMax: 110,    // % 溶氧饱和度上限（防气泡病）
    ssMax: 10,        // mg/L 循环水悬浮固体上限
  },

  // 单元设备设计基准（模型系数，v1.2.0 工程校准）
  equipment: {
    biofilter: {
      type: "MBBR 移动床生物反应器",
      rate: 0.60,        // kg TAN / m³(反应器) / 天 — 设计硝化负荷(基准 25℃；温水 0.5–1.2，冷水×0.6–0.7，取中值偏保守)
      nitrTheta: 1.08,   // 硝化速率温度系数 θ：有效速率 = rate × θ^(T−25)（冷水品种速率下降，反应器更大）
      mediaFill: 0.60,   // 填料填充率（K1 60–70%）
      mediaSurface: 500, // m²/m³ 填料比表面积（Kaldnes K1 标准值）
    },
    drumFilter: {
      type: "转鼓微滤机",
      screen: 60,        // µm 筛网孔径
      tssRemoval: 0.90,  // 悬浮固体去除率（60µm 文献 72–90%，取 0.90）
      backwashLoss: 0.01 // 反洗水占循环量比例
    },
    oxygen: {
      type: "液氧/制氧机 + 氧气锥(LHO)",
      o2PerFeed: 1.0,    // 兜底 kg O2 / kg 饲料（温水高值；品种可覆盖）
      transferEff: 0.95, // 氧气锥传质效率（Speece cone / LHO 0.80–0.95）
      specificEnergy: 0.80, // kWh / kg O2（现场制氧+锥注入比能耗；商业实测 ~0.7，PSA/LOE 区间 0.4–1.2）
      loadFactor: 0.90,  // 部分负荷效率折扣（制氧机随负荷率下降效率降低，实际比能耗 = specificEnergy/loadFactor）
    },
    degasser: {
      type: "填料式 CO2 脱除塔",
      co2Removal: 0.88,  // CO2 去除率（厂商 80–90%，取 0.88）
      fanEnergy: 0.08,   // kWh / kg CO2  stripped（低圧风机比能耗）
    },
    uv: {
      type: "紫外消毒",
      dose: 30,          // mJ/cm²
    },
    pump: {
      head: 4.0,         // m 扬程（RAS 系统水头损失 3–6m）
      eff: 0.70,         // 水泵效率
      loadFactor: 0.90,  // 部分负荷效率折扣（实际轴功率 = 设计功率/loadFactor）
    },
    heat: {
      copHeat: 4.0,      // 热泵制热 COP（现代热泵 >4.0，aquaculture 制热目标）
      copCool: 3.5,      // 制冷机 EER（水产冷水机目标 COP 3.5–4.5，取 3.5 保守）
      uEnvelope: 0.6,   // W/(m²·K) 车间围护传热系数（保温夹芯板，文献 0.31–0.9；取 0.6）
      internalLoadW: 4, // W/m³ 室内恒定得热（照明/控制/鱼代谢/轻微曝气，向制冷负荷叠加、抵消制热）
      pumpLossFrac: 0.12, // 水泵轴功率转化为室内得热的比例（电机/管路损失；抵消制热、叠加制冷）
      evapLatent: 2.26e6, // J/kg 水的汽化潜热（蒸发潜热）
      evapRate: 0.12,   // kg/(m²·h) 室内覆盖池面参考蒸发率(25℃)；随水温线性缩放，冷水更低
      evapTempRef: 25,  // ℃ 蒸发率参考水温
    },
    misc: {
      loadW: 3,          // W/m³ 杂项设备负荷（照明/控制/输送等）
    },
  },

  // 工艺过程常数（质量平衡，v1.2.0 集中管理并标注文献范围）
  process: {
    tanPerFeed: 0.037,   // kg TAN / kg 饲料（[已弃用] 旧常数；v1.5.0 起 TAN 由 feedProtein×0.16×nExcretionFraction 推导，此值仅作兜底）
    nExcretionFraction: 0.50, // 饲料氮中排泄为溶解无机氮(TAN)的比例（其余留存鱼体或颗粒态）；推导 TAN = feedProtein×0.16×本值
    no3Factor: 4.43,     // 质量换算：1 份 N 硝化生成 4.43 份 NO3（=62/14，NO3/N）
    tssPerFeed: 0.28,    // kg TSS / kg 饲料（固废产率；文献 25–35%，取 28%）
    co2Ratio: 0.9,       // CO2 产量 / 耗氧（呼吸商 RQ≈0.9）
    nitrifO2: 4.57,      // kg O2 / kg TAN（硝化耗氧化学计量 NH4+→NO3-）
    peakFeedFactor: 1.8, // 日投喂峰值 / 日均（摄食节律，用于氧气/氮负荷峰值）
    sysWaterFactor: 1.15,// 系统总水量 / 养殖池有效水量（回流管路+滤池保有量）
    denitRemoval: 0.85,  // 反硝化脱氮率（NO3-N 去除比例；现代 RAS 配生物脱氮典型 0.8–0.9）
    denitRate: 0.25,     // kg NO3-N / m³(反应器) / 天 — 异养反硝化容积负荷（设计值）
  },

  // 建筑占地模型（v1.2.0）
  building: {
    areaPerM3: 4.2,      // m² / m³ 养殖水体（含通道、设备区与辅助用房；文献 30–50 m²/t·年）
    height: 6,           // m 车间层高
  },

  // 输入默认值（v1.5.0 从引擎收回，集中管理用户未自定义时的回退值）
  defaults: {
    makeupRate: 0.0075,  // 默认补水率（占循环量；≈日换水 9%，真实 RAS 5–15%）
    recircTurns: 12,     // 默认日循环次数
    safety: 1.15,        // 默认安全系数
  },

  // 气候模型（v1.4.0）：地区全年平均气温驱动 HVAC 负荷
  // - defaultAmbient：无地区输入时的兜底均温（温带中值）
  // - regions：中国主要城市全年平均气温预设（°C，中国气象局多年均值近似），供前端一键填入
  // - 引擎按 (设定温 − 均温) 计算围护传热与补水加热，分制热/制冷 COP
  climate: {
    defaultAmbient: 15,  // °C 默认全年平均气温（温带，未指定地区时）
    cpWater: 4186,       // J/(kg·K) 水比热容
    regions: {
      harbin:    { name: "哈尔滨", ambient: 4,  costIndex: 0.95, powerIndex: 1.00, laborIndex: 0.85 },
      beijing:   { name: "北京",   ambient: 12, costIndex: 1.15, powerIndex: 1.05, laborIndex: 1.25 },
      shanghai:  { name: "上海",   ambient: 17, costIndex: 1.12, powerIndex: 1.02, laborIndex: 1.20 },
      guangzhou: { name: "广州",   ambient: 22, costIndex: 1.08, powerIndex: 1.00, laborIndex: 1.05 },
      sanya:     { name: "三亚",   ambient: 26, costIndex: 1.10, powerIndex: 1.08, laborIndex: 0.95 },
      kunming:   { name: "昆明",   ambient: 15, costIndex: 0.95, powerIndex: 0.95, laborIndex: 0.85 },
      wuhan:     { name: "武汉",   ambient: 17, costIndex: 1.00, powerIndex: 1.00, laborIndex: 1.00 },
      chengdu:   { name: "成都",   ambient: 16, costIndex: 0.98, powerIndex: 0.98, laborIndex: 0.95 },
    },
  },

  // 品种数据库（默认运行于室内集约化 RAS）
  // feedPrice: 元/kg 该品种专用饲料（2025，受鱼粉价格驱动；引擎默认优先采用，表单可覆盖）
  // marketPrice: 元/kg 出厂参考价（2025 批发/塘头中值；RAS 精品溢价更高，可在表单覆盖）
  // o2PerFeed: kg O2 / kg 饲料（品种/温度相关氧耗系数；salmon 冷水低，温水高）
  // designTemp: ℃ 设定养殖水温（= 温控负荷的"目标温度"，与环境均温共同决定 HVAC 能耗）
  //   注：原固定 hvacLoadW 已于 v1.4.0 移除，HVAC 改为随 (designTemp − 地区均温) 气候化计算
  species: {
    bass: {
      key: "bass",
      name: "加州鲈鱼",
      latin: "Micropterus salmoides",
      group: "温水肉食性",
      designTemp: 25,
      tempRange: [20, 28],
      fcr: 1.30,           // 饲料系数
      feedPrice: 12,       // 元/kg 饲料（肉食性,45%蛋白,2025）
      fingerlingPrice: 0.8, // 元/尾 苗种（500g 级鱼种,2025）
      feedProtein: 0.45,   // 饲料蛋白含量
      harvestSize: 500,    // g 出塘规格
      stockingDensity: 60, // kg/m³ 设计放养密度（集约化；实测可达 78）
      cyclesPerYear: 1.6,  // 年有效养殖茬次（分级连续出鱼）
      doMin: 5.0,
      tanMax: 1.0,
      o2PerFeed: 1.0,      // 温水高氧耗端
      note: "建议三级分级养殖；对溶氧敏感，需稳定 >5 mg/L；适温 20–28℃。",
      marketPrice: 28,    // 元/kg 出厂参考价（2025 批发/塘头中值；RAS 精品 55–68）
    },
    salmon: {
      key: "salmon",
      name: "大西洋鲑",
      latin: "Salmo salar",
      group: "冷水肉食性",
      designTemp: 14,
      tempRange: [10, 16],
      fcr: 1.15,
      feedPrice: 15,       // 元/kg 饲料（高蛋白海洋性,2025）
      fingerlingPrice: 4,   // 元/尾 苗种（smolt 级,2025）
      feedProtein: 0.44,
      harvestSize: 4000,
      stockingDensity: 40, // kg/m³ 设计放养密度（福利建议 60–80；中国实测上限 ~30，取折中 40）
      cyclesPerYear: 1.3,
      doMin: 6.0,
      tanMax: 0.8,
      o2PerFeed: 0.7,      // 冷水(14℃)氧耗系数低（文献 ~0.6 呼吸 + 硝化）
      note: "冷水品种，需强制冷与高溶氧(>6 mg/L)；能耗主要来自制冷。",
      marketPrice: 60,    // 元/kg 出厂参考价（2025 养殖端；进口冰鲜批发 68–98）
    },
    trout: {
      key: "trout",
      name: "虹鳟",
      latin: "Oncorhynchus mykiss",
      group: "冷水肉食性",
      designTemp: 15,
      tempRange: [10, 17],
      fcr: 1.20,
      feedPrice: 13,       // 元/kg 饲料（肉食性,2025）
      fingerlingPrice: 1,   // 元/尾 苗种,2025
      feedProtein: 0.43,
      harvestSize: 600,
      stockingDensity: 40,
      cyclesPerYear: 1.5,
      doMin: 6.0,
      tanMax: 0.9,
      o2PerFeed: 0.8,
      note: "冷水品种，对氨氮与低温敏感，需全年控温。",
      marketPrice: 40,    // 元/kg 出厂参考价（2025 批发中值）
    },
    turbot: {
      key: "turbot",
      name: "大菱鲆",
      latin: "Scophthalmus maximus",
      group: "低温肉食性(海水/半咸水)",
      designTemp: 18,
      tempRange: [14, 21],
      fcr: 1.25,
      feedPrice: 15,       // 元/kg 饲料（高蛋白,2025）
      fingerlingPrice: 2,   // 元/尾 苗种,2025
      feedProtein: 0.48,
      harvestSize: 800,
      stockingDensity: 45,
      cyclesPerYear: 1.4,
      doMin: 5.5,
      tanMax: 0.9,
      o2PerFeed: 0.8,
      note: "低换水、平面池或圆角池；半咸水养殖需注意盐度稳定。",
      marketPrice: 54,    // 元/kg 出厂参考价（2025 批发 ~52，工厂化精品更高）
    },
    tilapia: {
      key: "tilapia",
      name: "罗非鱼",
      latin: "Oreochromis niloticus",
      group: "温水杂食性",
      designTemp: 28,
      tempRange: [25, 32],
      fcr: 1.50,
      feedPrice: 8,        // 元/kg 饲料（杂食性,32%蛋白,2025 较低）
      fingerlingPrice: 0.3, // 元/尾 苗种（鱼苗便宜,2025）
      feedProtein: 0.32,
      harvestSize: 600,
      stockingDensity: 80, // kg/m³（上调至 80；文献 80–120，罗非耐高密度）
      cyclesPerYear: 2.0,
      doMin: 4.0,
      tanMax: 1.2,
      o2PerFeed: 0.9,
      note: "耐低氧、耐高密度；生长快、茬次多，单位体积产量高。",
      marketPrice: 16,    // 元/kg 出厂参考价（2025 批发 ~15–16）
    },
    shrimp: {
      key: "shrimp",
      name: "南美白对虾",
      latin: "Litopenaeus vannamei",
      group: "温水甲壳类",
      designTemp: 28,
      tempRange: [26, 31],
      fcr: 1.40,
      feedPrice: 11,       // 元/kg 饲料（38%蛋白,2025）
      fingerlingPrice: 0.02,// 元/尾 苗种（PL 虾苗极廉,2025）
      feedProtein: 0.38,
      harvestSize: 20,
      stockingDensity: 25,    // kg/m³ 生物量密度（现代虾类 RAS 集约化 20–50，取 25）
      cyclesPerYear: 3.0,
      doMin: 5.0,
      tanMax: 1.0,
      o2PerFeed: 0.9,
      note: "甲壳类对 NO2 极敏感；需分级、强增氧与生物絮团(BFT)可选工艺。",
      marketPrice: 46,    // 元/kg 出厂参考价（2025 批发 44–60）
    },
  },

  // 行业经验经济参数（人民币，2025–2026 校准；单价类数据用户可在表单覆盖）
  economics: {
    // —— 直接费基准（参考规模 refAnnualTons 下的 元/m³ 养殖水体 / 元/m² 土建）——
    // v1.3.0：补全 UV 消毒与 CO₂ 脱气塔（此前缺失）；引入规模经济 + 间接费模型（见 capexModel）
    capexPerM3: {
      tanks: 400,        // 养殖池+支架
      biofilter: 320,    // 生物滤池(MBBR)+填料
      solids: 140,       // 微滤机+固废
      oxygen: 320,       // 制氧/液氧+氧气锥
      degasser: 120,     // CO₂ 脱气塔（NEW：原仅在设备库定义、未计入投资）
      uv: 90,            // 紫外消毒 UV（NEW：原缺失）
      pumps: 170,        // 水泵+管路
      controls: 240,     // 自控+监测(IoT)
      building: 900,     // 车间土建(含保温)，元/m²
      hvac: 340,         // 控温(热泵/制冷)
    },
    // 投资估算模型（v1.3.0 引入规模经济 + 间接费模型；v1.4.1 收紧间接费至直接费 25% 上限、取消营运资金）
    //   依据 BC 政府 RAS CAPEX $7–40/kg 区间、aquaculture-engineer 技术 CAPEX $6.5k–17k/吨、
    //   financialmodelslab 间接成本结构、环江项目其他费/预备费占比 校准
    capexModel: {
      refAnnualTons: 300,     // 参考规模(t/年)：基准 per-m³ 对应该规模；<300 单位投资更高、>300 更省
      scaleExponent: 0.72,    // 总投资 ∝ 年产量^0.72（六 tenths 法则，规模经济；exp<1 体现亚线性）
      indirect: {             // 间接费各项（按直接费比例），其合计上限为 indirectCap
        epcm: 0.12,           // 设计/采购/施工管理(EPCM) = 直接费×12%
        commissioning: 0.04,  // 调试与培训 = 直接费×4%
        contingency: 0.06,    // 不可预见费 = 直接费×6%
        other: 0.03,          // 许可/环评/其他费 = 直接费×3%
      },
      indirectCap: 0.25,      // 间接费上限 = 直接费 × 25%（各项合计超过时按比例封顶）
      landDefault: 0,         // 土地费(元)，可选；用户可经 inputs.landCost 覆盖，默认 0（租地/已有）
    },
    // CAPEX 各投资项一级分解：子单价之和 == 对应分类额（已含规模因子缩放，详见引擎）
    capexDetail: {
      tanks:    { qty: "m3", split: 0.95, subs: [["池体(PP/FRP/混凝土)", 240], ["支架与基础", 60], ["进出水与集排污", 60], ["池内曝气推流", 40]] },
      biofilter:{ qty: "m3", split: 0.90, subs: [["反应器壳体", 140], ["悬浮填料(K1)", 100], ["曝气系统", 60], ["进出水与回流", 20]] },
      solids:   { qty: "m3", split: 0.85, subs: [["转鼓微滤机(60µm)", 85], ["污泥浓缩脱水", 35], ["反洗水回收", 20]] },
      oxygen:   { qty: "m3", split: 0.85, subs: [["制氧/液氧站", 190], ["氧气锥(LHO)", 90], ["管路与监测", 40]] },
      degasser: { qty: "m3", split: 0.70, subs: [["脱气填料塔体", 70], ["低圧脱气风机", 30], ["管路与监测", 20]] },
      uv:       { qty: "m3", split: 0.60, subs: [["UV 杀菌机组(30mJ/cm²)", 60], ["石英套管/模块", 20], ["管路与监测", 10]] },
      pumps:    { qty: "m3", split: 0.90, subs: [["循环水泵(一用一备)", 105], ["管路阀门管件", 45], ["流量计控制阀", 20]] },
      controls: { qty: "m3", split: 0.40, subs: [["PLC/SCADA 自控", 90], ["在线监测(DO/pH/TAN)", 110], ["电气布线", 40]] },
      building: { qty: "m2", split: 0.97, subs: [["主体结构", 450], ["围护保温屋顶", 280], ["地坪防渗排水", 120], ["照明消防辅助", 50]] },
      hvac:     { qty: "m3", split: 0.75, subs: [["热泵/制冷机组", 210], ["换热器管路", 80], ["保温与控制", 50]] },
    },
    opex: {
      feedPrice: 11,       // 元/kg 饲料（兜底均价,肉食性;2025 鱼粉上涨后基准;品种可覆盖）
      fingerlingPrice: 0.8,// 元/尾 苗种(按出塘尾数折算)
      waterPrice: 5.0,     // 元/m³ 生产补水（工业/处理水,2025;可按地区覆盖）
      laborPerYear: 130000,// 元/人·年（2025 技术/管理岗）
      laborBase: 2,        // 基础定员（最小骨架班组，v1.5.0 取代固定 4 人）
      laborPerTon: 0.35,   // 每 √(吨/年) 追加人；laborCount = max(laborBase, round(laborBase + laborPerTon×√产量))
      maintenanceRate: 0.04,// 维护占直接费比例/年（v1.3.0 基数由总投资改为直接费）
      elecPrice: 0.72,     // 元/kWh（2025 工商业均价,省际 0.63–0.77）
    },
    // 价格数据治理（v1.5.0，P1-7）：标注数据时效与置信度，供 UI 展示与审计
    priceMeta: {
      asOf: "2025",
      confidence: "中",
      note: "饲料/苗种/鱼价来自 2025 年行业简报；电价来自 2025 工商业代理购电价；装备 CAPEX 来自 2025–2026 工程可研。置信度「中」：区间值，随市场波动，建议项目级复核。",
    },
  },

  references: [
    "Timmons M.B., Ebeling J.M. (2010). Recirculating Aquaculture, 2nd Ed. Cayuga Aqua Ventures.",
    "Badiola M. et al. (2012). Recirculating Aquaculture Systems (RAS) analysis. AACL Bioflux 5(2).",
    "d'Aquin A., Timmons M. (2012). Specific nitrification rates in MBBR biofilters.",
    "中国水产科学研究院渔业机械仪器研究所. (2025). 陆基工厂化循环水养殖系统设计：从前期决策到参数计算的全流程构建（MBBR 温水 0.5–1.2、冷水×0.6–0.7 kg TAN/m³·d；K1 填料 500 m²/m³、填充 60–70%；OTR 0.25–0.5 kg O₂/kg 饲料）。",
    "Minnuo. (2025). What Size PSA Oxygen Generator Does Your RAS System Actually Need?（氧气锥传质 0.80–0.95；安全裕度 15–25%；salmon 14℃ 氧耗比 ~0.6 kg O₂/kg 饲料）。",
    "Global Seafood Advocate. (2025). A look at unit processes in RAS systems（扩散曝气 1.3 kg O₂/kWh 标况；总氧耗 0.3–1.0 kg O₂/kg 饲料随固废停留）。",
    "Klatta L. et al. (2025). In search of electricity use patterns for RAS — A systematic review. Aquaculture（泵 25–45%、增氧 9–37%、温控可达 >50%、UV 达 16%）。",
    "Aydın U. et al. (2026). Thermodynamics assessment of a near-zero discharged RAS for turbot. Aquacultural Engineering 113（特定能耗 52 kWh/kg；循环 26%、增氧 15%、空调 13%、消毒 12%）。",
    "rasfilter.com. (2025). Liuzhou 商业化鲈鱼 RAS 案例（密度 78.75 kg/m³、FCR 1.02、电耗 2.35 kWh/kg、氧气系统 ~0.7 kWh/kg）。",
    "Global Aquaculture Advocate / DIFTA. (2000). Drum filter efficiency（60µm 真实 TSS 去除 ~48–72%，>55µm 颗粒 >85–90% 截留）。",
    "Kingto / Laswim / YUTANK. (2025). 脱气塔规格（CO₂ 去除 80–90%/pass；低圧风机 300–700 Pa）。",
    "Aggregator / Aquafarmer. (2025). RAS 对比（水耗 0.05–0.5 m³/kg；密度 40–120 kg/m³；面积 30–50 m²/t·年）。",
    "Wang Y. et al. (2019). Effects of stocking density on Atlantic salmon in RAS（中国实测上限 ~30 kg/m³；福利建议 60–80）。",
    "《工厂化循环水养殖工程设计规范》(行业经验值)",
    // —— 2025 价格校准来源（v1.1.0，本轮不动）——
    "广东省水产流通与加工协会. (2025). 广东省水产品批发市场价格分析简报：罗非鱼 ~15.8、南美白对虾统货 44–50、加州鲈冰鲜 28–32 元/kg。",
    "厦门市海洋发展局. (2025-12-11). 主要水产品批发价格：大菱鲆 52、南美白对虾(活鲜)60、罗非鱼 15 元/kg。",
    "海鲜指南/三文鱼周报. (2025-08). 中国冰鲜三文鱼批发：挪威/苏格兰/智利 68–98 元/kg。",
    "Mysteel/卓创资讯. (2025). 进口超级蒸汽鱼粉 13000–14800 元/吨；9 月水产饲料普涨。",
    "顺时环保/行业综述. (2025). 中国工厂化循环水装备市场：中端 3000–5000 元/m³，进口高端 5000–8000 元/m³。",
    "国网陕西/深圳供电局. (2025). 工商业代理购电到户均价 0.63–0.77 元/kWh。",
    // —— 2026 CAPEX 模型校准来源（v1.3.0）——
    "Government of British Columbia. (2022). RAS capital costs CAD $7–40 per kg of planned annual production capacity（规模经济区间，反映小规高、大规低）。",
    "Aquaculture Engineer. (2026). RAS Fish Farm Cost: CAPEX, OPEX & Investment Model（建筑 $900/m²×10 m²/吨·年；技术 CAPEX(设备+物流+安装+调试) $6.5k–17k/吨按回收期；土地 $100/m²×20 m²/吨）。",
    "FinancialModelsLab. (2026). Recirculating Aquaculture System Startup Costs（隐藏成本：许可/设计/水质检测/培训/保险/生物安全/营运资金；设备+安装+调试分列）。",
    "环江毛南族自治县发改局. (2023). 洛阳镇江妙陆基循环水项目可研批复：总投资 280 万 = 工程费 56% + 工程建设其他费 20% + 预备费 2.3% + 流动资金 22%。",
    "Wolize. (2025). RAS vs Flowing Systems 成本：工业化 RAS 建设成本 $250–$400/m³（3000 m³ 级）， productivity 80–120 kg/m³。",
  ],
};
