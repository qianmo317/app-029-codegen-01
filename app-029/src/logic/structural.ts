/**
 * 门头结构安全核定：
 * - 保守档按最不利风压包络，不逐单复算；
 * - 计算档按实际风压、面积、跨度与高度利用率分档，必须写明翻档条件、复核人和痕迹；
 * - 核定结果生成龙骨、斜撑、拉结点/立柱等加固 BOM；未通过或尺寸改后未重核，拦截报价。
 */

import type {
  Mounting,
  Material,
  Project,
  StructuralConfig,
  StructuralMaterialId,
  StructuralRecord,
  StructuralRoute
} from './types'
import type { LayoutResult } from './layout'

export interface StructuralMaterialSpec {
  id: StructuralMaterialId
  name: string
  thicknesses: number[]
  mountings: Mounting[]
  capacityKpa: Record<string, number>
  unsupportedSpanMm: Record<string, number>
  maxAreaM2: Record<Mounting, number>
  slenderLimit: number
}

export interface StructuralGridPlan {
  cols: number
  rows: number
  count: number
  cellWMm: number
  cellHMm: number
  cells: Array<{ x: number; y: number; w: number; h: number }>
}

export interface StructuralResult {
  fingerprint: string
  route: StructuralRoute
  wMm: number
  hMm: number
  occupiedWMm: number
  occupiedHMm: number
  groundClearanceMm: number
  topHeightMm: number
  thicknessMm: number
  material: StructuralMaterialSpec
  mounting: Mounting
  areaM2: number
  areaLimitM2: number
  areaUtilization: number
  spanUtilization: number
  heightUtilization: number
  pressureUtilization: number
  controlling: string
  windPressureKpa: number
  windForceKn: number
  capacityKpa: number
  grade: number
  gradeLabel: string
  tiePoints: number
  gridTiePoints: number
  forceTiePoints: number
  railsM: number
  verticalMembers: number
  horizontalMembers: number
  posts: number
  postsM: number
  braces: number
  framePerimeterM: number
  gridSpacingMm: number
  pass: boolean
  approved: boolean
  activeRecord: StructuralRecord | null
  blockReasons: string[]
  warnings: string[]
  upgradeConditions: string[]
  recommendations: string[]
  maxWidthAtHeightMm: number | null
  maxHeightAtWidthMm: number | null
  maxSinglePanel: { wMm: number; hMm: number } | null
  gridPlan: StructuralGridPlan | null
  formulas: string[]
}

export const GRADE_LABELS = ['L0 免加固', 'L1 四周边框', 'L2 轻型龙骨+斜撑', 'L3 加密龙骨+斜撑', 'L4 钢架/专项支承']
const GRID_SPACING_MM = [1200, 1000, 800, 600, 400]
const MIN_GRADE: Record<Mounting, number> = { wall: 1, board: 2, freestanding: 3 }
const MAX_TOP_HEIGHT_MM = 15000
const MAX_W: Record<Mounting, number> = { wall: 12000, board: 12000, freestanding: 8000 }
const MAX_H: Record<Mounting, number> = { wall: 3000, board: 3000, freestanding: 6000 }
const CONSERVATIVE_PRESSURE_KPA = 1.5
const BASIC_WIND_PRESSURE_KPA = 0.6
const ALLOWABLE_FORCE_PER_POINT_KN: Record<Mounting, number> = { wall: 0.55, board: 0.55, freestanding: 1.2 }

