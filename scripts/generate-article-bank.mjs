/* Deterministic generator for 100 ORIGINAL IELTS-style reading passages.
 *
 * Real IELTS / Cambridge past-paper passages are adapted from copyrighted
 * journals, magazines and books and cannot be redistributed. This generator
 * therefore composes original academic-style practice texts from topic
 * vocabularies and hand-written sentence frames. Output is a TypeScript
 * module so both the Electron and browser builds can import it offline.
 *
 * Run: node scripts/generate-article-bank.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'src', 'core', 'articleBank.ts')
const EXPL_OUT = path.join(ROOT, 'src', 'data', 'explanations.ts')

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = mulberry32(20261110)
const pick = (arr) => arr[Math.floor(rand() * arr.length)]

/* Copied verbatim from src/core/hash.ts so generated sentence ids match those
 * computed by segmentArticle() at runtime. No extra randomness is consumed. */
function fnv1a(input, seed = 0x811c9dc5) {
  let h = seed >>> 0
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i) & 0xff
    h = Math.imul(h, 0x01000193) >>> 0
    const hi = (input.charCodeAt(i) >>> 8) & 0xff
    if (hi) {
      h ^= hi
      h = Math.imul(h, 0x01000193) >>> 0
    }
  }
  return h >>> 0
}
function contentHash(input) {
  const a = fnv1a(input, 0x811c9dc5).toString(16).padStart(8, '0')
  const b = fnv1a(input, 0x9e3779b9).toString(16).padStart(8, '0')
  return a + b
}
function generatedSentenceId(articleId, versionHash, paragraphNo, index, text) {
  return `${articleId}:${versionHash.slice(0, 8)}:p${paragraphNo}:s${index}:${fnv1a(text).toString(36)}`
}
function pickN(arr, n) {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy.slice(0, n)
}

/* 20 academic topics. `facts` are that-clauses (lowercase, no full stop).
 * Deliberately avoids diagnostic trigger phrases so these passages use the
 * conservative generic fallback instead of a mismatched reference translation. */
