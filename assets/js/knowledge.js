/*
 * RAS 工艺设计知识库
 * ----------------------------------------------------------------------------
 * 数据来源综合：
 *  - Timmons & Ebeling (2010). Recirculating Aquaculture, 2nd Ed. (经典 RAS 工程圣经)
 *  - Badiola et al. (2012). Recirculating Aquaculture Systems (RAS) analysis:
 *    main issues on management and future challenges. AACL Bioflux.
 *  - Martins et al. (2010). New candidates for fish farming in RAS.
 *  - Summerfelt (2006). 生物滤池与 CO2 脱除设计.
 *  - d'Aquin & Timmons (2012). MBBR 硝化速率.
 *  - 行业经验值：循环水养殖工程设计与运行规范、典型工程案例。
 *
 * 所有数值为"设计基准值"，引擎在计算时会结合安全系数与用户自定义微调。
 */
window.RAS_KNOWLEDGE = {
  meta: {
    version: "1.0.0",
    title: "RAS 工艺设计知识库",
    note: "参数随品种与运行模式变化，计算引擎会施加安全系数。",
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

  // 单元设备设计基准
  equipment: {
    biofilter: {
      type: "MBBR 移动床生物反应器",
      rate: 0.55,        // kg TAN / m³(反应器) / 天  — 设计硝化负荷（保守，含温度折减）
      mediaFill: 0.50,   // 填料填充率
      mediaSurface: 500, // m²/m³ 填料比表面积
    },
    drumFilter: {
      type: "转鼓微滤机",
      screen: 60,        // µm 筛网孔径
      tssRemoval: 0.92,  // 悬浮固体去除率
      backwashLoss: 0.01 // 反洗水占循环量比例
    },
    oxygen: {
      type: "液氧/制氧机 + 氧气锥(LHO)",
      o2PerFeed: 1.0,    // kg O2 / kg 饲料（设计氧耗）
      transferEff: 0.95, // 氧气锥传质效率
    },
    degasser: {
      type: "填料式 CO2 脱除塔",
      co2Removal: 0.85,  // CO2 去除率
    },
    uv: {
      type: "紫外消毒",
      dose: 30,          // mJ/cm²
    },
    pump: {
      head: 4.0,         // m 扬程（系统水头损失）
      eff: 0.70,         // 水泵效率
    },
    heat: {
      cop: 4.0,          // 热泵 COP
    },
  },

  // 品种数据库（默认运行于室内集约化 RAS）
  species: {
    bass: {
      key: "bass",
      name: "加州鲈鱼",
      latin: "Micropterus salmoides",
      group: "温水肉食性",
      designTemp: 25,
      tempRange: [20, 28],
      fcr: 1.30,           // 饲料系数
      feedProtein: 0.45,   // 饲料蛋白含量
      harvestSize: 500,    // g 出塘规格
      stockingDensity: 60, // kg/m³ 设计放养密度（集约化）
      cyclesPerYear: 1.6,  // 年有效养殖茬次（分级连续出鱼）
      doMin: 5.0,
      tanMax: 1.0,
      note: "建议三级分级养殖；对溶氧敏感，需稳定 >5 mg/L；适温 20–28℃。",
    },
    salmon: {
      key: "salmon",
      name: "大西洋鲑",
      latin: "Salmo salar",
      group: "冷水肉食性",
      designTemp: 14,
      tempRange: [10, 16],
      fcr: 1.15,
      feedProtein: 0.44,
      harvestSize: 4000,
      stockingDensity: 35,
      cyclesPerYear: 1.3,
      doMin: 6.0,
      tanMax: 0.8,
      note: "冷水品种，需强制冷与高溶氧(>6 mg/L)；能耗主要来自制冷。",
    },
    trout: {
      key: "trout",
      name: "虹鳟",
      latin: "Oncorhynchus mykiss",
      group: "冷水肉食性",
      designTemp: 15,
      tempRange: [10, 17],
      fcr: 1.20,
      feedProtein: 0.43,
      harvestSize: 600,
      stockingDensity: 40,
      cyclesPerYear: 1.5,
      doMin: 6.0,
      tanMax: 0.9,
      note: "冷水品种，对氨氮与低温敏感，需全年控温。",
    },
    turbot: {
      key: "turbot",
      name: "大菱鲆",
      latin: "Scophthalmus maximus",
      group: "低温肉食性(海水/半咸水)",
      designTemp: 18,
      tempRange: [14, 21],
      fcr: 1.25,
      feedProtein: 0.48,
      harvestSize: 800,
      stockingDensity: 45,
      cyclesPerYear: 1.4,
      doMin: 5.5,
      tanMax: 0.9,
      note: "低换水、平面池或圆角池；半咸水养殖需注意盐度稳定。",
    },
    tilapia: {
      key: "tilapia",
      name: "罗非鱼",
      latin: "Oreochromis niloticus",
      group: "温水杂食性",
      designTemp: 28,
      tempRange: [25, 32],
      fcr: 1.50,
      feedProtein: 0.32,
      harvestSize: 600,
      stockingDensity: 70,
      cyclesPerYear: 2.0,
      doMin: 4.0,
      tanMax: 1.2,
      note: "耐低氧、耐高密度；生长快、茬次多，单位体积产量高。",
    },
    shrimp: {
      key: "shrimp",
      name: "南美白对虾",
      latin: "Litopenaeus vannamei",
      group: "温水甲壳类",
      designTemp: 28,
      tempRange: [26, 31],
      fcr: 1.40,
      feedProtein: 0.38,
      harvestSize: 20,
      stockingDensity: 4,     // kg/m³（虾类按尾数密度换算，此处为生物量密度）
      cyclesPerYear: 3.0,
      doMin: 5.0,
      tanMax: 1.0,
      note: "甲壳类对 NO2 极敏感；需分级、强增氧与生物絮团(BFT)可选工艺。",
    },
  },

  // 行业经验经济参数（人民币，2024–2025 量级，供估算参考）
  economics: {
    // 单位设备/土建投资（元 / m³ 养殖水体）
    capexPerM3: {
      tanks: 350,        // 养殖池+支架
      biofilter: 280,    // 生物滤池+填料
      solids: 120,       // 微滤机+固废
      oxygen: 260,       // 制氧/液氧+氧气锥
      pumps: 150,        // 水泵+管路
      controls: 200,     // 自控+监测(IoT)
      building: 900,     // 车间土建(含保温)
      hvac: 300,         // 控温(热泵/制冷)
    },
    opex: {
      feedPrice: 9.5,      // 元/kg 饲料
      fingerlingPrice: 0.8,// 元/尾 苗种(按出塘尾数折算)
      laborPerYear: 120000,// 元/人·年
      laborCount: 4,       // 基准人数
      maintenanceRate: 0.04,// 维护占 CAPEX 比例/年
      elecPrice: 0.75,     // 元/kWh
    },
  },

  references: [
    "Timmons M.B., Ebeling J.M. (2010). Recirculating Aquaculture, 2nd Ed. Cayuga Aqua Ventures.",
    "Badiola M. et al. (2012). Recirculating Aquaculture Systems (RAS) analysis: main issues on management and future challenges. AACL Bioflux 5(2).",
    "Martins C.I.M. et al. (2010). New candidates for fish farming in RAS. In: Aquacult. Eng.",
    "Summerfelt S.T. (2006). Design and management of conventional and alternative recirculating aquaculture systems. Wat. Sci. Tech.",
    "d'Aquin A., Timmons M. (2012). Specific nitrification rates in MBBR biofilters.","《工厂化循环水养殖工程设计规范》(行业经验值)",
  ],
};