export const STRUCTURAL_MATERIALS: StructuralMaterialSpec[] = [
  {
    id: 'film',
    name: '贴膜/薄膜面板',
    thicknesses: [0.1, 0.125, 0.15],
    mountings: ['wall'],
    capacityKpa: { '0.1': 0.2, '0.125': 0.25, '0.15': 0.3 },
    unsupportedSpanMm: { '0.1': 400, '0.125': 500, '0.15': 600 },
    maxAreaM2: { wall: 0.8, board: 0, freestanding: 0 },
    slenderLimit: 800
  },
  {
    id: 'pvc',
    name: 'PVC 发泡板',
    thicknesses: [3, 5, 8, 10],
    mountings: ['wall', 'board'],
    capacityKpa: { '3': 0.4, '5': 0.6, '8': 0.9, '10': 1.1 },
    unsupportedSpanMm: { '3': 1200, '5': 1500, '8': 2000, '10': 2400 },
    maxAreaM2: { wall: 2.4, board: 2.0, freestanding: 0 },
    slenderLimit: 300
  },
  {
    id: 'acrylic',
    name: '亚克力整板',
    thicknesses: [3, 5, 8, 10],
    mountings: ['wall', 'board'],
    capacityKpa: { '3': 0.5, '5': 0.8, '8': 1.1, '10': 1.4 },
    unsupportedSpanMm: { '3': 900, '5': 1200, '8': 1600, '10': 2000 },
    maxAreaM2: { wall: 3.0, board: 2.6, freestanding: 0 },
    slenderLimit: 300
  },
  {
    id: 'acm',
    name: '铝塑复合板/金属挂板',
    thicknesses: [3, 4],
    mountings: ['wall', 'board', 'freestanding'],
    capacityKpa: { '3': 1.2, '4': 1.6 },
    unsupportedSpanMm: { '3': 2400, '4': 3000 },
    maxAreaM2: { wall: 6.0, board: 5.2, freestanding: 4.2 },
    slenderLimit: 500
  },
  {
    id: 'steel',
    name: '不锈钢/镀锌钢板',
    thicknesses: [1, 1.2, 1.5, 2],
    mountings: ['wall', 'board', 'freestanding'],
    capacityKpa: { '1': 1.6, '1.2': 2.0, '1.5': 2.5, '2': 3.2 },
    unsupportedSpanMm: { '1': 3000, '1.2': 3500, '1.5': 4000, '2': 5000 },
    maxAreaM2: { wall: 12.0, board: 10.5, freestanding: 8.4 },
    slenderLimit: 800
  }
]

export function mountingText(m: Mounting): string {
  return m === 'wall' ? '贴墙' : m === 'board' ? '挂板' : '独立立牌'
}

export function defaultStructural(): StructuralConfig {
  return {
    groundClearanceMm: 3000,
    thicknessMm: 3,
    materialId: 'acrylic',
    route: 'conservative',
    acceptedBy: '',
    reviewerName: '',
    reviewerRole: '结构负责人',
    traceLocation: '项目结构核定记录 + 报价单/工艺卡附件（本地存档）',
    history: []
  }
}

export function ensureStructural(project: Project): StructuralConfig {
  if (!project.structural) project.structural = defaultStructural()
  const d = defaultStructural()
  const cfg = project.structural
  cfg.groundClearanceMm = Math.round(Number(cfg.groundClearanceMm ?? d.groundClearanceMm))
  cfg.thicknessMm = Number(cfg.thicknessMm ?? d.thicknessMm)
  cfg.materialId = cfg.materialId ?? d.materialId
  cfg.route = cfg.route ?? d.route
  cfg.acceptedBy = cfg.acceptedBy ?? ''
  cfg.reviewerName = cfg.reviewerName ?? ''
  cfg.reviewerRole = cfg.reviewerRole ?? d.reviewerRole
  cfg.traceLocation = cfg.traceLocation ?? d.traceLocation
  cfg.history = Array.isArray(cfg.history) ? cfg.history : []
  return cfg
}

function round1(v: number): number {
  return Math.round(v * 10) / 10
}

function intMm(v: number): number {
  return Math.max(0, Math.round(Number(v) || 0))
}

function materialOf(id: StructuralMaterialId): StructuralMaterialSpec {
  return STRUCTURAL_MATERIALS.find((m) => m.id === id) ?? STRUCTURAL_MATERIALS[0]
}

function exposureFactor(topHeightMm: number): number {
  if (topHeightMm <= 3000) return 0.8
  if (topHeightMm <= 6000) return 1.0
  if (topHeightMm <= 10000) return 1.15
  return 1.3
}