const TOPICS = [
  {
    name: 'Urban Green Space', field: 'urban ecology', places: 'large cities',
    resource: 'public green space', metric: 'reported wellbeing', period: 'two decades',
    data: 'municipal surveys', assumption: 'the assumption that park area alone predicts use',
    facts: [
      'small green areas change how residents perceive crowding',
      'the benefits of shade are unevenly distributed across districts',
      'short visits to a park can lower self-reported stress',
      'maintenance budgets predict use more reliably than park size',
      'survey responses shift sharply with the season of collection',
    ],
    factors: ['canopy cover', 'maintenance frequency', 'walking distance', 'local noise levels'],
    subtopics: ['Measuring Use', 'Shade and Heat', 'Maintenance Budgets', 'Seasonal Variation', 'District Comparisons'],
  },
  {
    name: 'Workplace Technology', field: 'organisational research', places: 'large organisations',
    resource: 'collaboration software', metric: 'measured output', period: 'fifteen years',
    data: 'internal time logs', assumption: 'a simple link between installation and adoption',
    facts: [
      'access to software rarely predicts sustained changes in workflow',
      'informal peer support shapes early uptake more strongly than formal training',
      'teams with stable routines report fewer interruptions after a rollout',
      'self-reported time savings often exceed the corresponding log data',
      'the same tool produces opposite effects in two neighbouring departments',
    ],
    factors: ['peer support', 'workflow stability', 'training quality', 'manager expectations'],
    subtopics: ['Adoption Curves', 'Training Effects', 'Time Logs', 'Departmental Differences', 'Rollout Fatigue'],
  },
  {
    name: 'Sleep and Memory', field: 'cognitive psychology', places: 'university laboratories',
    resource: 'overnight sleep records', metric: 'recall accuracy', period: 'a decade',
    data: 'polysomnography datasets', assumption: 'a single memory-consolidation mechanism',
    facts: [
      'slow-wave activity correlates with retention of word lists',
      'short naps improve recognition without changing response speed',
      'the timing of learning matters more than total sleep duration',
      'individual differences in baseline alertness complicate group averages',
      're-testing the same participants yields a flatter learning curve',
    ],
    factors: ['sleep stage timing', 'baseline alertness', 'task difficulty', 'retest interval'],
    subtopics: ['Slow-Wave Activity', 'Naps and Recognition', 'Timing of Learning', 'Individual Differences', 'Repeated Testing'],
  },
  {
    name: 'Coastal Erosion', field: 'coastal geomorphology', places: 'exposed shorelines',
    resource: 'shoreline surveys', metric: 'annual retreat rate', period: 'thirty years',
    data: 'aerial photograph archives', assumption: 'a uniform rate of sediment loss',
    facts: [
      'storm clustering explains more variance than average wave height',
      'sediment supply from rivers modulates local retreat',
      'short-term measurements overstate long-term change at several sites',
      'vegetated dunes recover at markedly different rates after a storm',
      'historical maps carry positional errors that survive modern correction',
    ],
    factors: ['storm clustering', 'sediment supply', 'dune vegetation', 'map resolution'],
    subtopics: ['Storm Clustering', 'Sediment Supply', 'Measurement Windows', 'Dune Recovery', 'Historical Maps'],
  },
  {
    name: 'Museum Collections', field: 'collection studies', places: 'regional museums',
    resource: 'catalogue records', metric: 'visitor engagement', period: 'a generation',
    data: 'digitised accession registers', assumption: 'a complete and stable catalogue',
    facts: [
      'provenance gaps cluster around a small number of acquisition periods',
      'display rotation changes which objects attract sustained attention',
      'digital images increase remote use without reducing gallery attendance',
      'labelling conventions shape how visitors group unfamiliar objects',
      'storage conditions account for a large share of missing documentation',
    ],
    factors: ['provenance detail', 'display rotation', 'label wording', 'storage history'],
    subtopics: ['Provenance Gaps', 'Display Rotation', 'Digital Access', 'Labels and Grouping', 'Storage Records'],
  },
  {
    name: 'Language Learning', field: 'applied linguistics', places: 'adult classrooms',
    resource: 'classroom exposure', metric: 'spoken fluency', period: 'an academic year',
    data: 'recorded oral tasks', assumption: 'a linear relationship between input and fluency',
    facts: [
      'spaced retrieval improves retention of low-frequency vocabulary',
      'peer interaction predicts willingness to speak more strongly than test scores',
      'fast gains in recognition rarely translate into spontaneous production',
      'learner goals shift substantially across a single course',
      'feedback timing changes the accuracy of subsequent self-correction',
    ],
    factors: ['retrieval spacing', 'peer interaction', 'feedback timing', 'learner goals'],
    subtopics: ['Spaced Retrieval', 'Willingness to Speak', 'Recognition and Production', 'Changing Goals', 'Feedback Timing'],
  },
  {
    name: 'Renewable Energy', field: 'energy systems research', places: 'regional grids',
    resource: 'grid monitoring data', metric: 'capacity utilisation', period: 'twelve years',
    data: 'half-hourly dispatch records', assumption: 'a steady relationship between installed capacity and output',
    facts: [
      'storage siting alters the value of new generation capacity',
      'seasonal demand peaks reshape the case for distributed generation',
      'curtailment events cluster in a small number of weeks',
      'forecast error has fallen steadily without changing reserve requirements',
      'local network constraints dominate the economics of several projects',
    ],
    factors: ['storage siting', 'demand shape', 'forecast error', 'network constraints'],
    subtopics: ['Storage Siting', 'Seasonal Demand', 'Curtailment', 'Forecast Error', 'Network Constraints'],
  },
  {
    name: 'Food Supply Chains', field: 'supply chain analysis', places: 'temperate regions',
    resource: 'shipment records', metric: 'reported wastage', period: 'eight seasons',
    data: 'warehouse inventory logs', assumption: 'a fixed loss rate at each handling stage',
    facts: [
      'temperature excursions explain a large share of spoilage claims',
      'small delays at collection points compound across a long route',
      'packaging changes reduce damage without changing total transit time',
      'retail forecasts drive ordering behaviour more strongly than weather',
      'audit definitions of waste vary between participating depots',
    ],
    factors: ['temperature control', 'collection delays', 'packaging design', 'forecast practice'],
    subtopics: ['Temperature Excursions', 'Collection Delays', 'Packaging Changes', 'Retail Forecasts', 'Audit Definitions'],
  },
  {
    name: 'Public Transport', field: 'transport planning', places: 'mid-sized cities',
    resource: 'ticketing data', metric: 'peak ridership', period: 'a decade',
    data: 'automated passenger counts', assumption: 'a stable relationship between frequency and demand',
    facts: [
      'transfer penalties influence route choice more strongly than fare level',
      'evening service frequency shapes reported satisfaction with the network',
      'short-term promotions produce a temporary shift in travel timing',
      'reliability improvements retain riders after a fare increase',
      'counts from different operators use incompatible boarding definitions',
    ],
    factors: ['transfer penalties', 'evening frequency', 'service reliability', 'counting method'],
    subtopics: ['Transfer Penalties', 'Evening Services', 'Short-Term Promotions', 'Reliability', 'Counting Methods'],
  },
  {
    name: 'Water Management', field: 'hydrology', places: 'irrigated basins',
    resource: 'metering records', metric: 'seasonal consumption', period: 'twenty years',
    data: 'catchment gauge series', assumption: 'a constant response to price signals',
    facts: [
      'metering accuracy varies markedly between older and newer districts',
      'crop choice explains more consumption variance than tariff design',
      'groundwater levels respond to rainfall with a multi-year lag',
      'leakage estimates change substantially after night-flow correction',
      'household surveys under-report outdoor use in dry summers',
    ],
    factors: ['meter age', 'crop choice', 'rainfall lag', 'leakage correction'],
    subtopics: ['Metering Accuracy', 'Crop Choice', 'Groundwater Lags', 'Leakage Estimates', 'Survey Bias'],
  },
  {
    name: 'Archaeological Dating', field: 'archaeological science', places: 'excavated settlements',
    resource: 'radiocarbon samples', metric: 'chronological precision', period: 'a generation',
    data: 'calibration curves', assumption: 'a straightforward mapping from sample age to occupation date',
    facts: [
      'old-wood effects shift estimated construction dates by several decades',
      'sample context matters as much as laboratory precision',
      'calibration plateaus widen credible intervals for certain centuries',
      'reservoir effects complicate dates from coastal assemblages',
      'replicated measurements occasionally expose a mislabelled bag',
    ],
    factors: ['sample context', 'old-wood effects', 'calibration shape', 'reservoir correction'],
    subtopics: ['Old-Wood Effects', 'Sample Context', 'Calibration Plateaus', 'Reservoir Effects', 'Replication'],
  },
  {
    name: 'Marine Biology', field: 'marine ecology', places: 'temperate reefs',
    resource: 'diver survey transects', metric: 'species richness', period: 'fourteen years',
    data: 'long-term transect archives', assumption: 'a simple gradient of diversity with depth',
    facts: [
      'survey timing changes the recorded abundance of cryptic species',
      'substrate complexity predicts local richness more reliably than depth',
      'warm-water events produce delayed changes in community composition',
      'observer experience accounts for a measurable share of count variance',
      'protected boundaries alter fish behaviour before biomass responds',
    ],
    factors: ['survey timing', 'substrate complexity', 'observer experience', 'thermal history'],
    subtopics: ['Survey Timing', 'Substrate Complexity', 'Warm-Water Events', 'Observer Effects', 'Protected Boundaries'],
  },
  {
    name: 'Air Quality', field: 'atmospheric measurement', places: 'dense urban districts',
    resource: 'monitor network data', metric: 'estimated exposure', period: 'a decade',
    data: 'hourly sensor readings', assumption: 'a uniform relationship between monitor readings and personal exposure',
    facts: [
      'street-canyon geometry changes pollutant levels over short distances',
      'sensor drift produces apparent trends in a subset of stations',
      'commuting patterns dominate daily exposure for several groups',
      'seasonal inversion episodes concentrate a large share of annual peaks',
      'model resolution alters estimated exposure near major roads',
    ],
    factors: ['street geometry', 'sensor drift', 'commuting patterns', 'model resolution'],
    subtopics: ['Street Canyons', 'Sensor Drift', 'Commuting Patterns', 'Inversion Episodes', 'Model Resolution'],
  },
  {
    name: 'Early Childhood Education', field: 'educational research', places: 'public preschools',
    resource: 'structured observation', metric: 'language growth', period: 'three school years',
    data: 'standardised assessment records', assumption: 'a direct effect of programme duration on attainment',
    facts: [
      'adult-child conversation quality predicts vocabulary growth',
      'attendance stability matters more than total hours enrolled',
      'small-group activities produce different gains from whole-class sessions',
      'family reading routines interact with classroom effects',
      'assessment timing shifts apparent gains in the first year',
    ],
    factors: ['conversation quality', 'attendance stability', 'group size', 'home routines'],
    subtopics: ['Conversation Quality', 'Attendance Stability', 'Group Size', 'Home Routines', 'Assessment Timing'],
  },
  {
    name: 'Digital Archives', field: 'information science', places: 'research libraries',
    resource: 'digitised collections', metric: 'retrieval success', period: 'twenty years',
    data: 'search transaction logs', assumption: 'a stable correspondence between catalogue terms and user queries',
    facts: [
      'metadata inconsistency accounts for a large share of failed searches',
      'optical character recognition errors cluster in older printed fonts',
      'query reformulation reveals gaps in subject headings',
      'usage spikes follow external citations rather than catalogue changes',
      'file format migration alters what later users can actually open',
    ],
    factors: ['metadata consistency', 'recognition accuracy', 'subject headings', 'format migration'],
    subtopics: ['Metadata Gaps', 'Recognition Errors', 'Query Reformulation', 'Usage Spikes', 'Format Migration'],
  },
  {
    name: 'Soil Health', field: 'soil science', places: 'mixed farming regions',
    resource: 'soil core samples', metric: 'measured organic carbon', period: 'a generation',
    data: 'long-term field trials', assumption: 'a uniform response to reduced tillage',
    facts: [
      'baseline clay content shapes the response to changed cultivation',
      'sampling depth accounts for apparent disagreement between trials',
      'cover cropping changes aggregation before carbon stocks respond',
      'dry years widen the gap between treatment and control plots',
      'laboratory methods differ in their treatment of fine roots',
    ],
    factors: ['clay content', 'sampling depth', 'cover cropping', 'laboratory method'],
    subtopics: ['Baseline Clay', 'Sampling Depth', 'Cover Cropping', 'Dry Years', 'Laboratory Methods'],
  },
  {
    name: 'Sports Science', field: 'exercise physiology', places: 'training centres',
    resource: 'load monitoring data', metric: 'endurance performance', period: 'several seasons',
    data: 'session rating logs', assumption: 'a linear dose-response to training volume',
    facts: [
      'session spacing changes the response to an identical weekly load',
      'sleep quality modifies the relationship between load and recovery',
      'short performance tests respond to recent sessions more strongly than long tests',
      'individual baselines shift across a competitive season',
      'self-reported effort diverges from measured intensity in some groups',
    ],
    factors: ['session spacing', 'sleep quality', 'test duration', 'individual baselines'],
    subtopics: ['Session Spacing', 'Sleep and Recovery', 'Test Duration', 'Shifting Baselines', 'Perceived Effort'],
  },
  {
    name: 'Noise and Attention', field: 'environmental psychology', places: 'open-plan offices',
    resource: 'acoustic measurements', metric: 'task accuracy', period: 'two working years',
    data: 'continuous sound logs', assumption: 'a simple link between average volume and distraction',
    facts: [
      'speech intelligibility predicts reported distraction more strongly than loudness',
      'short unpredictable events disrupt complex tasks disproportionately',
      'task switching costs rise after a sequence of brief interruptions',
      'individual hearing profiles change the effect of background speech',
      'adaptation over a working week reduces self-reported annoyance',
    ],
    factors: ['speech intelligibility', 'event unpredictability', 'task complexity', 'hearing profile'],
    subtopics: ['Speech Intelligibility', 'Unpredictable Events', 'Task Switching', 'Individual Differences', 'Adaptation'],
  },
  {
    name: 'Demographic Change', field: 'population studies', places: 'industrialised regions',
    resource: 'census microdata', metric: 'household formation rate', period: 'four decades',
    data: 'linked administrative records', assumption: 'a smooth transition between household types',
    facts: [
      'housing costs reshape the timing of household formation',
      'measurement definitions change across successive census rounds',
      'migration timing explains a substantial share of regional variation',
      'small-area estimates are sensitive to the treatment of temporary residents',
      'cohort size interacts with local labour market conditions',
    ],
    factors: ['housing costs', 'definition changes', 'migration timing', 'cohort size'],
    subtopics: ['Housing Costs', 'Changing Definitions', 'Migration Timing', 'Small-Area Estimates', 'Cohort Size'],
  },
  {
    name: 'Scientific Peer Review', field: 'research evaluation', places: 'international journals',
    resource: 'reviewer reports', metric: 'decision consistency', period: 'a decade',
    data: 'editorial decision archives', assumption: 'a shared standard of methodological quality',
    facts: [
      'reviewer disagreement concentrates on interpretation rather than data quality',
      'report length correlates weakly with eventual citation counts',
      'revision rounds improve clarity more consistently than statistical reporting',
      'discipline-specific conventions shape how uncertainty is described',
      'open reports change the tone of correspondence without changing outcomes',
    ],
    factors: ['reviewer expertise', 'discipline conventions', 'report length', 'revision depth'],
    subtopics: ['Reviewer Disagreement', 'Report Length', 'Revision Rounds', 'Discipline Conventions', 'Open Reports'],
  },
]

