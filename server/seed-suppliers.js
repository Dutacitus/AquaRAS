/*
 * AquaRAS 供应商库种子数据
 * 用法: node server/seed-suppliers.js
 */
const db = require("./db");

// 先确保表存在
const { getDb } = db;
const d = getDb();
d.exec(`
  CREATE TABLE IF NOT EXISTS suppliers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    category    TEXT    NOT NULL,
    name        TEXT    NOT NULL,
    brand       TEXT,
    product     TEXT,
    contact     TEXT,
    region      TEXT,
    website     TEXT,
    tags        TEXT    NOT NULL DEFAULT '[]',
    description TEXT,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_suppliers_category ON suppliers(category);
  CREATE INDEX IF NOT EXISTS idx_suppliers_sort ON suppliers(sort_order);
`);

// 清空已有数据
d.prepare("DELETE FROM suppliers").run();

const records = [
  // ==================== 设备供应商 ====================
  { category:"equipment", name:"青岛海兴智能装备有限公司", brand:"海兴", product:"循环水养殖系统成套设备、微滤机、蛋白质分离器",
    contact:"0532-8886xxxx", region:"山东青岛", website:"https://www.haixingqd.com",
    tags:["系统集成","微滤机","蛋白分离器","国产"], description:"国内RAS设备龙头企业，提供从设计到安装的全套服务", sort_order:1 },
  { category:"equipment", name:"丹麦 AKVA group", brand:"AKVA", product:"陆基循环水系统、网箱养殖设备、投喂系统",
    contact:"+45 99 30 30 30", region:"丹麦 / 全球", website:"https://www.akvagroup.com",
    tags:["系统集成","投喂系统","进口","高端"], description:"全球水产养殖设备领先品牌，技术成熟", sort_order:2 },
  { category:"equipment", name:"挪威 Billund Aquaculture", brand:"Billund", product:"RAS系统设计、生物过滤、脱气装置",
    contact:"+47 51 53 10 00", region:"挪威 / 全球", website:"https://www.billund-aquaculture.com",
    tags:["系统集成","生物过滤","脱气","进口","高端"], description:"挪威知名RAS设计与设备供应商", sort_order:3 },
  { category:"equipment", name:"广州蓝灵水处理设备有限公司", brand:"蓝灵", product:"微滤机、紫外线杀菌器、臭氧发生器、蛋白质分离器",
    contact:"020-8203xxxx", region:"广东广州", website:"https://www.lanlingwater.com",
    tags:["水处理","微滤机","紫外线","臭氧","国产"], description:"专注水产养殖水处理设备制造", sort_order:4 },
  { category:"equipment", name:"台州富立达泵业有限公司", brand:"富立达", product:"循环水泵、增氧泵、排污泵",
    contact:"0576-8633xxxx", region:"浙江台州", website:"",
    tags:["水泵","增氧泵","国产"], description:"专业水产养殖用泵制造商，性价比高", sort_order:5 },
  { category:"equipment", name:"德国 Grundfos", brand:"格兰富", product:"高效离心泵、潜水泵、计量泵",
    contact:"+49 89450030", region:"德国 / 全球", website:"https://www.grundfos.com",
    tags:["水泵","进口","高端","节能"], description:"全球泵业领导品牌，能效高寿命长", sort_order:6 },
  { category:"equipment", name:"上海申江压力容器有限公司", brand:"申江", product:"生物过滤器、压力容器、储气罐",
    contact:"021-5745xxxx", region:"上海", website:"",
    tags:["生物过滤","压力容器","国产"], description:"生物滤器及压力容器专业制造商", sort_order:7 },
  { category:"equipment", name:"杭州路弘科技有限公司", brand:"路弘", product:"微纳米曝气设备、溶氧控制系统",
    contact:"0571-8816xxxx", region:"浙江杭州", website:"",
    tags:["曝气","溶氧","国产","节能"], description:"微纳米曝气技术在RAS中节能效果显著", sort_order:8 },
  { category:"equipment", name:"挪威 Steinsvik", brand:"Steinsvik", product:"水下照明、水下摄像头、自动投喂系统",
    contact:"+47 52 70 52 00", region:"挪威 / 全球", website:"https://www.steinsvik.no",
    tags:["水下设备","投喂系统","进口"], description:"水产养殖智能辅助设备专业品牌", sort_order:9 },
  { category:"equipment", name:"大连汇新钛设备开发有限公司", brand:"汇新", product:"钛换热器、温控系统、海水养殖设备",
    contact:"0411-8629xxxx", region:"辽宁大连", website:"",
    tags:["温控","换热器","海水养殖","钛材","国产"], description:"专注海水养殖钛合金设备制造", sort_order:10 },

  // ==================== 材料供应商 ====================
  { category:"material", name:"河北华创管道有限公司", brand:"华创", product:"PVC-U给水管、PPR管、PE管及管件",
    contact:"0317-309xxxx", region:"河北沧州", website:"",
    tags:["管道","PVC","PPR","PE","国产"], description:"大口径管道专业制造商,渔业工程常用", sort_order:11 },
  { category:"material", name:"浙江中财管道科技股份有限公司", brand:"中财", product:"PVC-U/PPR/PE/HDPE管材管件",
    contact:"0575-8701xxxx", region:"浙江绍兴", website:"https://www.zhongcai.com",
    tags:["管道","PVC","PPR","PE","HDPE","国产","知名品牌"], description:"国内管道行业知名品牌，产品线齐全", sort_order:12 },
  { category:"material", name:"德国 GF Piping Systems", brand:"Georg Fischer", product:"工业级PVC-U/PP/PVDF管道阀门",
    contact:"+41 52 631 11 11", region:"瑞士 / 全球", website:"https://www.gfps.com",
    tags:["管道","阀门","PVDF","进口","高端"], description:"高端工业级管道系统，耐腐蚀性能优异", sort_order:13 },
  { category:"material", name:"苏州巨联环保有限公司", brand:"巨联", product:"养殖池衬垫（HDPE土工膜）、防水材料",
    contact:"0512-6579xxxx", region:"江苏苏州", website:"",
    tags:["衬垫","土工膜","HDPE","防水","国产"], description:"养殖池防渗衬垫专业供应商", sort_order:14 },
  { category:"material", name:"天津友发钢管集团", brand:"友发", product:"镀锌钢管、不锈钢管、方矩管",
    contact:"022-6858xxxx", region:"天津", website:"https://www.youfasteelpipe.com",
    tags:["钢管","镀锌","不锈钢","结构","国产","知名品牌"], description:"钢结构及管路支撑系统材料供应商", sort_order:15 },

  // ==================== 施工供应商 ====================
  { category:"construction", name:"中国水产科学研究院渔业工程研究所", brand:"水科院", product:"渔港渔场规划设计、养殖设施施工",
    contact:"010-6867xxxx", region:"北京", website:"",
    tags:["设计施工","科研院所","规划设计"], description:"国家级水产科研单位，承担大型渔业工程设计", sort_order:16 },
  { category:"construction", name:"中交上海航道局有限公司", brand:"中交上航局", product:"土建施工、水域疏浚、管网铺设",
    contact:"021-6321xxxx", region:"上海", website:"",
    tags:["土建","疏浚","央企","大型工程"], description:"央企背景，承接大型养殖场土建及配套工程", sort_order:17 },
  { category:"construction", name:"江苏三角洲水产科技有限公司", brand:"三角洲", product:"工厂化循环水养殖场设计与施工总包",
    contact:"0513-8391xxxx", region:"江苏南通", website:"",
    tags:["设计施工","总包","工厂化养殖","国产"], description:"专注工厂化水产养殖项目EPC总承包", sort_order:18 },
  { category:"construction", name:"广东恒兴集团有限公司", brand:"恒兴", product:"水产养殖园区建设施工、设备安装调试",
    contact:"0759-3388xxxx", region:"广东湛江", website:"https://www.hx888.com",
    tags:["施工安装","园区建设","国产","知名品牌"], description:"大型水产集团，具备养殖园区全链条建设能力", sort_order:19 },

  // ==================== 设计供应商 ====================
  { category:"design", name:"丹麦丹麦科技大学水产养殖研究中心", brand:"DTU Aqua", product:"RAS系统工艺设计、养殖方案咨询、水质模型",
    contact:"+45 35 88 33 44", region:"丹麦 / 全球", website:"https://www.aqua.dtu.dk",
    tags:["工艺设计","科研","水质模型","国际顶尖"], description:"全球顶级水产养殖科研机构，RAS领域权威", sort_order:20 },
  { category:"design", name:"挪威 Nofima", brand:"Nofima", product:"水产养殖系统设计、饲料配方研发、养殖技术咨询",
    contact:"+47 77 62 90 00", region:"挪威 / 全球", website:"https://nofima.no",
    tags:["系统设计","饲料","科研","国际顶尖"], description:"挪威食品与水产研究所，全球水产科研领军者", sort_order:21 },
  { category:"design", name:"中国水产科学研究院渔业机械仪器研究所", brand:"渔机所", product:"循环水养殖工程设计、渔业装备研发",
    contact:"021-6597xxxx", region:"上海", website:"https://www.fmiri.ac.cn",
    tags:["工程设计","装备研发","科研院所","国产"], description:"国内渔业工程与装备设计的权威机构", sort_order:22 },
  { category:"design", name:"青岛海科水产技术有限公司", brand:"海科", product:"工厂化循环水养殖工艺设计、技术培训",
    contact:"0532-8689xxxx", region:"山东青岛", website:"",
    tags:["工艺设计","技术培训","国产"], description:"提供专业RAS工艺设计方案和技术培训服务", sort_order:23 },

  // ==================== 耗材供应商 ====================
  { category:"consumable", name:"广东海大集团股份有限公司", brand:"海大", product:"水产配合饲料、动保产品、苗种",
    contact:"020-3938xxxx", region:"广东广州", website:"https://www.haid.com.cn",
    tags:["饲料","动保","苗种","国产","知名品牌"], description:"国内水产饲料龙头企业，产品覆盖全品类", sort_order:24 },
  { category:"consumable", name:"通威股份有限公司", brand:"通威", product:"水产饲料、水产预混料、动保产品",
    contact:"028-8518xxxx", region:"四川成都", website:"https://www.tongwei.com",
    tags:["饲料","动保","预混料","国产","知名品牌"], description:"全球最大水产饲料生产商之一", sort_order:25 },
  { category:"consumable", name:"丹麦 BioMar", brand:"BioMar", product:"高端水产配合饲料",
    contact:"+45 86 20 49 50", region:"丹麦 / 全球", website:"https://www.biomar.com",
    tags:["饲料","进口","高端","可持续"], description:"全球高端水产饲料标杆品牌", sort_order:26 },
  { category:"consumable", name:"惠州碧水蓝天环保科技有限公司", brand:"碧水蓝天", product:"水质检测试剂、益生菌制剂、水体消毒剂",
    contact:"0752-2266xxxx", region:"广东惠州", website:"",
    tags:["水质检测","微生物制剂","消毒","国产"], description:"水产养殖水质管理与动保产品供应商", sort_order:27 },
  { category:"consumable", name:"厦门欧瑞捷生物科技有限公司", brand:"欧瑞捷", product:"弧菌检测试剂盒、快速水质分析仪",
    contact:"0592-5366xxxx", region:"福建厦门", website:"",
    tags:["检测试剂","弧菌","快速检测","国产"], description:"专注水产病害快速检测产品研发", sort_order:28 },
  { category:"consumable", name:"挪威 Skretting", brand:"Skretting", product:"鲑鳟鱼专用配合饲料、RAS专用饲料",
    contact:"+47 51 84 42 00", region:"挪威 / 全球", website:"https://www.skretting.com",
    tags:["饲料","鲑鳟","RAS专用","进口","高端"], description:"全球三文鱼养殖饲料领先品牌", sort_order:29 },
  { category:"consumable", name:"上海海洋大学水产与生命学院检测中心", brand:"上海海大检测", product:"水质检测服务、病害诊断、饲料营养分析",
    contact:"021-6190xxxx", region:"上海", website:"https://www.shou.edu.cn",
    tags:["检测服务","病害诊断","高校","国产"], description:"依托高校科研优势提供专业检测服务", sort_order:30 },
];

// 批量写入
const count = db.bulkImportSuppliers(records);
console.log(`[seed] 供应商种子数据已写入 ${count} 条`);

// 验证
const { listSuppliers, getSupplierCategories } = db;
console.log(`[seed] 总计 ${listSuppliers().length} 条记录`);
const cats = getSupplierCategories();
cats.forEach(c => console.log(`  ${c.label}(${c.key}): ${c.count} 条`));
console.log("[seed] 种子数据初始化完成！");