function shapeFactor(mounting: Mounting): number {
  return mounting === 'wall' ? 0.8 : mounting === 'board' ? 1.0 : 1.2
}

function mountCapacityFactor(mounting: Mounting): number {
  return mounting === 'wall' ? 1.0 : mounting === 'board' ? 0.85 : 0.65
}

function gradeFromUtilization(util: number): number {
  if (util < 55) return 0
  if (util < 75) return 1
  if (util < 90) return 2
  if (util < 100) return 3
  return 4
}

function nearestThickness(material: StructuralMaterialSpec, thickness: number): number {
  return material.thicknesses.reduce((a, b) => (Math.abs(b - thickness) < Math.abs(a - thickness) ? b : a))
}

export function structuralFingerprint(project: Project, layout: LayoutResult | null, cfg: StructuralConfig): string {
  const p = project.layout.panel
  const payload = {
    w: intMm(p.wMm),
    h: intMm(p.hMm),
    ow: intMm(layout?.occupiedW ?? 0),
    oh: intMm(layout?.occupiedH ?? 0),
    m: p.mounting,
    g: intMm(cfg.groundClearanceMm),
    t: round1(cfg.thicknessMm),
    mat: cfg.materialId,
    route: cfg.route,
    frame: intMm(p.frameMm)
  }
  return JSON.stringify(payload)
}

function maxWidthAtHeight(h: number, areaLimit: number, maxW: number, maxH: number): number | null {
  if (h <= 0 || h > maxH) return null
  return Math.min(maxW, Math.floor((areaLimit * 1_000_000) / Math.max(1, h)))
}

function maxHeightAtWidth(w: number, areaLimit: number, maxW: number, maxH: number): number | null {
  if (w <= 0 || w > maxW) return null
  return Math.min(maxH, Math.floor((areaLimit * 1_000_000) / Math.max(1, w)))
}

function balancedPanel(areaLimit: number, maxW: number, maxH: number): { wMm: number; hMm: number } | null {
  if (areaLimit <= 0) return null
  let best = { w: 0, h: 0, score: -1 }
  for (let h = 500; h <= maxH; h += 50) {
    const w = Math.min(maxW, Math.floor((areaLimit * 1_000_000) / h))
    const ratio = w / h
    if (w >= 500 && ratio <= 3.0) {
      const score = (w * h) / 1_000_000 - Math.abs(ratio - 2.5) * 0.02
      if (score > best.score) best = { w, h, score }
    }
  }
  return best.w > 0 ? { wMm: best.w, hMm: best.h } : null
}

export function buildGridPlan(totalW: number, totalH: number, areaLimitM2: number, maxW: number, maxH: number): StructuralGridPlan | null {
  const cellLimit = areaLimitM2 * 1_000_000
  let best: StructuralGridPlan | null = null
  for (let cols = 1; cols <= 8; cols++) {
    for (let rows = 1; rows <= 6; rows++) {
      const cellW = Math.ceil(totalW / cols)
      const cellH = Math.ceil(totalH / rows)
      if (cellW > maxW || cellH > maxH || cellW * cellH > cellLimit) continue
      const ratio = Math.max(cellW / Math.max(1, cellH), cellH / Math.max(1, cellW))
      if (ratio > 4.0) continue
      const cells = []
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = Math.round((c * totalW) / cols)
          const y = Math.round((r * totalH) / rows)
          const nx = Math.round(((c + 1) * totalW) / cols)
          const ny = Math.round(((r + 1) * totalH) / rows)
          cells.push({ x, y, w: nx - x, h: ny - y })
        }
      }
      const plan: StructuralGridPlan = { cols, rows, count: cols * rows, cellWMm: cellW, cellHMm: cellH, cells }
      if (!best || plan.count < best.count || (plan.count === best.count && Math.abs(ratio - 1.5) < Math.abs(best.cellWMm / best.cellHMm - 1.5))) {
        best = plan
      }
    }
  }
  return best
}