/* Chinese equivalents for every topic slot, index-aligned with TOPICS. */
const TOPIC_ZH = [
  { field:'城市生态学', places:'大城市', resource:'公共绿地', metric:'报告的主观幸福感', period:'二十年', data:'市政调查', assumption:'公园面积本身就能预测使用率这一假设',
    facts:['小型绿地会改变居民对拥挤的感受','遮阴的好处在不同城区之间分布不均','短暂游览公园可以降低自述压力水平','维护预算比公园面积更能预测实际使用','调查回复会随收集季节发生明显变化'],
    factors:['树冠覆盖率','维护频率','步行距离','局部噪音水平'] },
  { field:'组织研究', places:'大型组织', resource:'协作软件', metric:'测得的产出', period:'十五年', data:'内部时间日志', assumption:'安装与实际采用之间存在简单联系',
    facts:['软件的可获得性很少能预测工作流程的持续变化','同伴间的非正式支持比正式培训更能影响早期采用','流程稳定的团队在上线后报告的打断更少','自述的时间节省往往超过相应的日志数据','同一工具在两个相邻部门产生了相反的效果'],
    factors:['同伴支持','流程稳定性','培训质量','管理者预期'] },
  { field:'认知心理学', places:'大学实验室', resource:'夜间睡眠记录', metric:'回忆准确率', period:'十年', data:'多导睡眠图数据集', assumption:'存在单一的记忆巩固机制',
    facts:['慢波活动与词表的保持相关','短午睡能改善再认而不改变反应速度','学习发生的时点比总睡眠时长更重要','个体原有警觉性差异让组平均结果变得复杂','对同一批参与者重测会得到更平缓的学习曲线'],
    factors:['睡眠阶段时序','原有警觉性','任务难度','重测间隔'] },
  { field:'海岸地貌学', places:'暴露的海岸线', resource:'海岸线测量', metric:'年退缩速率', period:'三十年', data:'航拍照片档案', assumption:'沉积物损失速率是均一的',
    facts:['风暴聚集比平均波高解释了更多差异','河流带来的沉积物供给会调节局部退缩','短期测量会夸大某些地点的长期变化','植被覆盖的沙丘在风暴后以截然不同的速度恢复','历史地图带有位置误差，这种误差在现代校正后依然存在'],
    factors:['风暴聚集','沉积物供给','沙丘植被','地图分辨率'] },
  { field:'馆藏研究', places:'地方博物馆', resource:'编目记录', metric:'观众参与度', period:'一代人的时间', data:'数字化入藏登记册', assumption:'编目是完整且稳定的',
    facts:['来源缺口集中在少数几个征集时期','轮换展陈会改变哪些物件获得持续关注','数字图像增加了远程使用，却没有减少展厅到访','标签写法影响观众如何给陌生物件分组','储存状况是文档缺失的重要成因'],
    factors:['来源细节','展陈轮换','标签措辞','储存历史'] },
  { field:'应用语言学', places:'成人课堂', resource:'课堂输入', metric:'口语流利度', period:'一个学年', data:'录音口语任务', assumption:'输入量与流利度之间存在线性关系',
    facts:['间隔提取能改善低频词汇的保持','同伴互动比测试分数更能预测开口意愿','再认上的快速提升很少转化为自发表达','学习者目标在单门课程中会发生显著变化','反馈时机影响随后自我纠正的准确性'],
    factors:['提取间隔','同伴互动','反馈时机','学习者目标'] },
  { field:'能源系统研究', places:'区域电网', resource:'电网监测数据', metric:'容量利用率', period:'十二年', data:'半小时调度记录', assumption:'装机容量与产出之间存在稳定关系',
    facts:['储能选址会改变新增发电容量的价值','季节性需求高峰重塑了分布式发电的理由','弃电事件集中在少数几个星期','预测误差稳步下降，却没有改变备用容量要求','局部网络约束主导了若干项目的经济性'],
    factors:['储能选址','需求形态','预测误差','网络约束'] },
  { field:'供应链分析', places:'温带地区', resource:'货运记录', metric:'报告的损耗', period:'八个季节', data:'仓库库存日志', assumption:'每个处理环节的损耗率是固定的',
    facts:['温度异常解释了大部分变质索赔','收集点的小延误会沿长链条累积','包装改动减少了损坏，却没有改变总运输时间','零售预测对订货行为的影响强于天气','不同仓库对损耗的审计定义存在差异'],
    factors:['温度控制','收集延误','包装设计','预测做法'] },
  { field:'交通规划', places:'中等城市', resource:'票务数据', metric:'高峰客流量', period:'十年', data:'自动客流计数', assumption:'发车频率与需求之间存在稳定关系',
    facts:['换乘惩罚对路线选择的影响强于票价水平','晚间服务频率影响对网络的总体满意度','短期促销会带来出行时段的暂时转移','可靠性改善能在票价上涨后留住乘客','不同运营商的计数采用互不相容的上车定义'],
    factors:['换乘惩罚','晚间频率','服务可靠性','计数方法'] },
  { field:'水文学', places:'灌溉流域', resource:'计量记录', metric:'季节性用水量', period:'二十年', data:'流域水位计序列', assumption:'对价格信号存在恒定响应',
    facts:['计量精度在新旧地区之间差异明显','作物选择比水价设计解释了更多用水差异','地下水位对降雨的响应存在多年滞后','夜间流量校正后，渗漏估计发生显著变化','家庭调查在干燥夏季低估户外用水'],
    factors:['水表年限','作物选择','降雨滞后','渗漏校正'] },
  { field:'考古科学', places:'已发掘的聚落', resource:'放射性碳样本', metric:'年代精度', period:'一代人的时间', data:'校正曲线', assumption:'样本年代到居住年代之间存在直接映射',
    facts:['老木效应使估算的建造年代偏移数十年','样本背景与实验室精度同样重要','校正平台期使某些世纪的置信区间变宽','储库效应使沿海遗存的年代变得复杂','重复测量偶尔会暴露贴错标签的样本袋'],
    factors:['样本背景','老木效应','校正形态','储库校正'] },
  { field:'海洋生态学', places:'温带礁区', resource:'潜水样带', metric:'物种丰富度', period:'十四年', data:'长期样带档案', assumption:'多样性与深度之间存在简单梯度',
    facts:['调查时机会改变隐秘物种的记录丰度','基底复杂度比深度更能预测局部丰富度','暖水事件之后群落组成出现延迟变化','观察者经验在计数差异中占有可测量的一份','保护区边界在生物量响应之前就改变了鱼类行为'],
    factors:['调查时机','基底复杂度','观察者经验','热历史'] },
  { field:'大气测量', places:'密集城区', resource:'监测网络数据', metric:'估计暴露量', period:'十年', data:'每小时传感器读数', assumption:'监测读数与个人暴露之间存在均匀关系',
    facts:['街道峡谷几何会在短距离内改变污染物水平','传感器漂移在一部分站点造成表面趋势','通勤模式主导了若干群体的日常暴露','逆温事件集中了全年峰值的很大一部分','模型分辨率改变了主要道路附近的暴露估计'],
    factors:['街道几何','传感器漂移','通勤模式','模型分辨率'] },
  { field:'教育研究', places:'公立幼儿园', resource:'结构化观察', metric:'语言发展', period:'三个学年', data:'标准化评估记录', assumption:'课程时长对成绩有直接影响',
    facts:['成人与儿童的对话质量能预测词汇增长','出勤稳定性比总注册小时数更重要','小组活动与全班教学带来的收益不同','家庭阅读习惯与课堂效果相互作用','评估时机会改变第一年的表面增幅'],
    factors:['对话质量','出勤稳定性','小组规模','家庭习惯'] },
  { field:'信息科学', places:'研究型图书馆', resource:'数字化馆藏', metric:'检索成功率', period:'二十年', data:'搜索事务日志', assumption:'编目词与用户查询之间存在稳定对应',
    facts:['元数据不一致造成了大量检索失败','光学字符识别错误集中在较旧的印刷字体中','查询改写暴露了主题词表的缺口','使用高峰来自外部引用而非编目改动','文件格式迁移改变了后来用户真正能打开的内容'],
    factors:['元数据一致性','识别准确率','主题词表','格式迁移'] },
  { field:'土壤科学', places:'混合农作区', resource:'土壤芯样', metric:'测得有机碳', period:'一代人的时间', data:'长期田间试验', assumption:'对少耕的响应是均一的',
    facts:['基础黏粒含量决定了对耕作方式变化的响应','采样深度解释了试验之间的表面分歧','覆盖作物先改变团聚体，碳储量随后才响应','干旱年份扩大了处理组与对照组的差距','实验室方法对细根的处理方式不同'],
    factors:['黏粒含量','采样深度','覆盖作物','实验室方法'] },
  { field:'运动生理学', places:'训练中心', resource:'负荷监测数据', metric:'耐力表现', period:'若干赛季', data:'主观疲劳记录', assumption:'训练量与效果之间存在线性剂量反应',
    facts:['训练间隔会改变相同周负荷下的反应','睡眠质量调节负荷与恢复之间的关系','短时测试比长时测试更易受近期训练影响','个体基线在整个赛季中会发生偏移','自述努力程度在某些群体中偏离实测强度'],
    factors:['训练间隔','睡眠质量','测试时长','个体基线'] },
  { field:'环境心理学', places:'开放式办公室', resource:'声学测量', metric:'任务准确率', period:'两个工作年', data:'连续声音日志', assumption:'平均音量与分心之间存在简单联系',
    facts:['言语可懂度比响度更能预测报告的分心程度','短暂而不可预测的事件会格外干扰复杂任务','一连串短暂打断之后，任务切换成本上升','个体听力特征改变了背景言语的影响','一周工作下来，适应会降低自述烦躁感'],
    factors:['言语可懂度','事件不可预测性','任务复杂度','听力特征'] },
  { field:'人口研究', places:'工业化地区', resource:'人口普查微观数据', metric:'家庭形成率', period:'四十年', data:'链接的行政记录', assumption:'家庭类型之间存在平滑过渡',
    facts:['住房成本重塑了家庭形成的时点','测量定义在历次普查之间发生变化','迁移时点解释了区域差异的很大一部分','小区域估计对临时居民的处理方式很敏感','同龄群体规模与当地劳动力市场条件相互作用'],
    factors:['住房成本','定义变化','迁移时点','同龄群体规模'] },
  { field:'研究评价', places:'国际期刊', resource:'审稿报告', metric:'决策一致性', period:'十年', data:'编辑决定档案', assumption:'存在共同的方法质量标准',
    facts:['审稿人的分歧集中在解读而非数据质量','报告长度与最终引用次数只有弱相关','修改轮次对清晰度的改善比对统计报告的改善更稳定','学科惯例决定了不确定性如何被描述','公开审稿改变了信函语气，却没有改变结果'],
    factors:['审稿人专业背景','学科惯例','报告长度','修改深度'] },
]

