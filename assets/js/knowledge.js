/* AquaRAS 公开知识子集（仅含引擎计算所需数值系数；校准来源/参考文献/置信度等商业机密见服务端私有文件） */
window.RAS_KNOWLEDGE = {
  "meta": {
    "version": "1.25.0",
    "title": "RAS 工艺设计知识库",
    "dataAsOf": "2026",
    "confidence": "中"
  },
  "waterQuality": {
    "tanMax": 1,
    "no2Max": 0.5,
    "no3SoftCap": 120,
    "doMin": 5,
    "co2Max": 15,
    "phLow": 6.8,
    "phHigh": 7.5,
    "phHighHard": 8.5,
    "phLowMarine": 6.5,
    "phHighMarine": 8.5,
    "o2SatMax": 110,
    "ssMax": 10,
    "docMax": 12,
    "docSoftCap": 8,
    "disinfectionTargetLog": 3
  },
  "standards": {
    "db44_2462_2024": {
      "name": "广东省《水产养殖尾水排放标准》DB44/2462-2024",
      "freshwater": {
        "level1": {
          "phLow": 6,
          "phHigh": 9,
          "ss": 45,
          "cod": 15,
          "tn": 3,
          "tp": 0.4
        },
        "level2": {
          "phLow": 6,
          "phHigh": 9,
          "ss": 90,
          "cod": 25,
          "tn": 5,
          "tp": 1
        }
      },
      "seawater": {
        "level1": {
          "phLow": 6.5,
          "phHigh": 9,
          "ss": 40,
          "cod": 10,
          "tn": 3.5,
          "tp": 0.5
        },
        "level2": {
          "phLow": 6.5,
          "phHigh": 9,
          "ss": 90,
          "cod": 20,
          "tn": 7,
          "tp": 1.5
        }
      }
    }
  },
  "tailwaterTreatment": {
    "none": {
      "name": "无（直排）",
      "tn": 0,
      "tp": 0,
      "cod": 0,
      "ss": 0,
      "capexPerM3d": 0,
      "opexPerM3": 0,
      "footprintPerM3d": 0,
      "note": "排放口浓度=系统循环水浓度"
    },
    "denitBiofilter": {
      "name": "反硝化生物滤柱",
      "tn": 0.95,
      "tp": 0.3,
      "cod": 0.6,
      "ss": 0.7,
      "capexPerM3d": 600,
      "opexPerM3": 0.9,
      "footprintPerM3d": 0.4,
      "note": "发酵/固体碳源，NO₃-N>99%(综述)，HRT 3–4h"
    },
    "sulfurDenit": {
      "name": "硫自养反硝化",
      "tn": 0.92,
      "tp": 0.2,
      "cod": 0.3,
      "ss": 0.6,
      "capexPerM3d": 900,
      "opexPerM3": 0.4,
      "footprintPerM3d": 0.5,
      "note": "免外加碳源，海水/低有机碳尾水稳定"
    },
    "wetland": {
      "name": "人工湿地",
      "tn": 0.5,
      "tp": 0.6,
      "cod": 0.5,
      "ss": 0.85,
      "capexPerM3d": 300,
      "opexPerM3": 0.1,
      "footprintPerM3d": 2.4,
      "note": "复合垂直流，NO₃-N~54%/SS85%/TP初期89%；水力负荷420mm/d"
    },
    "aquaponics": {
      "name": "鱼菜共生/植物渠",
      "tn": 0.38,
      "tp": 0.3,
      "cod": 0.35,
      "ss": 0.5,
      "capexPerM3d": 500,
      "opexPerM3": 0.3,
      "footprintPerM3d": 1.5,
      "note": "资源化，NO₃-N 30–42%/TAN 40–70%"
    },
    "multiStage": {
      "name": "多级生物净化组合",
      "tn": 0.9,
      "tp": 0.7,
      "cod": 0.75,
      "ss": 0.9,
      "capexPerM3d": 1500,
      "opexPerM3": 1.2,
      "footprintPerM3d": 3,
      "note": "生物滤+臭氧+湿地+植物多级，TN可≤1.5–2 mg/L"
    }
  },
  "equipment": {
    "biofilter": {
      "type": "MBBR 移动床生物反应器",
      "rate": 0.6,
      "rateNitritation": 0.6,
      "rateNitratation": 2,
      "nitrTheta": 1.08,
      "nitrThetaAOB": 1.08,
      "nitrThetaNOB": 1.1,
      "mediaFill": 0.6,
      "mediaSurface": 500,
      "doKs": 1.5,
      "pHopt": 8,
      "pHhighDecay": 0.7,
      "pHhighWidth": 0.1,
      "faInhibit": false,
      "faAOB": 10,
      "faNOB": 0.5,
      "fnaHalf": 0.05,
      "salrRef": 5,
      "salrMax": 10
    },
    "drumFilter": {
      "type": "转鼓微滤机",
      "screen": 60,
      "tssRemoval": 0.93,
      "backwashLoss": 0.01
    },
    "oxygen": {
      "type": "液氧/制氧机 + 氧气锥(LHO)",
      "o2PerFeed": 1,
      "transferEff": 0.95,
      "specificEnergy": 0.8,
      "loadFactor": 0.9
    },
    "degasser": {
      "type": "填料式 CO2 脱除塔",
      "co2Removal": 0.88,
      "fanEnergy": 0.08
    },
    "uv": {
      "type": "紫外消毒",
      "dose": 30,
      "specificEnergy": 0.001
    },
    "skimmer": {
      "type": "泡沫分离(蛋白分离器)",
      "docRemoval": 0.45,
      "fineTssCapture": 0.35,
      "sideFrac": 0.25,
      "specificEnergy": 0.006,
      "sludgeFactor": 0.15
    },
    "ozone": {
      "type": "臭氧氧化+消毒",
      "dose": 0.02,
      "specificEnergy": 0.003,
      "docBoost": 0.3,
      "docSynergy": 1.15,
      "no2Oxidize": 0.5,
      "disinfectLog": 3
    },
    "pump": {
      "head": 4,
      "eff": 0.7,
      "loadFactor": 0.9,
      "pipeDiameter": 0.35,
      "velocityMax": 2.5,
      "pipeLength": 150,
      "pipeLengthRefVol": 300,
      "pipeRoughness": 0.0000015,
      "staticLift": 2.8,
      "minorLossK": 5
    },
    "heat": {
      "copHeat": 4,
      "copCool": 3.5,
      "heatRecoveryEff": 0.6,
      "uEnvelope": 0.6,
      "internalLoadW": 4,
      "pumpLossFrac": 0.12,
      "evapLatent": 2440000,
      "evapRate": 0.12,
      "evapTempRef": 25
    },
    "misc": {
      "loadW": 3
    }
  },
  "process": {
    "tanPerFeed": 0.037,
    "nExcretionFraction": 0.5,
    "nExcretionRef": 0.85,
    "solidsDisposalEnergy": 0.08,
    "tssPerFeed": 0.22,
    "secondarySolidsCapture": 0.5,
    "docPerFeed": 0.15,
    "o2FishCal": 0.45,
    "o2RefTemp": 25,
    "q10O2": 2,
    "co2DoeThresh": 15,
    "co2DoeScale": 40,
    "co2Ratio": 0.9,
    "co2PerN": 4.57,
    "co2Kla": 3,
    "co2Star": 0.5,
    "nitrifO2": 4.57,
    "peakFeedFactor": 1.8,
    "sysWaterFactor": 1.15,
    "fcrDensityCoef": 0.008,
    "fcrDensitySat": 0.003,
    "growthHandlingDays": 14,
    "rationSatiationMax": 3.5,
    "tankDHmax": 5,
    "tankSlopePct": 7,
    "tankHRTmin": 15,
    "tankHRTmax": 90,
    "tankHRTtarget": 60,
    "swirlVelMin": 15,
    "swirlVelMax": 30,
    "denitRemoval": 0.85,
    "denitRate": 0.25,
    "alkPerN": 7.14,
    "alkProdDenit": 3.57,
    "alkTarget": 120,
    "alkMin": 80,
    "phTarget": 7.2,
    "pK1_25": 6.35,
    "pK2_25": 10.33,
    "pKaNH3_25": 9.25,
    "fnaPka": 3.15,
    "nahco3Eff": 0.5957,
    "nh3Acute": 0.02,
    "nh3Chronic": 0.01,
    "nh3TempCoef": 0.0283,
    "sludgeCakeWc": 0.8,
    "drumBackwashFrac": 0.08,
    "degasserMistFrac": 0.005,
    "feedPContent": 0.012,
    "pExcreteFrac": 0.35,
    "pCapture": 0.85,
    "codPerFeed": 0.45,
    "codCapture": 0.8,
    "docBaseRemoval": 0.45
  },
  "uncertainty": {
    "params": [
      {
        "key": "biofilter.rateNitritation",
        "path": "equipment.biofilter.rateNitritation",
        "low": 0.45,
        "exp": 0.6,
        "high": 0.9,
        "label": "MBBR AOB 实际硝化速率",
        "kind": "epistemic"
      },
      {
        "key": "biofilter.nitrTheta",
        "path": "equipment.biofilter.nitrTheta",
        "low": 1.04,
        "exp": 1.08,
        "high": 1.12,
        "label": "硝化温度系数 θ",
        "kind": "epistemic"
      },
      {
        "key": "heat.copHeat",
        "path": "equipment.heat.copHeat",
        "low": 3.2,
        "exp": 4,
        "high": 5,
        "label": "热泵制热 COP",
        "kind": "epistemic"
      },
      {
        "key": "heat.copCool",
        "path": "equipment.heat.copCool",
        "low": 2.8,
        "exp": 3.5,
        "high": 4.5,
        "label": "制冷 COP",
        "kind": "epistemic"
      },
      {
        "key": "heat.evapRate",
        "path": "equipment.heat.evapRate",
        "low": 0.08,
        "exp": 0.12,
        "high": 0.18,
        "label": "水面蒸发率",
        "kind": "epistemic"
      },
      {
        "key": "process.denitRate",
        "path": "process.denitRate",
        "low": 0.18,
        "exp": 0.25,
        "high": 0.35,
        "label": "反硝化容积负荷",
        "kind": "epistemic"
      },
      {
        "key": "process.alkPerN",
        "path": "process.alkPerN",
        "low": 6.5,
        "exp": 7.14,
        "high": 8,
        "label": "硝化耗碱度系数",
        "kind": "epistemic"
      }
    ]
  },
  "building": {
    "areaPerM3": 4.2,
    "height": 6
  },
  "defaults": {
    "makeupRate": 0.0075,
    "recircTurns": 24,
    "safety": 1.15,
    "makeupBackground": {
      "tan": 0.05,
      "no2": 0.01,
      "no3": 2,
      "alk": 150
    },
    "carbonFactor": 0.58
  },
  "climate": {
    "defaultAmbient": 15,
    "cpWater": 4186,
    "regions": {
      "harbin": {
        "name": "哈尔滨",
        "ambient": 4,
        "amp": 19,
        "costIndex": 0.95,
        "powerIndex": 1,
        "laborIndex": 0.85,
        "carbonFactor": 0.85
      },
      "beijing": {
        "name": "北京",
        "ambient": 12,
        "amp": 13,
        "costIndex": 1.15,
        "powerIndex": 1.05,
        "laborIndex": 1.25,
        "carbonFactor": 0.8
      },
      "shanghai": {
        "name": "上海",
        "ambient": 17,
        "amp": 11,
        "costIndex": 1.12,
        "powerIndex": 1.02,
        "laborIndex": 1.2,
        "carbonFactor": 0.65
      },
      "guangzhou": {
        "name": "广州",
        "ambient": 22,
        "amp": 7,
        "costIndex": 1.08,
        "powerIndex": 1,
        "laborIndex": 1.05,
        "carbonFactor": 0.45
      },
      "sanya": {
        "name": "三亚",
        "ambient": 26,
        "amp": 3,
        "costIndex": 1.1,
        "powerIndex": 1.08,
        "laborIndex": 0.95,
        "carbonFactor": 0.45
      },
      "kunming": {
        "name": "昆明",
        "ambient": 15,
        "amp": 8,
        "costIndex": 0.95,
        "powerIndex": 0.95,
        "laborIndex": 0.85,
        "carbonFactor": 0.25
      },
      "wuhan": {
        "name": "武汉",
        "ambient": 17,
        "amp": 11,
        "costIndex": 1,
        "powerIndex": 1,
        "laborIndex": 1,
        "carbonFactor": 0.6
      },
      "chengdu": {
        "name": "成都",
        "ambient": 16,
        "amp": 7,
        "costIndex": 0.98,
        "powerIndex": 0.98,
        "laborIndex": 0.95,
        "carbonFactor": 0.35
      },
      "norway": {
        "name": "挪威(鲑)",
        "ambient": 7,
        "amp": 10,
        "costIndex": 1.6,
        "powerIndex": 0.6,
        "laborIndex": 1.8,
        "carbonFactor": 0.03
      },
      "chile": {
        "name": "智利(鲑)",
        "ambient": 12,
        "amp": 8,
        "costIndex": 1.4,
        "powerIndex": 0.8,
        "laborIndex": 1.3,
        "carbonFactor": 0.3
      },
      "vietnam": {
        "name": "越南(虾/巴沙)",
        "ambient": 27,
        "amp": 4,
        "costIndex": 0.7,
        "powerIndex": 1.1,
        "laborIndex": 0.6,
        "carbonFactor": 0.45
      },
      "scotland": {
        "name": "苏格兰(鲑)",
        "ambient": 9,
        "amp": 8,
        "costIndex": 1.7,
        "powerIndex": 0.7,
        "laborIndex": 1.9,
        "carbonFactor": 0.15
      }
    }
  },
  "speciesBio": {
    "bass": {
      "sgrMax": 3,
      "tempOpt": 27,
      "tempSigma": 7,
      "tempMin": 14,
      "stockingSize": 50
    },
    "salmon": {
      "sgrMax": 2.2,
      "tempOpt": 14,
      "tempSigma": 5,
      "tempMin": 4,
      "stockingSize": 60
    },
    "trout": {
      "sgrMax": 2.4,
      "tempOpt": 14,
      "tempSigma": 5,
      "tempMin": 4,
      "stockingSize": 80
    },
    "turbot": {
      "sgrMax": 2.2,
      "tempOpt": 18,
      "tempSigma": 6,
      "tempMin": 8,
      "stockingSize": 100
    },
    "tilapia": {
      "sgrMax": 3.4,
      "tempOpt": 29,
      "tempSigma": 7,
      "tempMin": 18,
      "stockingSize": 50
    },
    "shrimp": {
      "sgrMax": 4.5,
      "tempOpt": 29,
      "tempSigma": 6,
      "tempMin": 20,
      "stockingSize": 0.5
    },
    "catfish": {
      "sgrMax": 3.2,
      "tempOpt": 28,
      "tempSigma": 7,
      "tempMin": 18,
      "stockingSize": 50
    },
    "eel": {
      "sgrMax": 2,
      "tempOpt": 25,
      "tempSigma": 6,
      "tempMin": 15,
      "stockingSize": 30
    },
    "grouper": {
      "sgrMax": 2.6,
      "tempOpt": 28,
      "tempSigma": 6,
      "tempMin": 18,
      "stockingSize": 50
    },
    "yellowCroaker": {
      "sgrMax": 2.8,
      "tempOpt": 24,
      "tempSigma": 6,
      "tempMin": 14,
      "stockingSize": 40
    },
    "tongueSole": {
      "sgrMax": 2.2,
      "tempOpt": 21,
      "tempSigma": 5,
      "tempMin": 12,
      "stockingSize": 50
    }
  },
  "species": {
    "bass": {
      "key": "bass",
      "name": "加州鲈鱼",
      "latin": "Micropterus salmoides",
      "group": "温水肉食性",
      "salinity": "fresh",
      "waterDensity": 1000,
      "o2SatFactor": 1,
      "matlFactor": 1,
      "designTemp": 25,
      "tempRange": [
        20,
        28
      ],
      "fcr": 1.3,
      "feedPrice": 12,
      "fingerlingPrice": 0.8,
      "feedProtein": 0.45,
      "proteinDigestibility": 0.85,
      "harvestSize": 500,
      "stockingDensity": 60,
      "cyclesPerYear": 1.6,
      "doMin": 5,
      "tanMax": 1,
      "o2PerFeed": 1,
      "note": "建议三级分级养殖；对溶氧敏感，需稳定 >5 mg/L；适温 20–28℃。",
      "marketPrice": 28
    },
    "salmon": {
      "key": "salmon",
      "name": "大西洋鲑",
      "latin": "Salmo salar",
      "group": "冷水肉食性",
      "salinity": "fresh",
      "waterDensity": 1000,
      "o2SatFactor": 1,
      "matlFactor": 1,
      "designTemp": 14,
      "tempRange": [
        10,
        16
      ],
      "fcr": 1.15,
      "feedPrice": 15,
      "fingerlingPrice": 4,
      "feedProtein": 0.44,
      "proteinDigestibility": 0.9,
      "harvestSize": 4000,
      "stockingDensity": 40,
      "cyclesPerYear": 1.3,
      "doMin": 6,
      "tanMax": 0.8,
      "o2PerFeed": 0.7,
      "note": "冷水品种，需强制冷与高溶氧(>6 mg/L)；能耗主要来自制冷。",
      "marketPrice": 60
    },
    "trout": {
      "key": "trout",
      "name": "虹鳟",
      "latin": "Oncorhynchus mykiss",
      "group": "冷水肉食性",
      "salinity": "fresh",
      "waterDensity": 1000,
      "o2SatFactor": 1,
      "matlFactor": 1,
      "designTemp": 15,
      "tempRange": [
        10,
        17
      ],
      "fcr": 1.2,
      "feedPrice": 13,
      "fingerlingPrice": 1,
      "feedProtein": 0.43,
      "proteinDigestibility": 0.88,
      "harvestSize": 600,
      "stockingDensity": 40,
      "cyclesPerYear": 1.5,
      "doMin": 6,
      "tanMax": 0.9,
      "o2PerFeed": 0.8,
      "note": "冷水品种，对氨氮与低温敏感，需全年控温。",
      "marketPrice": 40
    },
    "turbot": {
      "key": "turbot",
      "name": "大菱鲆",
      "latin": "Scophthalmus maximus",
      "group": "低温肉食性(海水/半咸水)",
      "salinity": "marine",
      "waterDensity": 1020,
      "o2SatFactor": 0.85,
      "matlFactor": 1.08,
      "designTemp": 18,
      "tempRange": [
        14,
        21
      ],
      "fcr": 1.25,
      "feedPrice": 15,
      "fingerlingPrice": 2,
      "feedProtein": 0.48,
      "proteinDigestibility": 0.87,
      "harvestSize": 800,
      "stockingDensity": 45,
      "cyclesPerYear": 1.4,
      "doMin": 5.5,
      "tanMax": 0.9,
      "o2PerFeed": 0.8,
      "note": "低换水、平面池或圆角池；半咸水养殖需注意盐度稳定。",
      "marketPrice": 54
    },
    "tilapia": {
      "key": "tilapia",
      "name": "罗非鱼",
      "latin": "Oreochromis niloticus",
      "group": "温水杂食性",
      "salinity": "fresh",
      "waterDensity": 1000,
      "o2SatFactor": 1,
      "matlFactor": 1,
      "designTemp": 28,
      "tempRange": [
        25,
        32
      ],
      "fcr": 1.5,
      "feedPrice": 8,
      "fingerlingPrice": 0.3,
      "feedProtein": 0.32,
      "proteinDigestibility": 0.82,
      "harvestSize": 600,
      "stockingDensity": 80,
      "cyclesPerYear": 2,
      "doMin": 4,
      "tanMax": 1.2,
      "o2PerFeed": 0.9,
      "note": "耐低氧、耐高密度；生长快、茬次多，单位体积产量高。",
      "marketPrice": 16
    },
    "shrimp": {
      "key": "shrimp",
      "name": "南美白对虾",
      "latin": "Litopenaeus vannamei",
      "group": "温水甲壳类",
      "salinity": "marine",
      "waterDensity": 1025,
      "o2SatFactor": 0.82,
      "matlFactor": 1.1,
      "designTemp": 28,
      "tempRange": [
        26,
        31
      ],
      "fcr": 1.4,
      "feedPrice": 11,
      "fingerlingPrice": 0.02,
      "feedProtein": 0.38,
      "proteinDigestibility": 0.85,
      "harvestSize": 20,
      "stockingDensity": 25,
      "cyclesPerYear": 3,
      "doMin": 5,
      "tanMax": 1,
      "o2PerFeed": 0.9,
      "note": "甲壳类对 NO2 极敏感；需分级、强增氧与生物絮团(BFT)可选工艺。",
      "marketPrice": 46
    },
    "catfish": {
      "key": "catfish",
      "name": "斑点叉尾鮰",
      "latin": "Ictalurus punctatus",
      "group": "温水杂食性",
      "salinity": "fresh",
      "designTemp": 26,
      "tempRange": [
        22,
        30
      ],
      "fcr": 1.5,
      "feedPrice": 8,
      "fingerlingPrice": 0.4,
      "feedProtein": 0.32,
      "proteinDigestibility": 0.83,
      "harvestSize": 1000,
      "stockingDensity": 70,
      "cyclesPerYear": 1.8,
      "doMin": 4,
      "tanMax": 1,
      "o2PerFeed": 0.9,
      "waterDensity": 1000,
      "o2SatFactor": 1,
      "matlFactor": 1,
      "note": "淡水杂食性，耐低氧耐高密度，生长快；单位体积产量高。",
      "marketPrice": 16
    },
    "eel": {
      "key": "eel",
      "name": "鳗鱼",
      "latin": "Anguilla japonica",
      "group": "温水肉食性(降海洄游)",
      "salinity": "brackish",
      "designTemp": 25,
      "tempRange": [
        22,
        28
      ],
      "fcr": 1.4,
      "feedPrice": 18,
      "fingerlingPrice": 1.5,
      "feedProtein": 0.45,
      "proteinDigestibility": 0.88,
      "harvestSize": 300,
      "stockingDensity": 30,
      "cyclesPerYear": 1.2,
      "doMin": 5,
      "tanMax": 1,
      "o2PerFeed": 1,
      "waterDensity": 1010,
      "o2SatFactor": 0.95,
      "matlFactor": 1.05,
      "note": "高价值肉食性，对溶氧与水温敏感；半咸水养殖需防盐蚀。",
      "marketPrice": 70
    },
    "grouper": {
      "key": "grouper",
      "name": "石斑鱼",
      "latin": "Epinephelus coioides",
      "group": "海水肉食性",
      "salinity": "marine",
      "designTemp": 26,
      "tempRange": [
        22,
        30
      ],
      "fcr": 1.4,
      "feedPrice": 17,
      "fingerlingPrice": 3,
      "feedProtein": 0.48,
      "proteinDigestibility": 0.87,
      "harvestSize": 600,
      "stockingDensity": 35,
      "cyclesPerYear": 1.3,
      "doMin": 5.5,
      "tanMax": 0.9,
      "o2PerFeed": 1,
      "waterDensity": 1025,
      "o2SatFactor": 0.82,
      "matlFactor": 1.1,
      "note": "海水高值品种，需耐腐蚀材质(316L/HDPE)与稳定盐度；能耗以增氧与温控为主。",
      "marketPrice": 80
    },
    "yellowCroaker": {
      "key": "yellowCroaker",
      "name": "大黄鱼",
      "latin": "Larimichthys crocea",
      "group": "海水肉食性",
      "salinity": "marine",
      "designTemp": 22,
      "tempRange": [
        18,
        26
      ],
      "fcr": 1.6,
      "feedPrice": 13,
      "fingerlingPrice": 1,
      "feedProtein": 0.42,
      "proteinDigestibility": 0.85,
      "harvestSize": 400,
      "stockingDensity": 30,
      "cyclesPerYear": 1.4,
      "doMin": 5,
      "tanMax": 1,
      "o2PerFeed": 0.95,
      "waterDensity": 1025,
      "o2SatFactor": 0.82,
      "matlFactor": 1.1,
      "note": "海水品种，工厂化需控温与耐腐蚀材质。",
      "marketPrice": 40
    },
    "tongueSole": {
      "key": "tongueSole",
      "name": "半滑舌鳎",
      "latin": "Cynoglossus semilaevis",
      "group": "海水/半咸水肉食性",
      "salinity": "marine",
      "designTemp": 20,
      "tempRange": [
        16,
        24
      ],
      "fcr": 1.3,
      "feedPrice": 16,
      "fingerlingPrice": 2,
      "feedProtein": 0.46,
      "proteinDigestibility": 0.86,
      "harvestSize": 500,
      "stockingDensity": 40,
      "cyclesPerYear": 1.4,
      "doMin": 5.5,
      "tanMax": 0.9,
      "o2PerFeed": 0.9,
      "waterDensity": 1020,
      "o2SatFactor": 0.85,
      "matlFactor": 1.08,
      "note": "低温海水/半咸水品种，平面池养殖，需稳定盐度与水质。",
      "marketPrice": 60
    }
  },
  "pv": {
    "capexPerW": 3.65,
    "capacityHours": 1100,
    "exportPrice": 0.35,
    "omPerKwh": 0.06,
    "degradation": 0.005,
    "selfUseBase": 0.8,
    "batteryCapexPerWh": 0.8,
    "lifetimeYears": 25
  },
  "economics": {
    "salePrice": 22,
    "capexPerM3": {
      "tanks": 400,
      "biofilter": 320,
      "solids": 140,
      "oxygen": 320,
      "degasser": 120,
      "denit": 200,
      "uv": 90,
      "skimmer": 110,
      "ozone": 140,
      "ozoneContact": 60,
      "pumps": 170,
      "controls": 240,
      "building": 1200,
      "hvac": 340
    },
    "capexModel": {
      "refAnnualTons": 300,
      "scaleExponent": 0.72,
      "scaleCurve": [
        {
          "upto": 30,
          "exp": 0.55
        },
        {
          "upto": 300,
          "exp": 0.72
        },
        {
          "upto": 1000,
          "exp": 0.82
        },
        {
          "upto": 1000000000,
          "exp": 0.88
        }
      ],
      "scaleSmoothWidth": 15,
      "scaleFloor": 2.5,
      "scaleCeil": 0.55,
      "indirect": {
        "epcm": 0.12,
        "commissioning": 0.04,
        "contingency": 0.06,
        "other": 0.03
      },
      "indirectCap": 0.25,
      "landDefault": 0
    },
    "capexDetail": {
      "tanks": {
        "qty": "m3",
        "split": 0.95,
        "maintRate": 0.015,
        "lifeYears": 25,
        "subs": [
          [
            "池体(PP/FRP/混凝土)",
            240
          ],
          [
            "支架与基础",
            60
          ],
          [
            "进出水与集排污",
            60
          ],
          [
            "池内曝气推流",
            40
          ]
        ]
      },
      "biofilter": {
        "qty": "m3",
        "split": 0.9,
        "maintRate": 0.025,
        "lifeYears": 15,
        "subs": [
          [
            "反应器壳体",
            140
          ],
          [
            "悬浮填料(K1)",
            100
          ],
          [
            "曝气系统",
            60
          ],
          [
            "进出水与回流",
            20
          ]
        ]
      },
      "denit": {
        "qty": "m3",
        "split": 0.85,
        "maintRate": 0.025,
        "lifeYears": 20,
        "subs": [
          [
            "反应器壳体",
            100
          ],
          [
            "碳源投加系统",
            50
          ],
          [
            "搅拌/循环",
            30
          ],
          [
            "管路与监测",
            20
          ]
        ]
      },
      "solids": {
        "qty": "m3",
        "split": 0.85,
        "maintRate": 0.04,
        "lifeYears": 12,
        "subs": [
          [
            "转鼓微滤机(60µm)",
            85
          ],
          [
            "污泥浓缩脱水",
            35
          ],
          [
            "反洗水回收",
            20
          ]
        ]
      },
      "oxygen": {
        "qty": "m3",
        "split": 0.85,
        "maintRate": 0.06,
        "lifeYears": 12,
        "subs": [
          [
            "制氧/液氧站",
            190
          ],
          [
            "氧气锥(LHO)",
            90
          ],
          [
            "管路与监测",
            40
          ]
        ]
      },
      "degasser": {
        "qty": "m3",
        "split": 0.7,
        "maintRate": 0.03,
        "lifeYears": 15,
        "subs": [
          [
            "脱气填料塔体",
            70
          ],
          [
            "低压脱气风机",
            30
          ],
          [
            "管路与监测",
            20
          ]
        ]
      },
      "uv": {
        "qty": "m3",
        "split": 0.6,
        "maintRate": 0.025,
        "lifeYears": 10,
        "subs": [
          [
            "UV 杀菌机组(30mJ/cm²)",
            60
          ],
          [
            "石英套管/模块",
            20
          ],
          [
            "管路与监测",
            10
          ]
        ]
      },
      "skimmer": {
        "qty": "m3",
        "split": 0.65,
        "maintRate": 0.04,
        "lifeYears": 12,
        "subs": [
          [
            "蛋白分离器机组",
            70
          ],
          [
            "侧流循环泵",
            25
          ],
          [
            "射流曝气/空气泵",
            15
          ]
        ]
      },
      "ozone": {
        "qty": "m3",
        "split": 0.6,
        "maintRate": 0.05,
        "lifeYears": 12,
        "subs": [
          [
            "臭氧发生器",
            80
          ],
          [
            "氧气源(制氧/PSA)",
            35
          ],
          [
            "尾气破坏单元",
            25
          ]
        ]
      },
      "ozoneContact": {
        "qty": "m3",
        "split": 0.6,
        "maintRate": 0.03,
        "lifeYears": 15,
        "subs": [
          [
            "独立接触柱壳体",
            35
          ],
          [
            "尾气破坏单元(接触式)",
            25
          ]
        ]
      },
      "pumps": {
        "qty": "m3",
        "split": 0.9,
        "maintRate": 0.07,
        "lifeYears": 12,
        "subs": [
          [
            "循环水泵(一用一备)",
            105
          ],
          [
            "管路阀门管件",
            45
          ],
          [
            "流量计控制阀",
            20
          ]
        ]
      },
      "controls": {
        "qty": "m3",
        "split": 0.4,
        "maintRate": 0.02,
        "lifeYears": 12,
        "subs": [
          [
            "PLC/SCADA 自控",
            90
          ],
          [
            "在线监测(DO/pH/TAN)",
            110
          ],
          [
            "电气布线",
            40
          ]
        ]
      },
      "building": {
        "qty": "m2",
        "split": 0.97,
        "maintRate": 0.01,
        "lifeYears": 30,
        "subs": [
          [
            "主体结构",
            600
          ],
          [
            "围护保温屋顶",
            390
          ],
          [
            "地坪防渗排水",
            150
          ],
          [
            "照明消防辅助",
            60
          ]
        ]
      },
      "hvac": {
        "qty": "m3",
        "split": 0.75,
        "maintRate": 0.05,
        "lifeYears": 15,
        "subs": [
          [
            "热泵/制冷机组",
            210
          ],
          [
            "换热器管路",
            80
          ],
          [
            "保温与控制",
            50
          ]
        ]
      }
    },
    "opex": {
      "feedPrice": 11,
      "fingerlingPrice": 0.8,
      "waterPrice": 5,
      "laborPerYear": 130000,
      "laborBase": 2,
      "laborPerTon": 0.35,
      "maintenanceRate": 0.04,
      "elecPrice": 0.72,
      "solidsDisposalPrice": 0.35,
      "nahco3Price": 1.6
    },
    "finance": {
      "discountRate": 0.08,
      "loanRatio": 0.6,
      "loanRate": 0.045,
      "loanYears": 10,
      "depYears": 15
    },
    "priceMeta": {
      "asOf": "2026",
      "confidence": "中"
    }
  }
};