export function assessStructure(project: Project, layout: LayoutResult | null): StructuralResult {
  const cfg = ensureStructural(project)
  const panel = project.layout.panel
  const w = intMm(panel.wMm)
  const h = intMm(panel.hMm)
  const occupiedW = intMm(layout?.occupiedW ?? 0)
  const occupiedH = intMm(layout?.occupiedH ?? 0)
  const mounting = panel.mounting
  const ground = Math.max(0, intMm(cfg.groundClearanceMm))
  const top = ground + h
  const material = materialOf(cfg.materialId)
  const closest = nearestThickness(material, cfg.thicknessMm)
  const thicknessSupported = material.thicknesses.some((t) => Math.abs(t - cfg.thicknessMm) < 0.001)
  const thickness = thicknessSupported ? cfg.thicknessMm : closest
  const capacity = round1(material.capacityKpa[String(thickness)] * mountCapacityFactor(mounting))
  const allowedSpan = material.unsupportedSpanMm[String(thresholdKey(thickness))] ?? material.unsupportedSpanMm[String(thickness)] ?? 0
  const area = round1((w * h) / 1_000_000)
  const areaLimit = round1(material.maxAreaM2[mounting])
  const unsupportedLong = Math.max(w, h)
  const areaUtil = areaLimit > 0 ? round1((area / areaLimit) * 100) : 999
  const heightUtil = round1((top / MAX_TOP_HEIGHT_MM) * 100)
  const pressure = cfg.route === 'conservative'
    ? CONSERVATIVE_PRESSURE_KPA
    : round1(BASIC_WIND_PRESSURE_KPA * exposureFactor(top) * shapeFactor(mounting))
  const pressureUtil = capacity > 0 ? round1((pressure / capacity) * 100) : 999
  const windForce = round1(pressure * area)
  const baseUtils = cfg.route === 'conservative' ? [areaUtil, heightUtil] : [pressureUtil, areaUtil, heightUtil]
  let grade = Math.max(gradeFromUtilization(Math.max(...baseUtils, 0)), MIN_GRADE[mounting])
  if (grade > 4) grade = 4
  while (grade < 4 && allowedSpan > 0 && GRID_SPACING_MM[grade] > allowedSpan) grade++
  const spanUtil = allowedSpan > 0 ? round1((GRID_SPACING_MM[grade] / allowedSpan) * 100) : 0

  const blockReasons: string[] = []
  const warnings: string[] = []
  if (!Number.isFinite(panel.wMm) || !Number.isFinite(panel.hMm) || w <= 0 || h <= 0) blockReasons.push('尺寸无效：总宽、总高必须为正整数毫米')
  if (!material.mountings.includes(mounting)) {
    blockReasons.push(`材质不匹配：${material.name}不能用于${mountingText(mounting)}，请改贴墙/PVC/亚克力/金属板方案`)
  }
  if (!thicknessSupported) {
    blockReasons.push(`材质不匹配：${material.name}无 ${cfg.thicknessMm}mm 规格，可选 ${material.thicknesses.join('/')}mm；最接近为 ${thickness}mm`)
  }
  if (w > MAX_W[mounting]) blockReasons.push(`宽度超了：${wMmText(w)} 超过${mountingText(mounting)}加工/运输上限 ${MAX_W[mounting]}mm`)
  if (h > MAX_H[mounting]) blockReasons.push(`高度超了：${h}mm 超过${mountingText(mounting)}单牌上限 ${MAX_H[mounting]}mm`)
  if (top > MAX_TOP_HEIGHT_MM) blockReasons.push(`高度超了：牌顶离地 ${top}mm 超过上限 ${MAX_TOP_HEIGHT_MM}mm`)
  if (areaLimit <= 0 || areaUtil > 100) blockReasons.push(`面积超了：当前 ${area.toFixed(2)}㎡，该材质/安装方式最多 ${areaLimit.toFixed(1)}㎡`)
  if (cfg.route === 'calculated' && pressureUtil > 100) blockReasons.push(`风压受力超了：计算风压 ${pressure}kPa，为面板抗力 ${capacity}kPa 的 ${pressureUtil}%`)
  if (spanUtil > 100) blockReasons.push(`跨度/板厚不匹配：${thickness}mm ${material.name}即使升至 ${GRADE_LABELS[grade]}，最小分格间距 ${GRID_SPACING_MM[grade]}mm 仍大于裸板允许跨度 ${allowedSpan}mm`)
  else if (unsupportedLong > allowedSpan) warnings.push(`长边 ${unsupportedLong}mm 超过 ${thickness}mm ${material.name}裸板跨度 ${allowedSpan}mm：已要求按 ≤${GRID_SPACING_MM[grade]}mm 布置龙骨/拉结，安装不得遗漏`)

  const totalRatio = round1(Math.max(w / h, h / w))
  if (totalRatio > 4.0) warnings.push(`门头总宽高比 ${totalRatio} > 4.0：长向迎风面易振颤，建议分格、缩短跨度或加密龙骨`)
  if (occupiedW > 0 && occupiedH > 0) {
    const occupiedRatio = round1(Math.max(occupiedW / occupiedH, occupiedH / occupiedW))
    if (occupiedRatio > 5.0) warnings.push(`排版后实际宽高比 ${occupiedRatio} > 5.0：字形/牌面过扁或过窄，建议分格或改字号`)
    const occupiedLong = Math.max(occupiedW, occupiedH)
    const occupiedSlender = round1(occupiedLong / thickness)
    if (occupiedSlender > material.slenderLimit) warnings.push(`排版后长细比 ${occupiedSlender} > ${material.slenderLimit}（实际最长边/板厚）：边缘易振颤，需加密龙骨`)
    const totalSlender = round1(unsupportedLong / thickness)
    if (totalSlender > material.slenderLimit) warnings.push(`整牌长细比 ${totalSlender} > ${material.slenderLimit}（总宽/板厚）：运输与安装阶段需临时加固`)
  }
  if (mounting === 'freestanding') {
    const systemSlender = round1(top / Math.min(w, h))
    if (systemSlender > 8.0) warnings.push(`立牌系统长细比 ${systemSlender} > 8.0：根部弯矩大，建议加宽牌面或增加柱距/斜撑`)
  } else if (ground > 6000) {
    warnings.push(`牌底下沿离地 ${ground}mm：高处阵风脉动增大，计算档应提高现场核查频率`)
  }

  const pass = blockReasons.length === 0
  const maxWidth = pass ? null : maxWidthAtHeight(h, Math.max(0, areaLimit), MAX_W[mounting], MAX_H[mounting])
  const maxHeight = pass ? null : maxHeightAtWidth(w, Math.max(0, areaLimit), MAX_W[mounting], MAX_H[mounting])
  const maxSingle = pass ? null : balancedPanel(Math.max(0, areaLimit), MAX_W[mounting], MAX_H[mounting])
  const gridPlan = pass ? null : buildGridPlan(w, h, Math.max(0, areaLimit), MAX_W[mounting], MAX_H[mounting])

  const gridSpacing = GRID_SPACING_MM[Math.max(0, Math.min(4, grade))]
  const gridCols = Math.max(1, Math.ceil(w / gridSpacing))
  const gridRows = Math.max(1, Math.ceil(h / gridSpacing))
  let gridTie = mounting === 'freestanding' ? Math.max(2, gridCols) : gridCols * gridRows
  gridTie = Math.max(mounting === 'wall' ? 4 : mounting === 'board' ? 4 : 2, gridTie)
  const forceTie = Math.max(mounting === 'freestanding' ? 2 : 4, Math.ceil(windForce / ALLOWABLE_FORCE_PER_POINT_KN[mounting]))
  const tiePoints = cfg.route === 'conservative' ? gridTie : Math.max(gridTie, forceTie)

  const horizontalMembers = grade <= 1 ? 2 : grade === 2 ? 2 : grade === 3 ? 3 : 4
  const posts = mounting === 'freestanding' ? tiePoints : 0
  const verticalMembers = mounting === 'freestanding' ? posts : gridCols
  const railsM = round1(((mounting === 'freestanding' ? 0 : verticalMembers * h) + horizontalMembers * w) / 1000)
  const postsM = mounting === 'freestanding' ? round1((posts * top) / 1000) : 0
  const wallBraceSets = Math.max(1, Math.ceil(w / 2000))
  const braces = mounting === 'freestanding' ? posts * 2 : grade === 2 ? 2 * wallBraceSets : grade >= 3 ? 4 * wallBraceSets : 0
  const framePerimeterM = grade >= 4 ? round1((w + h) * 2 / 1000) : 0

  const controllingNames: Record<string, number> =
    cfg.route === 'conservative'
      ? { 面积利用率: areaUtil, 跨度利用率: spanUtil, 高度利用率: heightUtil }
      : { 风压利用率: pressureUtil, 面积利用率: areaUtil, 跨度利用率: spanUtil, 高度利用率: heightUtil }
  const controlling = Object.entries(controllingNames).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
  const fingerprint = structuralFingerprint(project, layout, cfg)
  const activeRecord = cfg.history.find((r) => r.pass && r.fingerprint === fingerprint) ?? null
  const approved = pass && !!activeRecord

  const upgradeConditions = [
    `任一分档利用率达到 75.0% 翻 L2，达到 90.0% 翻 L3，达到 100.0% 不得按计算档放行`,
    `安装方式最低档：贴墙 L1、挂板 L2、独立立牌 L3；改安装方式须立即重核`,
    `总宽/总高、离地高度、板厚、材质、实际占宽占高或路线任一项改变，原核定指纹立即失效`
  ]
  const recommendations = [
    grade === 0 ? '当前可免结构加固，仍按常规包边和防水处理' : `按 ${GRADE_LABELS[grade]} 加固，拉结/立柱点按 ≤${gridSpacing}mm 间距布置`,
    mounting === 'freestanding'
      ? `立柱 ${posts} 根，柱顶/柱脚双向斜撑 ${braces} 根，柱脚需做基础预埋件或化学锚栓`
      : `墙面/挂板拉结点 ${tiePoints} 个，斜撑 ${braces} 根；节点避开空心砖、抹灰层和旧墙面松动区`,
    `加固材料须与面板同寿命：金属接触处做绝缘垫片，钢件热镀锌或防腐涂装`
  ]
  if (cfg.route === 'calculated') {
    recommendations.push('计算档翻 L3/L4 后由结构负责人复核重算；签字记录与本报价单、导出清单一并存档')
  } else {
    recommendations.push('保守档已按最不利风压包络，常规尺寸范围内可免逐单结构复算；现场发现墙体/基础异常仍须停工上报')
  }

  const formulas = [
    `计算风压 q = 基本风压 ${BASIC_WIND_PRESSURE_KPA}kPa × 高度系数 ${round1(exposureFactor(top))} × 体形系数 ${round1(shapeFactor(mounting))} = ${pressure}kPa；保守档固定 ${CONSERVATIVE_PRESSURE_KPA}kPa`,
    `风荷载 F = q × 面积 = ${pressure} × ${area.toFixed(2)} = ${windForce}kN；单点允许拉力 ${ALLOWABLE_FORCE_PER_POINT_KN[mounting]}kN`,
    `分档利用率：风压 ${pressureUtil}% / 面积 ${areaUtil}% / 跨度 ${spanUtil}% / 高度 ${heightUtil}%，控制项：${controlling}`
  ]

  if (!pass) {
    recommendations.splice(0, recommendations.length, '本单当场拦截：先按下方最大尺寸或分格方案修改，修改后必须重新核定并签字')
  }

  return {
    fingerprint,
    route: cfg.route,
    wMm: w,
    hMm: h,
    occupiedWMm: occupiedW,
    occupiedHMm: occupiedH,
    groundClearanceMm: ground,
    topHeightMm: top,
    thicknessMm: thickness,
    material,
    mounting,
    areaM2: area,
    areaLimitM2: areaLimit,
    areaUtilization: areaUtil,
    spanUtilization: spanUtil,
    heightUtilization: heightUtil,
    pressureUtilization: pressureUtil,
    controlling,
    windPressureKpa: pressure,
    windForceKn: windForce,
    capacityKpa: capacity,
    grade,
    gradeLabel: GRADE_LABELS[grade],
    tiePoints,
    gridTiePoints: gridTie,
    forceTiePoints: forceTie,
    railsM,
    verticalMembers,
    horizontalMembers,
    posts,
    postsM,
    braces,
    framePerimeterM,
    gridSpacingMm: gridSpacing,
    pass,
    approved,
    activeRecord,
    blockReasons,
    warnings,
    upgradeConditions,
    recommendations,
    maxWidthAtHeightMm: maxWidth,
    maxHeightAtWidthMm: maxHeight,
    maxSinglePanel: maxSingle,
    gridPlan,
    formulas
  }
}