/* Long-form sentence frames. A typical IELTS reading passage runs 700-900
 * words, so each frame is written to be 20-28 words and every passage is
 * built from 5-7 paragraphs of six to eight sentences.
 *
 * Frames deliberately avoid the trigger phrases used by the hardcoded
 * diagnostic rules in src/core/targets.ts ("whether", "less ... than",
 * sentence-initial Although/While, "not always", "designed to",
 * "has not yet", them/these/those, "The extent to which"). Otherwise a
 * composed sentence would be given a confident but unrelated reference
 * translation. tests/articleBank.test.ts asserts this with ruleIdFor(). */
const METHODS = [
  'a longitudinal survey', 'a paired comparison', 'a blinded re-analysis',
  'a stratified sample', 'a repeated cross-section', 'an independent replication',
  'a mixed-methods review', 'a preregistered audit', 'a matched control group',
  'a sensitivity analysis', 'a rolling panel design', 'a cross-validated model',
]
const CONDITIONS = [
  'the population being compared',
  'the time window of the measurement',
  'which records were excluded',
  'the definition of the outcome',
  'the version of the coding scheme',
  'the treatment of missing observations',
  'the order in which sites were visited',
  'the threshold used for a positive result',
]
const RECOMMENDATIONS = [
  'small pilots should precede any wider rollout',
  'results should be reported with their uncertainty',
  'local conditions should be recorded alongside the headline figure',
  'the analysis should be repeated with a second dataset',
  'the coding rules should be published with the estimates',
  'future rounds should retain the raw field notes',
  'a second team should reproduce the central comparison',
  'the sampling frame should be documented before collection begins',
]

const LEADS = [
  'The first set of questions concerns {factorA} in {places}.',
  'A second line of work examines how {metric} was recorded during the study period.',
  'The evidence from {data} raises a rather different set of problems.',
  'Comparisons between {places} complicate the picture considerably.',
  'Attention has also turned to the limits of the available {data}.',
  'The final set of results concerns what happens after {factorA} is taken into account.',
]

const OPENERS = [
  'Work in {field} has changed considerably over {period}, as the cost of collecting {data} has fallen.',
  'Interest in {resource} grew steadily across {places} during the study window, and the literature expanded with it.',
  'For much of the past {period}, research in {field} rested on {assumption}.',
  'A review of {data} published last year reopened a long-running debate in {field}.',
  'In many {places}, debate about {resource} still starts from {assumption}.',
  'Accounts of {resource} in {places} often begin with {assumption}, even when later chapters qualify it heavily.',
  'Recent studies suggest that the relationship between {resource} and {metric} is more conditional than early reports assumed.',
]

const FACT_FRAMES = [
  'Recent work in {field} suggests that {fact}, although the strength of the association differs between {places} and comparable settings elsewhere.',
  'A review of {data} covering the full study period concluded that {fact}, but the authors avoided claiming that the same mechanism operates in every region.',
  'Field observations from {places} indicate that {fact}, a result that surprised several teams who had expected a much flatter distribution.',
  'The most recent analysis found that {fact}, with the largest differences appearing in the records collected near the end of the series.',
  'Interviews with practitioners in {places} suggest that {fact}, which is consistent with the pattern reported in the previous round of {data}.',
  'A cautious reading of the evidence is that {fact}, since the available {data} cannot separate the effect from ordinary year-to-year variation.',
  'Several independent groups have now reported that {fact}, and their estimates agree more closely than the earlier literature predicted.',
  'The authors argue that {fact}, while acknowledging that {factorA} is recorded rather imprecisely in most of the archived files.',
  'An alternative interpretation is that {fact}, because the sampling frame changed partway through the study and was never fully documented.',
  'Longitudinal records from {places} show that {fact}, particularly in sites where {factorA} was recorded at the same time each season.',
  'A paired comparison using {data} suggests that {fact}, though the difference becomes small once {factorA} is held constant.',
  'The report notes that {fact}, and it recommends repeating the measurement before any general conclusion is drawn about {field}.',
  'Researchers working in {field} have long suspected that {fact}, but the archival {data} needed to test the idea were only assembled recently.',
  'A wider survey of {places} adds that {fact}, with the caveat that the response rate fell sharply in the final year of the series.',
]

const METHOD_FRAMES = [
  'The team relied on {method}, a design that reduces the risk of mistaking a reporting artefact for a genuine change in {metric}.',
  'A second pass used {method} in order to check the stability of the ranking across {places}.',
  'Because the original files were incomplete, the reviewers repeated the analysis with {method} and kept both sets of estimates.',
  'The published tables do not state which {method} was used for the earliest cohort in the series.',
  'The same {method} was applied to each site in {places}, although the local teams recorded {resource} in different units.',
  'A sensitivity check based on {method} produced a similar ordering, with only the smallest sites changing position.',
  'Independent reviewers repeated the exercise with {method} and reached a narrower conclusion than the original authors.',
  'Data from {data} were reweighted with {method} before the {metric} estimates were compared across {places}.',
  'The protocol required {method} at every stage, yet the field notes from {places} suggest that compliance was uneven.',
  'A fuller account would need {method} applied consistently across the whole series.',
]

const QUAL_FRAMES = [
  'Access to {resource} is widespread in {places}, but {metric} still depends on {factorA} far more than on {factorB}.',
  'The effect is shaped more by {factorA} than by {factorB}, and neither variable is easy to measure retrospectively.',
  'Any comparison therefore has to specify {factorA}, because the definition of {metric} changed during the study period.',
  'A single summary figure would hide substantial variation in {factorA} between {places}.',
  'The debate now centres on {factorA}, and on how much uncertainty the available {data} can actually support.',
  'Measurements of {factorB} are missing from the earliest files, which limits what can be said about the start of the series.',
  'Where {factorA} was recorded consistently, the estimated effect of {factorB} is noticeably smaller.',
  'Teams that controlled for {factorA} obtained a narrower range of values for {metric}.',
  'The claim is plausible, yet the underlying measurements are not comparable across the full set of {places}.',
  'Supporters argue that the time horizon is simply too narrow to separate a persistent effect from a temporary one.',
  'Critics reply that the same argument was used for two earlier initiatives in {field}, neither of which produced a durable change.',
  'A careful reader should resist filling that gap with an assumption about {factorA}, however convenient it may appear.',
  'Longer records may resolve the ambiguity, but the archived files from {places} do not include the necessary detail.',
  'It would be premature to treat {metric} as a proxy for the wider phenomenon that the authors describe.',
  'No independent audit has appeared so far, so the figure should be read as a provisional summary rather than a settled result.',
]

const IMPL_FRAMES = [
  'The practical implication is modest: {recommendation}, especially in settings where {factorA} is poorly documented.',
  'For {places}, the immediate consequence is that comparisons with earlier rounds of {data} require an explicit adjustment.',
  'Policymakers in {field} have tended to focus on {metric}, but the review suggests that {factorA} deserves equal attention.',
  'A useful next step would be a small pilot in {places}, with the measurement protocol fixed before any data are collected.',
  'The finding matters more for the way future {data} are recorded than for the headline number attached to {metric}.',
  'Until the measurement protocols are aligned, a single summary figure would be misleading for readers outside {field}.',
  'The review therefore recommends that {recommendation}, rather than extending the current series indefinitely.',
  'For researchers entering {field}, the main lesson is that {factorA} cannot be treated as a fixed background condition.',
  'A more useful description of {metric} would separate the effect of {factorA} from ordinary variation in {data}.',
  'The authors stop short of a general recommendation, noting that {factorA} varies too much between sites.',
]

