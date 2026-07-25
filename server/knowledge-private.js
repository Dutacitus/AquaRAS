/*
 * AquaRAS 私有知识（商业机密）—— 仅服务端持有，绝不进入前端静态包或公开接口。
 * 通过带管理员 token 的 /api/knowledge/full 与 /api/knowledge/export 下发。
 */
module.exports = {
  "meta": {
    "note": "v1.18.3 (2026 水质与造价标注优化)：⑦臭氧–泡沫分离协同因子——臭氧注入 skimmer 作接触器，将疏水 DOC 氧化为更易被泡沫捕获的形态，使泡沫分离有效 DOC 去除≈docRemoval×ζ（新增 equipment.ozone.docSynergy，默认 1.15、封顶 0.99），串联 DOC 去除率高于二者独立叠加（默认双配 DOC 串联去除率由 78.8%→81.4%）。⑨CAPEX 基准时效性——economics 新增 capexCalibration 元数据，逐项标注单价数据来源/校准年份/置信度，BOM 投资表同步展示来源列，便于审计溯源。计算模型与用户可自定义数据不动。v1.18.2 (2026 计算模型精准度优化)：①规模经济分段曲线档位边界平滑(新增 capexModel.scaleSmoothWidth，消除 30/300/1000t 处投资跳变)；②等效管长随养殖水体立方根缩放(新增 pump.pipeLengthRefVol，大规环路更长、小规更短，泵功更准)；③FCR–密度耦合由线性改为饱和型(新增 process.fcrDensitySat，高密度边际 FCR 升高递减、不再无界暴涨)。计算模型与用户可自定义数据不动。v1.13.9 (2026 尾水深度处理)：在 v1.13.8 尾水合规判定基础上，新增可选“末端尾水处理单元”（knowledge.tailwaterTreatment 工艺库：无/反硝化生物滤柱/硫自养反硝化/人工湿地/鱼菜共生植物渠/多级生物净化组合），按文献去除率（TN 0.38–0.95、TP 0.20–0.70、COD 0.30–0.75、SS 0.50–0.90）对排放口浓度二次削减后对照 DB44/2462-2024 判定；并将该单元投资(capexPerM3d×处理流量)与运行成本(opexPerM3×处理量)并入经济账（capexTotal/opexTotal + 明细 capexTailwater/opexTailwater），让“达标成本”可见。去除率与经济参数均取自 16 篇中文核心文献实测（见 D:\\lit_extract\\），为工程估算值可校准；仅模型系数与计算逻辑，用户可自定义数据不动。v1.13.8 (2026 尾水排放合规 DB44/2462-2024)：新增尾水排放五项污染物（pH/悬浮物/COD(Mn)/总氮TN/总磷TP）稳态估算与达标判定，对照广东省《水产养殖尾水排放标准》DB44/2462-2024 淡水/海水 × 一级/二级 限值做合规判定，堵住“生物水质全达标但尾水违规”的假合规漏洞；新增磷/有机负荷一阶去除+补水稀释估算（process.feedPContent/pExcreteFrac/pCapture/codPerFeed/codCapture 五个模型系数 + standards.db44_2462_2024 标准），仅模型系数与计算逻辑，用户可自定义数据不动。v1.13.7 (2026 BUG 修复)：仅修复分析层电价区域修正引用错误——sensitivity() 与 sobol()/buildUserSensParams() 误用 K.regions（undefined），应为 K.climate.regions；指定地区(regPower≠1)时“电价”敏感度/Sobol 分析未含区域电价修正。计算模型与用户可自定义数据不动。v1.13.6 Sobol 主因子分析扩展覆盖用户可自定义输入（仅分析方法增强，不改任何计算模型/用户可自定义数据）：此前 sobol() 仅抽样 K.uncertainty.params 的 8 个模型系数，把饲料系数 FCR/生产水价/电价/鱼价等用户经营假设整体排除，导致成本与利润的主导因子（如 FCR、水单价）不体现。现 sobol() 在模型系数之外，追加一组“用户可自定义输入”敏感度参数：围绕当前生效值 ±band 做三角采样（FCR ±20%、生产水价 ±40%、电价 ±30%、鱼价 ±20%），与模型系数统一参与 Saltelli 方差分解；结果按 group 字段区分 model/user，UI 主导因子条形图加“模型系数/用户输入”徽标。蒙特卡洛(monteCarlo)仍只扰模型系数，保持“不改用户数据”原则；本地敏感度 sensitivity() 同步补入生产水价/电价两项驱动（此前仅含 FCR）。实测（鲈@100/salePrice45，N=1024）：单位成本主导由补水率 + 饲料系数 FCR + 生产水价/电价共同构成，年毛利主导含预估鱼价 + FCR + 水价，经济类指标 ΣST 闭合≈1；总投资/比能耗仍对全部系数≈0（属真实物理，FCR/水价不影响设备选型与能耗）。计算数值与 golden 鲈@100/salePrice45 零回退。v1.13.5 水质物理保真（P2-1 鱼代谢 Q10 + P2-2 CO₂–O₂ 交互，仅模型/知识库，用户可自定义数据不动）：①P2-1 鱼代谢 Q10——o2PerFeed 由固定值改为随 designTemp 做 Q10 修正：o2PerFeedEff = o2PerFeed × q10O2^((designTemp−o2RefTemp)/10)（默认 q10O2=2.0、o2RefTemp=25℃），高温氧耗↑/低温↓；供氧定容(o2Supply)、制氧能耗(oxyPower)、鱼呼吸 CO₂(co2Prod，经 o2Daily 自动传导)随之温度修正，极端温度下设备选型与能耗更准（designTemp=25℃ 时因子=1，golden 鲈@25℃ 零回退）。②P2-2 CO₂–O₂ 交互——高 CO₂ 经 Bohr 效应降低鱼类氧利用率，定义有效溶氧 effectiveDo = o2Achieved×(1−penalty)，penalty = min(0.5, max(0, cCo2−co2DoeThresh)/co2DoeScale)（默认阈值 16、尺度 40 mg/L，封顶 50%）；DO 可行性判定改按 effectiveDo 而非仪表读数，高碳酸血场景（如低补水/弱脱气致 cCo2>16）会如实放大缺氧告警（golden 鲈@25℃ cCo2=13.8<16→penalty=0，零回退）。两项耦合后：高温→鱼代谢↑→CO₂↑→有效 DO 折减，物理链条自洽。v1.13.4 Sobol 主因子分析（仅新增分析方法，不改任何计算模型/用户可自定义数据）：引擎新增 sobol(inputs,{N})——Saltelli(2010) 方差分解，对 K.uncertainty.params 的 8 个模型系数做 N×(k+2) 次三角分布抽样（内置 mulberry32 可复现 PRNG，固定 seed 结果可复核），输出每指标一阶 S_i 与总阶 ST_i（ST−S=交互贡献），ΣST≈1 表示分解闭合。UI「参数不确定性」面板新增 Sobol 主因子按钮，按 ST 降序渲染各指标主导因子条形图（含交互标记与 ΣST 闭合性检查）。实测（鲈@100/salePrice45，N=1024，≈0.4s）：单位成本/毛利/回收期主导=补水率(ST≈0.94，强交互)、比能耗主导=热泵COP+补水率+蒸发率、总投资对 8 个工艺系数方差≈0 判为不敏感（已验证非 bug）。仅扰动模型系数，用户可自定义输入不参与抽样。v1.13.3 NH₃ 毒性阈值温度分级 + annualTons 缺省兜底（仅模型/知识库，用户可自定义数据不动）：①NH₃ 阈值改温度修正——固定 0.02/0.01 mg/L(N) 改为 criterion(T)=ref×10^(nh3TempCoef·(25−T))，暖水更毒→限值更严、冷水更宽松（EPA 1989 温度依赖，25℃ 回到原基准，golden 鲈@25℃ 零回退）；pH 经离解率 fNH₃ 自然体现，高 pH 仍易越限、物理正确。实测：salmon@pH7.85 由 WARN→OK、trout 由 WARN→OK（冷水氨毒性本就更低）；鲈@25℃ 仍 0.0082 OK 不变。②annualTons 缺省兜底——compute 未传 annualTons 时 annual=NaN 向下游级联致 cTAN/cNH₃=NaN，因 NaN 比较恒 false 误显 OK（非 fail）；现 annualTons 缺省按 100t，杜绝 NaN 隐患。v1.13.2 碱度投加量单位 BUG 修复（仅公式口径，用户可自定义数据不动）：doseM 两项量纲与 consM(mg/天) 不一致——srcM=makeupFlow×bgAlk 与 makeupFlow×alkTarget 为 g/天口径缺 ×1000，致 NaHCO₃ 投加建议恒偏高约 4–6%（默认 0.75% 补水 63.8→61.0 kg/天）；修复为 ×1000 自洽。另修海水 HVAC 补水质量流量误用淡水密度（×1000→×swDensity≈1025），海水补水热负荷此前偏低约 2.5%。TAN/NO₂/NO₃ 进水项经复核为 g/天口径、与 tanDaily×1000 自洽无需改。审计 harness 全绿，golden 鲈@45 零回退。v1.13.1 全引擎兜底审计修正（仅模型系数/公式口径，用户可自定义数据不动）：①碱度稳态 1000× 单位 BUG 修复——alkNat=bgAlk−consM/makeupFlow 中 consM/makeupFlow 量纲为 mg/m³、与 bgAlk(mg/L) 相减漏了 ÷1000，导致 alkNat 恒为极大负值、低换水/高换水设计均被静默判为需全额投加 NaHCO₃（与补水率脱钩）；修正为 ÷1000 后，高换水(如 25–50%)时源水碱度可满足需求→不再投加，cAlkSys 如实反映自然碱度。②碱度状态判定补全——此前仅按 NaHCO₃ 投加负担分级，与展示的碱度下限 alkMin 脱节；现同时判 cAlkSys<alkMin→fail、自然碱度低于操作目标 alkTarget→warn，使「碱度」检查的物理语义自洽。③溶氧余量(DO 闭环)改用实际注入水体的氧量 o2Delivered=o2Supply×传质效率 计算余量/可达 DO，消除原按铭牌产能口径导致的约 1/传质效率(≈5%) 余量高估。审计 harness 5000 组随机模糊 + 边界(补水0/0.5、极端温度、极小5t/超大2000t、全地区)全绿，golden 鲈@45 毛利率27.2%/回收10.58y/能耗5.6 与 v1.13.0 零回退。v1.13.0 电力碳足迹 + 水足迹真水平衡（仅模型系数/知识库，用户可自定义数据不动）：①电力碳足迹——地区库 regions[] 增加 carbonFactor(kgCO₂e/kWh，电网排放因子)，无地区时回退 defaults.carbonFactor(0.58，中国全国电网均值2023)；年碳排放 = 年电耗 × carbonFactor → kgCO₂e/年 与 kgCO₂e/kg鱼。新增挪威/智利/越南/苏格兰等海外产区(含各自碳因子与气候/造价/人工指数)。②水足迹真水平衡——原 bleed=makeup−evap 仅估两项，现补全「污泥脱水饼带水 + 微滤机反冲洗 + 脱气塔雾损」三类损耗（process.sludgeCakeWc/drumBackwashFrac/degasserMistFrac），真水平衡：年取水 = 蒸发 + 排污(bleed) + 污泥带水 + 雾损，并校验补水率是否覆盖全部损耗(否则水位下降告警)；新增「消耗性水足迹」= 蒸发 + 污泥带水 + 雾损（不返还环境，区别于可排放的 bleed）。v1.12.0 碳酸盐体系闭环（碱度守恒 + pH 子模型）+ NH₃ 非离子氨毒性（仅模型系数，用户可自定义数据不动）：①碱度守恒——硝化每氧化 1g N 耗 7.14g 碱度(以CaCO₃计，化学计量 2 mol 碱度/mol N)，碱度仅随补水交换流失、不被滤池/脱气去除；稳态碱度 = 源水碱度 − 硝化净耗/补水量，若低于目标操作碱度(120 mg/L)则反算需投加 NaHCO₃ 量(kg/天、kg/kg鱼)。②pH 子模型——由稳态 CO₂(aq) 与总碱度经碳酸一级/二级解离平衡(温度/盐度修正 pK1/pK2)数值求解 [H⁺] 得 pH；低 pH→硝化速率折减(第二限速步，pH<7 按指数衰减至 0.2)→稳态 TAN 反弹，低排放设计可行性判定自此真实。③NH₃ 非离子氨——由 pH 与温度经 pKa(随温降)求离解比例，NH₃ = TAN × 离解率；毒性判据 急性 0.02 / 慢性 0.01 mg/L(N)。v1.11.1 蒙特卡洛硝化速率口径修正（仅模型系数，用户可自定义数据不动）：蒙特卡洛不确定性参数原指向「设计定容速率 equipment.biofilter.rate」，但稳态 TAN 平衡用的是「实际运行速率 equipment.biofilter.rateNitritation」。基准二者同为 0.60 时会在公式里抵消，但 MC 扰动设计速率会反物理地使生物滤池被「低估尺寸」→ TAN 反而升高→出现 29–31% 的伪失败(fail)。修正：MC 参数改指 rateNitritation（实际运行速率），定容速率保持设计值 0.60 不变；现低实现速率→TAN 升高（真实失败尾）、高实现速率→TAN 降低，方向正确，基准算例数值不变。v1.11.0 CO₂ 质量守恒补全（仅模型系数，用户可自定义数据不动）：补入此前漏算的「开放水面天然挥发（被动空气吹脱）」通道——等效去除流量=co2Kla(3.0/天)×养殖池体积，与大气平衡值 co2Star=0.5 mg/L；稳态 CO₂ 由脱气塔(主动)+天然挥发(被动)+补水稀释三项共同决定，量纲 g/天÷(m³/天)=mg/L 自洽。此前 v1.10.0 仅靠下调鱼呼吸系数压浓度，现机制补全后判定更可信。v1.10.0 水质子模型校准（仅模型系数，用户可自定义数据不动）：①鱼呼吸氧耗标定 o2FishCal=0.45（真实鱼代谢仅约 0.35–0.5 kg O₂/kg 饲料，原默认 0.9–1.0 偏高致 CO₂/供氧/能耗系统性高估）；②CO₂ 预算补全硝化产 CO₂（碱度消耗→CO₂，RAS 主要 CO₂ 源，co2PerN≈4.57 kg CO₂/kg TAN，原模型漏算）；默认方案稳态 CO₂ 由 27.7(鲈)/38.4(罗非·鲶) 降至 ≤15(鲈)/≤30(罗非·鲶) mg/L。③TSS 固废产率 0.28→0.22、微滤机去除率 0.90→0.93（高效微滤机，文献可达 0.93–0.95），高密度品种 TSS 由 13→≤10 mg/L。④收敛 CAPEX 输出：移除 economics 中未含规模因子的 capexTanks/capexBio/.../capexBuilding 等 10 个冗余字段（与 capexBreakdown 口径不一致，UI 未使用，属误读源），仅保留 capexDirect(已含规模/地区缩放) 与 capexTotal。v1.9.0 投资估算造价校准（基于 2025–2026 真实工程招标与造价标准）：车间土建 900→1200 元/m²（参照 2025 钢结构厂房造价指南与宣威/潍坊 RAS 项目真实造价，真实区间 1200–1500 取低中值）；补充真实锚点（宣威 2025、广西/剑阁 2025–2026 设备中标价、工程建设其他费用定额、建标[2013]44号）；间接费维持直接费 25% 上限。v1.8.0 精细化升级：①参数不确定性区间 + 蒙特卡洛（P10/P50/P90）抽样；②品种库扩展（海/淡/半咸水，salinity 驱动材质溢价·溶氧饱和度·水体密度）；③CAPEX 分段规模经济曲线；④维护费按设备寿命分项；⑤能耗分项展示（泵/氧/脱气/温控/杂项）。v1.1.0 校准经济性/价格；v1.2.0 校准工程模型系数；v1.3.0 重构投资估算(规模经济+间接费+UV/脱气塔)；v1.4.0 HVAC 气候化(地区气温驱动温控)；v1.4.1 间接费收紧至直接费25%上限、取消营运资金。v1.5.0 模型增强：MBBR 硝化速率加温度修正(theta)+TAN 改用饲料蛋白；HVAC 补蒸发潜热/寻优纳入温度与地区/人工随规模/反硝化NO3模型/价格加asOf与置信度；CAPEX 固定+可变分段/地区成本·电价·人工指数/引擎魔法数收回知识库/设备能耗加工况修正/知识库模块化与引用绑定。v1.6.0 质量守恒闭环：两段硝化(AOB/NOB 分速率)+溶氧闭环(供氧覆盖鱼代谢与硝化)+CO₂脱气闭环+补水背景浓度；反硝化反应器贯通 PFD/PID/BOM/计算书。v1.7.0 模型保真度：季节性双工况 HVAC(bin method 月均温积分，年能耗更准)/水足迹闭合(蒸发+排污，校验补水覆盖蒸发)/固废处置能耗与成本(脱水外运比能耗+处置单价)/泵达西–魏斯巴赫阻力法(扬程=提升+沿程+局部)/饲料蛋白消化率联动排泄(消化率↑→可排泄氮比例↓)。用户可自定义数据(售价/密度/FCR/气温取值/土地费/单价覆盖项)不在此轮优化。",
    "sourceMap": {
      "MBBR 硝化速率": "d'Aquin & Timmons (2012); 渔业机械仪器研究所 (2025)",
      "HVAC 能耗(含蒸发潜热)": "Aydın et al. (2026); 工程经验",
      "CAPEX 规模经济": "BC Government (2022); Aquaculture Engineer (2026)",
      "价格/单价": "广东省水产协会 (2025); 国网 (2025); 鱼粉 Mysteel (2025)",
      "反硝化/NO3": "Timmons & Ebeling (2010); 工程经验",
      "碳酸盐/pH/NH3": "Timmons & Ebeling (2010); Emerson (1975) 碳酸盐平衡; US EPA (1989) 氨毒性准则",
      "电力碳足迹/电网因子": "IEA (2023) CO₂ Emissions from Fuel Combustion; 生态环境部 2023 电力排放因子",
      "水足迹/污泥含水率": "Timmons & Ebeling (2010); 工程经验(板框脱水 75–85% 含水)"
    }
  },
  "references": [
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
    "Kingto / Laswim / YUTANK. (2025). 脱气塔规格（CO₂ 去除 80–90%/pass；低压风机 300–700 Pa）。",
    "Aggregator / Aquafarmer. (2025). RAS 对比（水耗 0.05–0.5 m³/kg；密度 40–120 kg/m³；面积 30–50 m²/t·年）。",
    "Wang Y. et al. (2019). Effects of stocking density on Atlantic salmon in RAS（中国实测上限 ~30 kg/m³；福利建议 60–80）。",
    "《工厂化循环水养殖工程设计规范》(行业经验值)",
    "广东省水产流通与加工协会. (2025). 广东省水产品批发市场价格分析简报：罗非鱼 ~15.8、南美白对虾统货 44–50、加州鲈冰鲜 28–32 元/kg。",
    "厦门市海洋发展局. (2025-12-11). 主要水产品批发价格：大菱鲆 52、南美白对虾(活鲜)60、罗非鱼 15 元/kg。",
    "海鲜指南/三文鱼周报. (2025-08). 中国冰鲜三文鱼批发：挪威/苏格兰/智利 68–98 元/kg。",
    "Mysteel/卓创资讯. (2025). 进口超级蒸汽鱼粉 13000–14800 元/吨；9 月水产饲料普涨。",
    "顺时环保/行业综述. (2025). 中国工厂化循环水装备市场：中端 3000–5000 元/m³，进口高端 5000–8000 元/m³。",
    "国网陕西/深圳供电局. (2025). 工商业代理购电到户均价 0.63–0.77 元/kWh。",
    "Government of British Columbia. (2022). RAS capital costs CAD $7–40 per kg of planned annual production capacity（规模经济区间，反映小规高、大规低）。",
    "Aquaculture Engineer. (2026). RAS Fish Farm Cost: CAPEX, OPEX & Investment Model（建筑 $900/m²×10 m²/吨·年；技术 CAPEX(设备+物流+安装+调试) $6.5k–17k/吨按回收期；土地 $100/m²×20 m²/吨）。",
    "FinancialModelsLab. (2026). Recirculating Aquaculture System Startup Costs（隐藏成本：许可/设计/水质检测/培训/保险/生物安全/营运资金；设备+安装+调试分列）。",
    "环江毛南族自治县发改局. (2023). 洛阳镇江妙陆基循环水项目可研批复：总投资 280 万 = 工程费 56% + 工程建设其他费 20% + 预备费 2.3% + 流动资金 22%。",
    "Wolize. (2025). RAS vs Flowing Systems 成本：工业化 RAS 建设成本 $250–$400/m³（3000 m³ 级）， productivity 80–120 kg/m³。",
    "宣威市虹桥街道马房社区智慧渔业项目. (2025). 招标计划：钢结构保温车间 5200 m² 概算 300 万（约 577 元/m² 含覆盖与附属）；陆基工厂化 RAS 设备 2 套(1000m³) 概算 200 万（设备约 2000 元/m³：PP 养殖桶/微滤/蛋白分离/生化脱气/UV/臭氧/生物滤池/填料/风机/增氧/空气能热泵/自动化）。",
    "潍坊滨海 RAS 车间. (2024). 南美对虾 RAS：单立方水体建设成本 ¥1,280，单位水体年产量 18.6 kg/m³，回收期约 3.2 年。",
    "广西/四川政府采购网. (2025–2026). RAS 设备中标价：PP 养殖池 φ4×2m ≈1.0 万元/个；微滤机 2.5–4.0 万元/台；MBBR 生物滤池 2.1 万元/台；脱气塔 2.9–3.7 万元/套；水源热泵 7–9 万元/台；UV 杀菌 0.7–1.1 万元/台；循环水泵 0.9–1.2 万元/台；罗茨风机 1.5–3.0 万元/套。",
    "钢结构厂房造价指南. (2025). 轻钢门式钢架 800–1300 元/m²、钢框架 1200–2000 元/m²、保温夹芯板 120–200 元/m²；RAS 养殖车间需防腐/保温/防渗，单方造价取中值 1200–1500 元/m²。",
    "《建筑安装工程费用项目组成》(建标[2013]44号) 住房城乡建设部/财政部. 费用按人工/材料/施工机具/企业管理费/利润/规费/税金划分；间接费与工程建设其他费用据此归并。",
    "广西壮族自治区工程建设其他费用定额(2018). 设计费/监理费/建设单位管理费/预备费等费率：工程建设其他费用通常占工程费用 15–25%，预备费 5–6%，与本项目间接费 25% 上限一致。"
  ],
  "capexCalibration": {
    "tanks": {
      "year": 2025,
      "confidence": "中",
      "source": "PP/FRP 池体厂商报价 + 环江/宣威项目土建复核"
    },
    "biofilter": {
      "year": 2025,
      "confidence": "中",
      "source": "Kaldnes K1 填料 + MBBR 反应器集成商报价"
    },
    "solids": {
      "year": 2025,
      "confidence": "中",
      "source": "转鼓微滤机 + 污泥浓缩脱水设备厂商报价"
    },
    "oxygen": {
      "year": 2025,
      "confidence": "中",
      "source": "制氧机/纯氧锥集成商报价（氧耗按 fish 代谢标定）"
    },
    "degasser": {
      "year": 2025,
      "confidence": "中",
      "source": "低噪 CO₂ 脱气塔厂商报价"
    },
    "denit": {
      "year": 2025,
      "confidence": "中",
      "source": "侧流反硝化反应器工程预算"
    },
    "uv": {
      "year": 2025,
      "confidence": "中",
      "source": "紫外消毒设备厂商报价（按流量选型）"
    },
    "skimmer": {
      "year": 2025,
      "confidence": "中",
      "source": "蛋白分离器（泡沫分离）厂商报价"
    },
    "ozone": {
      "year": 2025,
      "confidence": "中",
      "source": "臭氧发生器厂商报价（按 dosage.rate 选型）"
    },
    "ozoneContact": {
      "year": 2025,
      "confidence": "中",
      "source": "臭氧接触柱加工/安装报价"
    },
    "pumps": {
      "year": 2025,
      "confidence": "中",
      "source": "循环水泵 + 管路（达西–魏斯巴赫扬程法）厂商报价"
    },
    "controls": {
      "year": 2025,
      "confidence": "中",
      "source": "PLC/传感/SCADA 自控集成报价"
    },
    "building": {
      "year": 2025,
      "confidence": "中",
      "source": "建标[2013]44号 + 2025 钢结构厂房造价指南（宣威/潍坊 RAS 真实 1200–1500 元/m² 取低中值）"
    },
    "hvac": {
      "year": 2025,
      "confidence": "中",
      "source": "热泵机组厂商报价（COP≈4，气候区修正）"
    }
  }
};