function thresholdKey(t: number): string {
  return String(t)
}

function wMmText(w: number): string {
  return `${w}mm`
}

const KEEL_PRICE_CENTS = [1800, 1800, 2600, 3800, 5200]
const POST_PRICE_CENTS = 4500
const BRACE_PRICE_CENTS = 6800
const ANCHOR_PRICE_CENTS = 1800
const FRAME_PRICE_CENTS = 6800
const LABOR_CENTS = [0, 12000, 24000, 48000, 90000]

export function structuralMaterials(result: StructuralResult): Material[] {
  if (!result.pass) return []
  const out: Material[] = []
  const grade = result.grade
  if (result.mounting === 'freestanding') {
    if (result.postsM > 0) {
      out.push(materialRow('structural', `镀锌钢立柱（${result.gradeLabel}，含底板/预埋连接）`, result.postsM, '米', POST_PRICE_CENTS))
    }
  } else if (result.railsM > 0) {
    out.push(materialRow('structural', `轻钢/镀锌方通龙骨 ${grade >= 3 ? '40×60' : '30×50'}（${result.gradeLabel}）`, result.railsM, '米', KEEL_PRICE_CENTS[grade]))
  }
  if (result.railsM > 0 && result.mounting === 'freestanding') {
    out.push(materialRow('structural', `牌面横向龙骨/圈梁（${result.gradeLabel}）`, result.railsM, '米', KEEL_PRICE_CENTS[grade]))
  }
  if (result.tiePoints > 0 && result.mounting !== 'freestanding') {
    out.push(materialRow('structural', `M12 化学锚栓/不锈钢膨胀拉结套件（@${result.gridSpacingMm}mm）`, result.tiePoints, '套', ANCHOR_PRICE_CENTS))
  }
  if (result.mounting === 'freestanding') {
    out.push(materialRow('structural', '立柱基础预埋件/地脚锚栓套件', result.posts, '套', 4200))
  }
  if (result.braces > 0) {
    out.push(materialRow('structural', result.mounting === 'freestanding' ? '双向钢斜撑（含节点板）' : '墙面三角斜撑（40×40 角钢）', result.braces, '根', BRACE_PRICE_CENTS))
  }
  if (result.framePerimeterM > 0) {
    out.push(materialRow('structural', '钢架外框/专项支承（焊接、热镀锌防腐）', result.framePerimeterM, '米', FRAME_PRICE_CENTS))
  }
  if (LABOR_CENTS[grade] > 0) {
    out.push(materialRow('structural', `加固安装人工（放线、焊接/栓接、防腐、复测）`, 1, '项', LABOR_CENTS[grade]))
  }
  return out
}