const CONC_FRAMES = [
  'Taken together, the studies in {field} point to a conditional relationship rather than a universal rule about {metric}.',
  'The debate is now about {factorA}, and about how much weight the available evidence can reasonably carry.',
  'For that reason, the review stops short of a general recommendation for {places}.',
  'Any comparison therefore has to specify {condition}, which the earliest reports rarely did.',
  'The authors conclude that {fact}.',
  'What remains uncertain is not the direction of the effect but its size in settings outside {places}.',
  'The final table summarises the estimates from {data} without claiming that they settle the wider question.',
  'A fuller account would also need to explain why {factorA} behaves differently in the later records.',
]

const POOLS = {
  OPEN: OPENERS,
  FACT: FACT_FRAMES,
  METHOD: METHOD_FRAMES,
  QUAL: QUAL_FRAMES,
  IMPL: IMPL_FRAMES,
  CONC: CONC_FRAMES,
}

/* Chinese glosses for the shared slots. Parallel to the English arrays above. */
const METHODS_ZH = [
  '纵向调查', '配对比较', '盲法再分析', '分层抽样', '重复横断面研究', '独立复现',
  '混合方法综述', '预注册审计', '匹配对照组', '敏感性分析', '滚动面板设计', '交叉验证模型',
]
const CONDITIONS_ZH = [
  '被比较的人群', '测量的时间窗口', '哪些记录被排除', '结果的界定方式',
  '编码方案的版本', '缺失观测的处理方式', '地点走访的先后顺序', '阳性结果所用的阈值',
]
const RECOMMENDATIONS_ZH = [
  '在更大范围推广前先做小规模试点',
  '结果应连同不确定性一起报告',
  '本地条件应与首要数字一同记录',
  '分析应使用第二组数据重复进行',
  '编码规则应与估计值一同公布',
  '后续轮次应保留原始现场笔记',
  '应由第二团队复现核心比较',
  '收集数据前应记录抽样框架',
]

/* Chinese reference-reading frames, index-aligned with each English frame. */
const ZH_POOLS = {
  LEADS: [
    '第一组问题关注的是{places}的{factorA}。',
    '第二条研究线索考察的是研究期间{metric}是如何被记录的。',
    '来自{data}的证据引出了另一类截然不同的问题。',
    '对{places}之间的比较使整体图景变得更加复杂。',
    '人们的注意力也转向了现有{data}的局限性。',
    '最后一组结果关注的是把{factorA}考虑进来之后会发生什么。',
  ],
  OPEN: [
    '{field}领域的研究在{period}间发生了很大变化，因为收集{data}的成本下降了。',
    '在研究期内，{places}对{resource}的兴趣稳步增长，相关文献也随之扩充。',
    '在过去{period}的大部分时间里，{field}的研究都建立在{assumption}之上。',
    '去年发表的一篇对{data}的综述重新开启了{field}领域长期存在的争论。',
    '在许多{places}，关于{resource}的讨论仍从{assumption}出发。',
    '关于{places}的{resource}的叙述往往始于{assumption}，即便后续章节会对其大加限定。',
    '近期研究表明，{resource}与{metric}之间的关系比早期报告所认为的更有条件性。',
  ],
  FACT: [
    '{field}领域的近期研究表明{fact}，尽管这种关联的强度在{places}与其它可比地区之间有所不同。',
    '一项覆盖整个研究期的{data}综述得出结论认为{fact}，但作者避免声称同一机制在每一个地区都起作用。',
    '来自{places}的实地观察表明{fact}，这一结果让若干预期分布会平缓得多的团队感到意外。',
    '最新的分析发现{fact}，其中最大的差异出现在该系列接近尾声时收集的记录中。',
    '对{places}从业者的访谈表明{fact}，这与上一轮{data}所报告的模式一致。',
    '对证据的谨慎解读是{fact}，因为现有的{data}无法把这一效应与普通的年度波动区分开。',
    '若干独立团队现在已经报告{fact}，他们的估计比早期文献所预期的更为一致。',
    '作者认为{fact}，同时承认在大多数存档文件中{factorA}的记录相当不精确。',
    '另一种解释是{fact}，因为抽样框架在研究进行中发生了变化，且从未被完整记录。',
    '来自{places}的纵向记录显示{fact}，尤其是在每个季节同一时间记录{factorA}的地点。',
    '使用{data}进行的配对比较表明{fact}，不过一旦把{factorA}固定下来，差异就会变小。',
    '报告指出{fact}，并建议在就{field}得出任何一般性结论之前重复这一测量。',
    '在{field}工作的研究者长期怀疑{fact}，但检验这一想法所需的存档{data}直到最近才被汇集起来。',
    '一项覆盖{places}的更广泛调查补充说{fact}，但需要提醒的是，在该系列最后一年回复率急剧下降。',
  ],
  METHOD: [
    '团队采用了{method}，这种设计降低了把报告假象误认为{metric}真实变化的风险。',
    '第二轮使用{method}，以检验{places}之间排序的稳定性。',
    '由于原始文件不完整，评审者用{method}重复了分析，并保留了两组估计。',
    '已发表的表格并未说明对该系列最早一批样本使用了哪种{method}。',
    '同样的{method}被应用于{places}的每一个地点，尽管当地团队用不同单位记录{resource}。',
    '基于{method}的敏感性检验得出了相似的排序，只有规模最小的地点位置发生了变化。',
    '独立评审者用{method}重复了这项工作，得出的结论比原作者更为保守。',
    '在把{metric}的估计值在{places}之间进行比较之前，先用{method}对{data}的数据重新加权。',
    '研究方案要求在每个阶段都采用{method}，但来自{places}的现场笔记表明执行情况并不均衡。',
    '更完整的说明需要在整个系列中始终如一地应用{method}。',
  ],
  QUAL: [
    '在{places}，{resource}的获取相当普遍，但{metric}仍然更多取决于{factorA}，而非{factorB}。',
    '这一效应更多由{factorA}而非{factorB}塑造，而且这两个变量事后都不容易测量。',
    '因此任何比较都必须说明{factorA}，因为{metric}的定义在研究期间发生了变化。',
    '单一的综合数字会掩盖{places}之间{factorA}的巨大差异。',
    '目前的争论集中在{factorA}，以及现有的{data}究竟能支持多大的不确定性。',
    '最早的文件中缺少{factorB}的测量值，这限制了我们对这一系列起始阶段能说什么。',
    '在{factorA}被持续记录的地方，{factorB}的估计效应明显更小。',
    '控制了{factorA}的团队得到了范围更窄的{metric}数值。',
    '这一说法看似合理，但底层测量值在全部{places}之间并不具备可比性。',
    '支持者认为时间跨度太窄，无法把持久效应与暂时效应区分开来。',
    '批评者回应说，同样的理由曾被用于{field}中两次更早的行动，而两者都没有带来持久的改变。',
    '细心的读者应当抵制用关于{factorA}的假设来填补这一空白，无论这种假设看起来多么方便。',
    '更长的记录或许能消除歧义，但来自{places}的存档文件并不包含必要的细节。',
    '把{metric}当作作者所描述的更广泛现象的替代指标，还为时过早。',
    '迄今为止还没有出现独立审计，因此这一数字应被看作暂定的总结，而非定论。',
  ],
  IMPL: [
    '实际含义相当有限：{recommendation}，尤其是在{factorA}记录不佳的环境中。',
    '对{places}而言，直接的后果是，与早期几轮{data}的比较需要作出明确的调整。',
    '{field}领域的决策者往往关注{metric}，但这篇综述提示{factorA}同样值得关注。',
    '有用的下一步是在{places}开展小规模试点，并在收集任何数据之前固定测量方案。',
    '这一发现的意义更多在于未来{data}的记录方式，而不是附着于{metric}之上的首要数字。',
    '在测量方案统一之前，单一的综合数字对{field}之外的读者会产生误导。',
    '因此这篇综述建议{recommendation}，而不是无限期地延长当前的数据系列。',
    '对于刚进入{field}的研究者，主要教训是{factorA}不能被当作固定的背景条件。',
    '对{metric}更有用的描述，是把{factorA}的效应与{data}中的普通波动区分开。',
    '作者没有提出一般性建议，因为{factorA}在各地点之间差异太大。',
  ],
  CONC: [
    '综合来看，{field}中的这些研究指向一种有条件的关系，而不是关于{metric}的普遍规律。',
    '目前的争论围绕{factorA}，以及现有证据究竟能合理地承担多大的分量。',
    '因此，这篇综述没有对{places}提出一般性的建议。',
    '因此任何比较都必须说明{condition}，而最早的报告很少这样做。',
    '作者得出结论认为{fact}。',
    '仍然不确定的不是效应的方向，而是它在{places}之外的环境中的大小。',
    '最后的表格总结了来自{data}的估计值，但并未声称它们解决了更广泛的问题。',
    '更完整的说明还需要解释为什么{factorA}在后期记录中表现不同。',
  ],
}