function materialRow(kind: Material['kind'], spec: string, qty: number, unit: string, unitPriceCents: number): Material {
  return { kind, spec, qty, unit, unitPriceCents, amountCents: Math.round(qty * unitPriceCents) }
}

export function issueStructuralConclusion(project: Project, result: StructuralResult): { ok: boolean; errors: string[] } {
  const cfg = ensureStructural(project)
  const errors: string[] = []
  if (!result.pass) errors.push('核定不通过，不能出具结论')
  if (!cfg.acceptedBy.trim()) errors.push(result.route === 'conservative' ? '请填写现场负责人' : '请填写计算/编制人')
  if (result.route === 'calculated') {
    if (!cfg.reviewerName.trim()) errors.push('计算档必须填写翻档复核人')
    if (!cfg.reviewerRole.trim()) errors.push('计算档必须填写复核岗位')
  }
  if (!cfg.traceLocation.trim()) errors.push('请写明痕迹留存位置')
  if (errors.length) return { ok: false, errors }

  const record: StructuralRecord = {
    id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    at: Date.now(),
    pass: true,
    route: result.route,
    fingerprint: result.fingerprint,
    acceptedBy: cfg.acceptedBy.trim(),
    reviewerName: cfg.reviewerName.trim(),
    reviewerRole: cfg.reviewerRole.trim(),
    traceLocation: cfg.traceLocation.trim(),
    input: {
      wMm: result.wMm,
      hMm: result.hMm,
      occupiedWMm: result.occupiedWMm,
      occupiedHMm: result.occupiedHMm,
      mounting: result.mounting,
      groundClearanceMm: result.groundClearanceMm,
      topHeightMm: result.topHeightMm,
      thicknessMm: result.thicknessMm,
      materialId: result.material.id
    },
    summary: {
      grade: result.grade,
      gradeLabel: result.gradeLabel,
      tiePoints: result.tiePoints,
      windPressureKpa: result.windPressureKpa,
      windForceKn: result.windForceKn,
      areaM2: result.areaM2,
      blockReasons: result.blockReasons,
      warnings: result.warnings
    }
  }
  const existingIndex = cfg.history.findIndex((r) => r.pass && r.fingerprint === result.fingerprint)
  if (existingIndex >= 0) cfg.history.splice(existingIndex, 1)
  cfg.history.unshift(record)
  cfg.history = cfg.history.slice(0, 20)
  return { ok: true, errors: [] }
}