/* English subject-predicate-object skeleton templates, index-aligned with the
 * English frames above. Slots are filled from the already-resolved English
 * slots, so no random draw is consumed and the passage text cannot change. */
const EN_SKELETON_POOLS = {
  "LEADS": [
    {
      "subject": "The first set of questions",
      "predicate": "concerns",
      "object": "{factorA} in {places}"
    },
    {
      "subject": "A second line of work",
      "predicate": "examines",
      "object": "how {metric} was recorded during the study period"
    },
    {
      "subject": "The evidence from {data}",
      "predicate": "raises",
      "object": "a rather different set of problems"
    },
    {
      "subject": "Comparisons between {places}",
      "predicate": "complicate",
      "object": "the picture considerably"
    },
    {
      "subject": "Attention",
      "predicate": "has also turned to",
      "object": "the limits of the available {data}"
    },
    {
      "subject": "The final set of results",
      "predicate": "concerns",
      "object": "what happens after {factorA} is taken into account"
    }
  ],
  "OPEN": [
    {
      "subject": "Work in {field}",
      "predicate": "has changed",
      "object": "considerably over {period}"
    },
    {
      "subject": "Interest in {resource}",
      "predicate": "grew",
      "object": "steadily across {places}"
    },
    {
      "subject": "research in {field}",
      "predicate": "rested on",
      "object": "{assumption}"
    },
    {
      "subject": "A review of {data} published last year",
      "predicate": "reopened",
      "object": "a long-running debate in {field}"
    },
    {
      "subject": "debate about {resource}",
      "predicate": "still starts from",
      "object": "{assumption}"
    },
    {
      "subject": "Accounts of {resource} in {places}",
      "predicate": "often begin with",
      "object": "{assumption}"
    },
    {
      "subject": "Recent studies",
      "predicate": "suggest",
      "object": "the relationship between {resource} and {metric} is more conditional"
    }
  ],
  "FACT": [
    {
      "subject": "Recent work in {field}",
      "predicate": "suggests",
      "object": "that {fact}"
    },
    {
      "subject": "A review of {data}",
      "predicate": "concluded",
      "object": "that {fact}"
    },
    {
      "subject": "Field observations from {places}",
      "predicate": "indicate",
      "object": "that {fact}"
    },
    {
      "subject": "The most recent analysis",
      "predicate": "found",
      "object": "that {fact}"
    },
    {
      "subject": "Interviews with practitioners in {places}",
      "predicate": "suggest",
      "object": "that {fact}"
    },
    {
      "subject": "A cautious reading of the evidence",
      "predicate": "is",
      "object": "that {fact}"
    },
    {
      "subject": "Several independent groups",
      "predicate": "have reported",
      "object": "that {fact}"
    },
    {
      "subject": "The authors",
      "predicate": "argue",
      "object": "that {fact}"
    },
    {
      "subject": "An alternative interpretation",
      "predicate": "is",
      "object": "that {fact}"
    },
    {
      "subject": "Longitudinal records from {places}",
      "predicate": "show",
      "object": "that {fact}"
    },
    {
      "subject": "A paired comparison using {data}",
      "predicate": "suggests",
      "object": "that {fact}"
    },
    {
      "subject": "The report",
      "predicate": "notes",
      "object": "that {fact}"
    },
    {
      "subject": "Researchers working in {field}",
      "predicate": "have long suspected",
      "object": "that {fact}"
    },
    {
      "subject": "A wider survey of {places}",
      "predicate": "adds",
      "object": "that {fact}"
    }
  ],
  "METHOD": [
    {
      "subject": "The team",
      "predicate": "relied on",
      "object": "{method}"
    },
    {
      "subject": "A second pass",
      "predicate": "used",
      "object": "{method}"
    },
    {
      "subject": "the reviewers",
      "predicate": "repeated",
      "object": "the analysis with {method}"
    },
    {
      "subject": "The published tables",
      "predicate": "do not state",
      "object": "which {method} was used for the earliest cohort"
    },
    {
      "subject": "The same {method}",
      "predicate": "was applied to",
      "object": "each site in {places}"
    },
    {
      "subject": "A sensitivity check based on {method}",
      "predicate": "produced",
      "object": "a similar ordering"
    },
    {
      "subject": "Independent reviewers",
      "predicate": "repeated",
      "object": "the exercise with {method}"
    },
    {
      "subject": "Data from {data}",
      "predicate": "were reweighted with",
      "object": "{method}"
    },
    {
      "subject": "The protocol",
      "predicate": "required",
      "object": "{method}"
    },
    {
      "subject": "A fuller account",
      "predicate": "would need",
      "object": "{method} applied consistently across the whole series"
    }
  ],
  "QUAL": [
    {
      "subject": "{metric}",
      "predicate": "still depends on",
      "object": "{factorA} far more than on {factorB}"
    },
    {
      "subject": "The effect",
      "predicate": "is shaped more by",
      "object": "{factorA} than by {factorB}"
    },
    {
      "subject": "Any comparison",
      "predicate": "has to specify",
      "object": "{factorA}"
    },
    {
      "subject": "A single summary figure",
      "predicate": "would hide",
      "object": "substantial variation in {factorA} between {places}"
    },
    {
      "subject": "The debate",
      "predicate": "now centres on",
      "object": "{factorA}"
    },
    {
      "subject": "Measurements of {factorB}",
      "predicate": "are missing from",
      "object": "the earliest files"
    },
    {
      "subject": "the estimated effect of {factorB}",
      "predicate": "is",
      "object": "noticeably smaller"
    },
    {
      "subject": "Teams that controlled for {factorA}",
      "predicate": "obtained",
      "object": "a narrower range of values for {metric}"
    },
    {
      "subject": "The claim",
      "predicate": "is",
      "object": "plausible"
    },
    {
      "subject": "Supporters",
      "predicate": "argue",
      "object": "that the time horizon is simply too narrow"
    },
    {
      "subject": "Critics",
      "predicate": "reply",
      "object": "that the same argument was used for two earlier initiatives"
    },
    {
      "subject": "A careful reader",
      "predicate": "should resist",
      "object": "filling that gap with an assumption about {factorA}"
    },
    {
      "subject": "Longer records",
      "predicate": "may resolve",
      "object": "the ambiguity"
    },
    {
      "subject": "It",
      "predicate": "would be premature to treat",
      "object": "{metric} as a proxy for the wider phenomenon"
    },
    {
      "subject": "No independent audit",
      "predicate": "has appeared",
      "object": "so far"
    }
  ],
  "IMPL": [
    {
      "subject": "The practical implication",
      "predicate": "is",
      "object": "modest"
    },
    {
      "subject": "the immediate consequence",
      "predicate": "is",
      "object": "that comparisons with earlier rounds of {data} require an explicit adjustment"
    },
    {
      "subject": "Policymakers in {field}",
      "predicate": "have tended to focus on",
      "object": "{metric}"
    },
    {
      "subject": "A useful next step",
      "predicate": "would be",
      "object": "a small pilot in {places}"
    },
    {
      "subject": "The finding",
      "predicate": "matters more for",
      "object": "the way future {data} are recorded"
    },
    {
      "subject": "a single summary figure",
      "predicate": "would be",
      "object": "misleading for readers outside {field}"
    },
    {
      "subject": "The review",
      "predicate": "recommends",
      "object": "that {recommendation}"
    },
    {
      "subject": "the main lesson",
      "predicate": "is",
      "object": "that {factorA} cannot be treated as a fixed background condition"
    },
    {
      "subject": "A more useful description of {metric}",
      "predicate": "would separate",
      "object": "the effect of {factorA} from ordinary variation in {data}"
    },
    {
      "subject": "The authors",
      "predicate": "stop short of",
      "object": "a general recommendation"
    }
  ],
  "CONC": [
    {
      "subject": "the studies in {field}",
      "predicate": "point to",
      "object": "a conditional relationship"
    },
    {
      "subject": "The debate",
      "predicate": "is now about",
      "object": "{factorA}"
    },
    {
      "subject": "the review",
      "predicate": "stops short of",
      "object": "a general recommendation for {places}"
    },
    {
      "subject": "Any comparison",
      "predicate": "has to specify",
      "object": "{condition}"
    },
    {
      "subject": "The authors",
      "predicate": "conclude",
      "object": "that {fact}"
    },
    {
      "subject": "What remains uncertain",
      "predicate": "is",
      "object": "the size of the effect in settings outside {places}"
    },
    {
      "subject": "The final table",
      "predicate": "summarises",
      "object": "the estimates from {data}"
    },
    {
      "subject": "A fuller account",
      "predicate": "would need to explain",
      "object": "why {factorA} behaves differently in the later records"
    }
  ]
}

/* Five planned paragraphs; extra paragraphs are appended only if the word
 * count is still below the IELTS range. */
const PLANS = [
  ['FACT', 'FACT', 'OPEN', 'METHOD', 'QUAL'],
  ['FACT', 'METHOD', 'QUAL', 'FACT', 'IMPL'],
  ['QUAL', 'FACT', 'METHOD', 'QUAL', 'FACT'],
  ['FACT', 'METHOD', 'QUAL', 'IMPL', 'FACT'],
  ['IMPL', 'QUAL', 'FACT', 'CONC', 'IMPL'],
  ['FACT', 'METHOD', 'QUAL', 'IMPL', 'CONC'],
]