export interface StructuralDiffRow {
  label: string
  before: string
  after: string
  changed: boolean
}

export function diffStructuralRecords(previous: StructuralRecord | null, current: StructuralRecord | null): StructuralDiffRow[] {
  if (!current) return []
  const p = previous
  const rows: StructuralDiffRow[] = [
    row('时间', p ? new Date(p.at).toLocaleString('zh-CN') : '无上一份', new Date(current.at).toLocaleString('zh-CN')),
    row('路线', p?.route === 'conservative' ? '保守档' : '计算档', current.route === 'conservative' ? '保守档' : '计算档'),
    row('总宽×总高', p ? `${p.input.wMm}×${p.input.hMm}mm` : '—', `${current.input.wMm}×${current.input.hMm}mm`),
    row('实际占宽×占高', p ? `${p.input.occupiedWMm}×${p.input.occupiedHMm}mm` : '—', `${current.input.occupiedWMm}×${current.input.occupiedHMm}mm`),
    row('离地/牌顶', p ? `${p.input.groundClearanceMm}/${p.input.topHeightMm}mm` : '—', `${current.input.groundClearanceMm}/${current.input.topHeightMm}mm`),
    row('材质/厚度', p ? `${p.input.materialId} ${p.input.thicknessMm}mm` : '—', `${current.input.materialId} ${current.input.thicknessMm}mm`),
    row('加固等级', p?.summary.gradeLabel ?? '—', current.summary.gradeLabel),
    row('拉结点数', p ? String(p.summary.tiePoints) : '—', String(current.summary.tiePoints)),
    row('风压/风力', p ? `${p.summary.windPressureKpa}kPa/${p.summary.windForceKn}kN` : '—', `${current.summary.windPressureKpa}kPa/${current.summary.windForceKn}kN`),
    row('签字', p ? `${p.acceptedBy}${p.reviewerName ? ` / ${p.reviewerName}` : ''}` : '—', `${current.acceptedBy}${current.reviewerName ? ` / ${current.reviewerName}` : ''}`),
    row('痕迹', p?.traceLocation ?? '—', current.traceLocation)
  ]
  return rows
}

function row(label: string, before: string, after: string): StructuralDiffRow {
  return { label, before, after, changed: before !== after }
}