const MIN_WORDS = 700
const MAX_WORDS = 900

/* The first three passages are the hand-written examples used by the
 * human-labelled diagnostic baseline; each contains an accurately parsed
 * target sentence, so training on them gives meaningful feedback. */
const ORIGINAL_THREE = [
  {
    title: 'Technology and Productivity',
    sourceNote: '本项目原创 IELTS 风格练习文本，含重点训练句，非官方真题；可自由使用',
    text: `Recent studies suggest that the relationship between workplace tools and output is more conditional than earlier reports assumed. The extent to which technology improves productivity depends on how effectively employees use it. In many organisations, access to software is not the binding constraint.

Training budgets, however, are often approved without evidence of sustained practice. Although resources are widely available, understanding depends on critical evaluation. Managers who equate installation with adoption tend to overestimate early gains.

Success depends less on speed than on accuracy. A system that produces fast but poorly checked figures can create more rework than it removes. The same pattern appears in laboratories, where a rushed analysis is frequently repeated from scratch.`,
  },
  {
    title: 'Evidence and Interpretation',
    sourceNote: '本项目原创 IELTS 风格练习文本，含重点训练句，非官方真题；可自由使用',
    text: `The system was designed to reduce costs. Whether it has done so remains an open question, because the evaluation period was short. No independent audit has yet been published.

The information students encounter is not always reliable. The decision depends on whether the evidence is sufficient. Neither statement tells us what the evidence actually shows, and a careful reader should resist filling that gap with an assumption.

The policy, introduced last year, has not yet produced measurable results. Supporters argue that the time horizon is simply too narrow. Critics reply that the same argument was used for two earlier initiatives.`,
  },
  {
    title: 'Classroom Materials and Reference',
    sourceNote: '本项目原创 IELTS 风格练习文本，含指代歧义演示句；非官方真题',
    text: `Teachers often receive printed resources together with digital ones. How effectively teachers integrate them into their lessons varies widely across schools. Because both printed and digital resources are mentioned, the reference of them is not fully determined by this sentence alone.

A reviewer who insists on a single antecedent at this point is making an assumption. Longer context may resolve the ambiguity, but a system should allow a disputed reading rather than punish a learner for choosing either plausible option.`,
  },
]

/* Chinese readings for the hand-written focus sentences, paragraph by
 * paragraph and sentence by sentence, index-aligned with ORIGINAL_THREE. */
const FOCUS_ZH = [
  [
    [
      '近期研究表明，工具与产出之间的关系比早期报告所认为的更有条件性。',
      '技术能在多大程度上提高生产率，取决于员工使用技术有多有效。',
      '在许多组织中，获得软件本身并不是制约因素。',
    ],
    [
      '然而，培训预算往往在没有持续实践证据的情况下被批准。',
      '尽管资源广泛可得，理解仍取决于批判性评价。',
      '把安装等同于采用的管理者，往往会高估早期收益。',
    ],
    [
      '成功更多取决于准确性，而不是速度。',
      '一个产出数字很快却缺乏核查的系统，带来的返工可能多于它省下的时间。',
      '同样的模式也出现在实验室里：仓促完成的分析常常需要从零重做。',
    ],
  ],
  [
    [
      '该系统被设计用来降低成本。',
      '它是否真的做到了，仍是一个开放问题，因为评估期很短。',
      '迄今还没有发表独立审计。',
    ],
    [
      '学生接触到的信息未必可靠。',
      '这个决定取决于证据是否充分。',
      '这两种说法都没有告诉我们证据实际显示了什么；细心的读者应当抵制用假设填补空白。',
    ],
    [
      '去年出台的那项政策尚未产生可测量的结果。',
      '支持者认为只是时间跨度太窄。',
      '批评者回应说，两次更早的举措也用过同样的理由。',
    ],
  ],
  [
    [
      '教师常常同时收到印刷资源和数字资源。',
      '教师把这些资源整合进课堂的效果，在学校之间差别很大。',
      '由于印刷资源和数字资源都被提到，them 的指代无法仅凭这一句确定。',
    ],
    [
      '此时坚持单一先行词的评审者是在作假设。',
      '更长的上下文或许能消除歧义，但系统应当允许有争议的解读，而不是惩罚选择任一合理读法的学习者。',
    ],
  ],
]

/* English SVO skeletons for the hand-written focus sentences, aligned with
 * ORIGINAL_THREE / FOCUS_ZH so the baseline passages show the real English
 * clause structure rather than a Chinese gloss. */
const FOCUS_SKELETON = [
  [
    [
      {
        "subject": "Recent studies",
        "predicate": "suggest",
        "object": "that the relationship between workplace tools and output is more conditional"
      },
      {
        "subject": "The extent to which technology improves productivity",
        "predicate": "depends on",
        "object": "how effectively employees use it"
      },
      {
        "subject": "access to software",
        "predicate": "is not",
        "object": "the binding constraint"
      }
    ],
    [
      {
        "subject": "Training budgets",
        "predicate": "are often approved",
        "object": "without evidence of sustained practice"
      },
      {
        "subject": "understanding",
        "predicate": "depends on",
        "object": "critical evaluation"
      },
      {
        "subject": "Managers who equate installation with adoption",
        "predicate": "tend to overestimate",
        "object": "early gains"
      }
    ],
    [
      {
        "subject": "Success",
        "predicate": "depends less on",
        "object": "speed than on accuracy"
      },
      {
        "subject": "A system that produces fast but poorly checked figures",
        "predicate": "can create",
        "object": "more rework than it removes"
      },
      {
        "subject": "The same pattern",
        "predicate": "appears",
        "object": "in laboratories"
      }
    ]
  ],
  [
    [
      {
        "subject": "The system",
        "predicate": "was designed",
        "object": "to reduce costs"
      },
      {
        "subject": "Whether it has done so",
        "predicate": "remains",
        "object": "an open question"
      },
      {
        "subject": "No independent audit",
        "predicate": "has yet been published",
        "object": ""
      }
    ],
    [
      {
        "subject": "The information students encounter",
        "predicate": "is not always",
        "object": "reliable"
      },
      {
        "subject": "The decision",
        "predicate": "depends on",
        "object": "whether the evidence is sufficient"
      },
      {
        "subject": "Neither statement",
        "predicate": "tells",
        "object": "us what the evidence actually shows"
      }
    ],
    [
      {
        "subject": "The policy",
        "predicate": "has not yet produced",
        "object": "measurable results"
      },
      {
        "subject": "Supporters",
        "predicate": "argue",
        "object": "that the time horizon is simply too narrow"
      },
      {
        "subject": "Critics",
        "predicate": "reply",
        "object": "that the same argument was used for two earlier initiatives"
      }
    ]
  ],
  [
    [
      {
        "subject": "Teachers",
        "predicate": "often receive",
        "object": "printed resources together with digital ones"
      },
      {
        "subject": "How effectively teachers integrate them into their lessons",
        "predicate": "varies",
        "object": "widely across schools"
      },
      {
        "subject": "the reference of them",
        "predicate": "is not fully determined",
        "object": "by this sentence alone"
      }
    ],
    [
      {
        "subject": "A reviewer who insists on a single antecedent at this point",
        "predicate": "is making",
        "object": "an assumption"
      },
      {
        "subject": "Longer context",
        "predicate": "may resolve",
        "object": "the ambiguity"
      }
    ]
  ]
]

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length
}

/**
 * One passage context: rotating topic facts/factors, a used-sentence set that
 * guarantees no identical sentence occurs twice in the same passage, and a
 * paragraph builder that walks through the planned frame sequences.
 */
function makeContext(topic, topicZh) {
  const facts = pickN(topic.facts, topic.facts.length)
  const factors = pickN(topic.factors, topic.factors.length)
  const used = new Set()
  const usedTemplates = new Set()
  let fPos = 0
  let xPos = 0
  let planIndex = 0
  let lastSlots = {}

  const resolve = (key) => {
    if (['claim', 'finding', 'finding2', 'fact'].includes(key)) return facts[fPos++ % facts.length]
    if (['factor', 'factorA', 'factorB'].includes(key)) return factors[xPos++ % factors.length]
    if (key === 'method') return pick(METHODS)
    if (key === 'condition') return pick(CONDITIONS)
    if (key === 'recommendation') return pick(RECOMMENDATIONS)
    return topic[key] ?? ''
  }
  const fill = (tpl) => {
    lastSlots = {}
    return tpl.replace(/\{(\w+)\}/g, (_m, k) => {
      const value = String(resolve(k))
      lastSlots[k] = value
      return value
    })
  }

  const zhFor = (key, value) => {
    if (key === 'fact') {
      const i = topic.facts.indexOf(value)
      return i >= 0 ? topicZh.facts[i] : value
    }
    if (['factor', 'factorA', 'factorB'].includes(key)) {
      const i = topic.factors.indexOf(value)
      return i >= 0 ? topicZh.factors[i] : value
    }
    if (key === 'method') return METHODS_ZH[METHODS.indexOf(value)] ?? value
    if (key === 'condition') return CONDITIONS_ZH[CONDITIONS.indexOf(value)] ?? value
    if (key === 'recommendation') return RECOMMENDATIONS_ZH[RECOMMENDATIONS.indexOf(value)] ?? value
    return topicZh[key] ?? value
  }
  const fillZh = (tpl, slots) =>
    tpl.replace(/\{(\w+)\}/g, (_m, k) => String(zhFor(k, slots[k] ?? '')))
  const skeletonEn = (sk, slots) =>
    sk
      ? {
          subject: sk.subject.replace(/\{(\w+)\}/g, (_m, k) => String(slots[k] ?? '')),
          predicate: sk.predicate.replace(/\{(\w+)\}/g, (_m, k) => String(slots[k] ?? '')),
          object: sk.object.replace(/\{(\w+)\}/g, (_m, k) => String(slots[k] ?? '')),
        }
      : undefined

  /** Prefer a frame that has not appeared in this passage yet, so the same
   * rhetorical move is not repeated with merely different vocabulary.
   * Returns the English sentence, its Chinese reading and an SVO skeleton.
   * The skeleton is computed from already-resolved slots with NO random
   * draws, so the English text, word counts and SentenceIds stay identical. */
  function fromPool(pool, zhPool, category, skPool) {
    const fresh = pool.map((_, i) => i).filter((i) => !usedTemplates.has(pool[i]))
    const source = fresh.length ? fresh : pool.map((_, i) => i)
    const build = (idx) => {
      const text = fill(pool[idx])
      const slots = { ...lastSlots }
      return {
        text,
        zh: fillZh(zhPool[idx] ?? '', slots),
        category,
        skeleton: skeletonEn(skPool?.[idx], slots),
      }
    }
    for (let i = 0; i < 80; i++) {
      const idx = pick(source)
      const item = build(idx)
      if (!used.has(item.text)) {
        used.add(item.text)
        usedTemplates.add(pool[idx])
        return item
      }
    }
    const idx = pick(source)
    usedTemplates.add(pool[idx])
    return build(idx)
  }

  const nextParagraph = () => {
    const plan = PLANS[planIndex++ % PLANS.length]
    const items = [
      fromPool(LEADS, ZH_POOLS.LEADS, 'LEAD', EN_SKELETON_POOLS.LEADS),
      ...plan.map((name) => fromPool(POOLS[name], ZH_POOLS[name], name, EN_SKELETON_POOLS[name])),
    ]
    return { text: items.map((i) => i.text).join(' '), items }
  }
  return { nextParagraph }
}

/** Grow or trim paragraphs until the passage sits inside 700-900 words. */
function fitToRange(paragraphs, nextParagraph) {
  const text = () => paragraphs.map((p) => p.text).join('\n\n')
  let guard = 0
  while (wordCount(text()) < MIN_WORDS + 15 && guard++ < 5) {
    paragraphs.push(nextParagraph())
  }
  while (wordCount(text()) > MAX_WORDS && paragraphs.length > 1) {
    const last = paragraphs[paragraphs.length - 1]
    if (last.items.length > 1) {
      last.items.pop()
      last.text = last.items.map((i) => i.text).join(' ')
    } else {
      paragraphs.pop()
    }
  }
  return text()
}

function assertLength(text, label) {
  const words = wordCount(text)
  if (words < MIN_WORDS || words > MAX_WORDS) {
    throw new Error(`${label} has ${words} words, outside ${MIN_WORDS}-${MAX_WORDS}`)
  }
  return words
}

function numberSentences(paragraphs) {
  paragraphs.forEach((p, pi) =>
    p.items.forEach((item, si) => {
      item.p = pi + 1
      item.i = si
    }),
  )
  return paragraphs.flatMap((p) => p.items)
}

function makePassage(topic, topicZh, n) {
  const ctx = makeContext(topic, topicZh)
  const paragraphs = Array.from({ length: 5 }, () => ctx.nextParagraph())
  const text = fitToRange(paragraphs, ctx.nextParagraph)
  assertLength(text, `Passage ${n + 4}`)
  const sub = topic.subtopics[Math.floor(n / TOPICS.length) % 5]
  return {
    title: `Passage ${String(n + 4).padStart(3, '0')} · ${topic.name}: ${sub}`,
    text,
    sourceNote: '本项目原创 IELTS 风格练习文本（自动合成，非官方真题）；可自由使用',
    sentences: numberSentences(paragraphs),
  }
}

/** The three hand-written focus passages keep their labelled target sentences
 * and are extended with composed paragraphs to the same reading length. */
const FOCUS_INDEXES = [1, 19, 5]
function extendFocus(original, topic, topicZh, focusZh, focusSkeleton) {
  const ctx = makeContext(topic, topicZh)
  const paragraphs = original.text.split('\n\n').map((text, pi) => ({
    text,
    items: text
      .split(/(?<=\.)\s+/)
      .map((sentence, si) => ({
        text: sentence.trim(),
        zh: focusZh[pi]?.[si] ?? '',
        category: 'FOCUS',
        skeleton: focusSkeleton?.[pi]?.[si],
      })),
  }))
  const text = fitToRange(paragraphs, ctx.nextParagraph)
  assertLength(text, original.title)
  return { ...original, text, sentences: numberSentences(paragraphs) }
}

const focus = ORIGINAL_THREE.map((a, i) =>
  extendFocus(a, TOPICS[FOCUS_INDEXES[i]], TOPIC_ZH[FOCUS_INDEXES[i]], FOCUS_ZH[i], FOCUS_SKELETON[i]),
)
const generated = Array.from({ length: 97 }, (_, i) =>
  makePassage(TOPICS[i % TOPICS.length], TOPIC_ZH[i % TOPICS.length], i),
)
const all = [...focus, ...generated]

const body = all
  .map(
    (a) =>
      `  { title: ${JSON.stringify(a.title)}, text: ${JSON.stringify(a.text)}, sourceNote: ${JSON.stringify(a.sourceNote)} },`,
  )
  .join('\n')

const out = `/* AUTO-GENERATED by scripts/generate-article-bank.mjs — do not edit by hand.
 * 100 ORIGINAL IELTS-style practice passages, each 700-900 words (3 extended
 * hand-written focus passages + 97 deterministically composed academic texts).
 * NOT official past papers and not copied from any copyrighted source.
 * Re-run the generator to rebuild. */
export interface BankArticle {
  title: string
  text: string
  sourceNote: string
}

/** Bump this when the bank content changes so existing databases get refreshed. */
export const ARTICLE_BANK_VERSION = 2

export const ARTICLE_BANK: BankArticle[] = [
${body}
]

export const ARTICLE_BANK_SIZE = ARTICLE_BANK.length
`

writeFileSync(OUT, out, 'utf8')

/* Full offline reference readings + English SVO skeletons, keyed by the exact
 * SentenceId that segmentArticle() computes at runtime. Every built-in
 * sentence (including the focus baselines) carries a complete reading. */
const explRows = []
all.forEach((article, articleIndex) => {
  const articleId = `sample-${articleIndex + 1}`
  const versionHash = contentHash(article.text)
  for (const s of article.sentences) {
    if (!s.zh || !s.text) continue
    explRows.push([
      generatedSentenceId(articleId, versionHash, s.p, s.i, s.text),
      s.zh,
      s.category,
      s.skeleton?.subject ?? '',
      s.skeleton?.predicate ?? '',
      s.skeleton?.object ?? '',
    ])
  }
})
const explOut = `/* AUTO-GENERATED by scripts/generate-article-bank.mjs — do not edit by hand.
 * [sentenceId, Chinese reading, category, English subject, predicate, object]
 * Every sentence in the 100 built-in passages has a complete offline reading
 * and an English subject-predicate-object skeleton from the original sentence.
 * No model call, no network, no fee. */
export type OfflineExplanation = [string, string, string, string, string, string]

export const OFFLINE_EXPLANATIONS: OfflineExplanation[] = [
${explRows.map((r) => `  ${JSON.stringify(r)},`).join('\n')}
]

export const OFFLINE_EXPLANATION_COUNT = OFFLINE_EXPLANATIONS.length
`
mkdirSync(path.dirname(EXPL_OUT), { recursive: true })
writeFileSync(EXPL_OUT, explOut, 'utf8')
console.log(`Wrote ${explRows.length.toLocaleString()} offline explanations (${(Buffer.byteLength(explOut, 'utf8') / 1024).toFixed(0)} KiB)`)

const counts = all.map((a) => wordCount(a.text))
const total = counts.reduce((a, b) => a + b, 0)
console.log(
  `Wrote ${all.length} passages (${total.toLocaleString()} words; ` +
    `min ${Math.min(...counts)}, max ${Math.max(...counts)}, avg ${Math.round(total / all.length)}) ` +
    `to ${OUT} (${(Buffer.byteLength(out, 'utf8') / 1024).toFixed(0)} KiB)`,
)
