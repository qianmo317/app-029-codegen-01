/**
 * 门头结构安全核定：
 * - 输入宽高（mm 取整）、离地高度、安装方式、面板材质/厚度；
 * - 输出加固等级（G1~G4）、龙骨/斜撑/立柱/拉结点用量与反算分格；
 * - 保守档按最不利组合，计算档按实际风压面积并写明翻档条件、复核人、留痕位置。
 *
 * 这是一套广告门头制作前的工艺级简化核定，不替代注册结构工程师对超限工程的正式施工图。
 */

import type { LayoutResult } from './layout'
import type {
  Mounting,
  Project,
  StructuralBlockReason,
  StructuralCfg,
  StructuralMaterialId,
  StructuralRequirement,
  StructuralResult,
  StructuralReviewRecord,
  StructuralRoute
} from './types'
import type { StructuralMaterialSpec, StructuralPreset } from './materials'

const r1 = (v: number): number => Math.round(v * 10) / 10
const intMm = (v: number): number => Math.max(0, Math.round(Number(v) || 0))
const gradeOfDemand = (demand: number, thresholds: StructuralPreset['gradeDemandKn']): 1 | 2 | 3 | 4 => {
  if (demand <= thresholds[0]) return 1
  if (demand <= thresholds[1]) return 2
  if (demand <= thresholds[2]) return 3
  return 4
}
const clampGrade = (g: number): 1 | 2 | 3 | 4 => Math.min(4, Math.max(1, Math.round(g))) as 1 | 2 | 3 | 4

export function defaultStructuralCfg(): StructuralCfg {
  return {
    clearanceMm: 3000,
    materialId: 'aluminum_plastic',
    thicknessMm: 3,
    route: 'conservative',
    reviewer: '',
    reviewerTitle: '结构负责人',
    reviews: []
  }
}

export function structuralMaterial(preset: StructuralPreset, id: StructuralMaterialId): StructuralMaterialSpec {
  return preset.materials.find((m) => m.id === id) ?? preset.materials[0]
}

export function mountingStructureFactor(m: Mounting): number {
  return m === 'wall' ? 1.0 : m === 'board' ? 1.2 : 1.5
}

export function mountingMinGrade(m: Mounting): 1 | 2 | 3 | 4 {
  return m === 'wall' ? 1 : m === 'board' ? 2 : 3
}

function heightFactor(topMm: number): number {
  if (topMm <= 6000) return 1.0
  if (topMm <= 10000) return 1.1
  if (topMm <= 15000) return 1.2
  if (topMm <= 20000) return 1.35
  return 1.5
}

function req(qty: number, unit: string, spec: string, note: string): StructuralRequirement {
  return { qty: Math.round(qty * 100) / 100, unit, spec, note }
}

function recommendedGrid(
  wMm: number,
  hMm: number,
  material: StructuralMaterialSpec,
  preset: StructuralPreset,
  areaM2: number
): { cols: number; rows: number; cells: StructuralResult['gridCells'] } {
  const safeAreaM2 = Math.max(0.1, material.maxAreaM2 * 0.9)
  const colsByWidth = Math.ceil(wMm / preset.maxGridWidthMm)
  const rowsByHeight = Math.ceil(hMm / preset.maxGridHeightMm)
  const areaUnits = Math.ceil(areaM2 / safeAreaM2)
  const colsByShape = Math.max(1, Math.ceil(Math.sqrt(areaUnits * (wMm / Math.max(1, hMm)))))
  const cols = Math.max(1, colsByWidth, colsByShape)
  const rows = Math.max(1, rowsByHeight, Math.ceil(areaUnits / cols))
  const cellW = Math.floor(wMm / cols)
  const cellH = Math.floor(hMm / rows)
  const cells: StructuralResult['gridCells'] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cw = c === cols - 1 ? wMm - cellW * (cols - 1) : cellW
      const ch = r === rows - 1 ? hMm - cellH * (rows - 1) : cellH
      cells.push({ no: r * cols + c + 1, wMm: cw, hMm: ch })
    }
  }
  return { cols, rows, cells }
}

export function computeStructural(
  project: Project,
  layout: Pick<LayoutResult, 'occupiedW' | 'occupiedH' | 'overflowX' | 'overflowY'>,
  preset: StructuralPreset,
  routeOverride?: StructuralRoute
): StructuralResult {
  const cfg = project.structural ?? defaultStructuralCfg()
  const route = routeOverride ?? cfg.route
  const panel = project.layout.panel
  const wMm = intMm(panel.wMm)
  const hMm = intMm(panel.hMm)
  const clearanceMm = intMm(cfg.clearanceMm)
  const occupiedWMm = intMm(layout.occupiedW)
  const occupiedHMm = intMm(layout.occupiedH)
  const topHeightMm = clearanceMm + hMm
  const areaM2 = r1((wMm * hMm) / 1e6)
  const material = structuralMaterial(preset, cfg.materialId)
  const mounting = panel.mounting
  const hfRaw = route === 'conservative' ? Math.max(heightFactor(topHeightMm), 1.1) : heightFactor(topHeightMm)
  const mfRaw = mountingStructureFactor(panel.mounting)
  const thicknessOk = material.thicknesses.length === 0 || material.thicknesses.includes(cfg.thicknessMm)
  const effectiveThicknessMm =
    material.thicknesses.length === 0 ? material.minThicknessMm : Math.max(0, Number(cfg.thicknessMm) || material.minThicknessMm)
  const thicknessPenalty = effectiveThicknessMm >= material.minThicknessMm ? 1 : material.minThicknessMm / Math.max(0.1, effectiveThicknessMm)
  const matFRaw = material.factor * (route === 'conservative' ? thicknessPenalty : 1)
  const windPressureKpa = r1(preset.basicWindPressureKpa)
  const safetyFactor = route === 'conservative' ? 1.3 : 1.0
  const demandKn = r1(preset.basicWindPressureKpa * areaM2 * hfRaw * mfRaw * matFRaw * safetyFactor)
  const conservativeDemandKn = r1(preset.basicWindPressureKpa * areaM2 * hfRaw * mfRaw * matFRaw * 1.3)
  const heightFactor1 = r1(hfRaw)
  const mountingFactor1 = r1(mfRaw)
  const materialFactor1 = r1(matFRaw)

  const demandGrade = gradeOfDemand(demandKn, preset.gradeDemandKn)
  const calculatedGrade = clampGrade(Math.max(demandGrade, mountingMinGrade(mounting), material.minGrade))
  const conservativeBase = clampGrade(Math.max(gradeOfDemand(conservativeDemandKn, preset.gradeDemandKn), mountingMinGrade(mounting), material.minGrade))
  const conservativeGrade = conservativeBase
  const grade = route === 'conservative' ? conservativeGrade : calculatedGrade

  const recommended = recommendedGrid(wMm, hMm, material, preset, areaM2)
  const gridCols = grade >= 3 ? Math.max(recommended.cols, Math.ceil(wMm / 1200)) : Math.max(1, Math.ceil(wMm / (grade === 1 ? 1800 : grade === 2 ? 1500 : 1200)))
  const gridRows = grade >= 3 ? Math.max(recommended.rows, Math.ceil(hMm / 1200)) : Math.max(1, Math.ceil(hMm / (grade === 1 ? 1500 : grade === 2 ? 1200 : 1000)))
  const verticals = gridCols + 1
  const horizontals = gridRows + 1
  const keelM = r1(verticals * (hMm / 1000) + horizontals * (wMm / 1000))
  const keelSpec = [
    '30×30mm 镀锌方管/铝合金背筋，四周封边',
    '40×40×2.0mm 镀锌方管主次龙骨',
    '50×50×2.5mm 镀锌方管，主龙骨贯通',
    '60×60×3.0mm 方管 + 中间加密横档，节点加连接板'
  ][grade - 1]

  let braceQty = 0
  let braceSpec = ''
  let braceNote = ''
  const cellDiagM = Math.sqrt((wMm / gridCols) ** 2 + (hMm / gridRows) ** 2) / 1000
  if (panel.mounting === 'freestanding') {
    const braceGroups = gridCols * gridRows * 2
    braceQty = braceGroups * cellDiagM
    braceSpec = 'L40 角钢 X 形斜撑'
    braceNote = `${braceGroups} 组前后两面交叉，防止框架平行四边形变形`
  } else if (panel.mounting === 'board') {
    const braceCount = Math.max(grade * 2, Math.ceil(wMm / 1500) + 1)
    braceQty = braceCount * 0.8
    braceSpec = 'L50×5 角钢三角斜撑 / 抗风撑'
    braceNote = `${braceCount} 根；上部拉结点受力时，斜撑承担反向力矩`
  } else {
    const braceCount = grade === 1 ? 0 : grade === 2 ? 4 : grade === 3 ? 6 : 8
    braceQty = braceCount * 0.4
    braceSpec = grade <= 2 ? '四角防晃角码' : 'L40×4 墙角斜撑'
    braceNote = braceCount ? `${braceCount} 处；防止板面与墙面空鼓晃动` : '贴墙且面积较小时可不设斜撑'
  }

  const postHeightM = (clearanceMm + hMm + 500) / 1000
  const postQty = panel.mounting === 'freestanding' ? verticals : 0
  const postSpec = grade <= 2 ? '80×80×3.0mm 镀锌立柱' : grade === 3 ? '100×100×4.0mm 镀锌立柱' : '120×120×5.0mm 镀锌立柱（需正式结构施工图）'
  const posts = postQty ? req(postQty * postHeightM, '米', postSpec, `按 ${verticals} 根立柱、入土/基座 500mm 计`) : null

  const nodeCount = verticals * horizontals
  const anchorCapacityKn = panel.mounting === 'freestanding' ? 1.5 : panel.mounting === 'board' ? 1.2 : 1.0
  const tieDemandKn = route === 'conservative' ? conservativeDemandKn : demandKn
  const loadTies = Math.ceil(tieDemandKn / anchorCapacityKn)
  const minTies = panel.mounting === 'freestanding' ? grade * 4 : panel.mounting === 'board' ? grade * 4 : grade * 2
  const baseTies = Math.max(panel.mounting === 'freestanding' ? postQty * 4 : nodeCount, loadTies, minTies)
  const tiePoints = route === 'conservative' ? Math.max(Math.ceil(baseTies * 1.2), minTies + 2) : baseTies
  const anchorSpec =
    panel.mounting === 'freestanding'
      ? 'M16 化学锚栓 + 预埋钢板（含柱间附加埋件）'
      : panel.mounting === 'board'
        ? 'M12 不锈钢挂件/化学锚栓，上2下1交错'
        : 'M10 膨胀螺栓 + 防松垫片'
  const anchors = req(tiePoints, '套', anchorSpec, `单点容许抗拔约 ${anchorCapacityKn}kN，按风力反算不少于 ${loadTies} 点`)

  const requirements: StructuralRequirement[] = [
    req(keelM, '米', keelSpec, `${gridCols} 列×${gridRows} 行分格：竖龙骨 ${verticals} 道、横龙骨 ${horizontals} 道`),
    req(r1(braceQty), braceQty ? '米' : '处', braceSpec, braceNote),
    anchors
  ]
  if (posts) requirements.splice(2, 0, posts)

  const blockReasons: StructuralBlockReason[] = []
  const addBlock = (code: StructuralBlockReason['code'], message: string, actualText: string, limitText: string): void => {
    blockReasons.push({ code, message, actualText, limitText })
  }
  if (wMm > material.maxWidthMm) {
    addBlock('area', `门头总宽超过「${material.name}」可核定上限`, `宽 ${wMm}mm`, `最大宽 ${material.maxWidthMm}mm`)
  }
  if (hMm > material.maxHeightMm) {
    addBlock('height', `门头总高超过「${material.name}」可核定上限`, `高 ${hMm}mm`, `最大高 ${material.maxHeightMm}mm`)
  }
  if (areaM2 > material.maxAreaM2) {
    addBlock('area', `受风面积超过「${material.name}」可核定上限`, `面积 ${areaM2}㎡`, `最大面积 ${r1(material.maxAreaM2)}㎡`)
  }
  if (!material.mountings.includes(panel.mounting)) {
    addBlock('mounting', `材质与安装方式不匹配：${material.name}不允许当前安装方式`, `当前 ${panel.mounting}`, `允许 ${material.mountings.join(' / ')}`)
  }
  if (material.thicknesses.length > 0 && (!thicknessOk || effectiveThicknessMm < material.minThicknessMm)) {
    addBlock(
      'material',
      `面板厚度与材质不匹配：${material.name}厚度不足或不在库内规格中`,
      `厚度 ${cfg.thicknessMm}mm`,
      `最低 ${material.minThicknessMm}mm；可选 ${material.thicknesses.join('/')}mm`
    )
  }
  if (layout.overflowX || layout.overflowY) {
    addBlock(
      'layout',
      '排版后实际占宽/占高超出面板，结构核定不能按未排下的版面通过',
      `占宽 ${occupiedWMm}mm × 占高 ${occupiedHMm}mm`,
      `面板 ${wMm}mm × ${hMm}mm`
    )
  }
  if (route === 'calculated' && !cfg.reviewer.trim()) {
    addBlock(
      'material',
      '计算档必须写明翻档后由谁复核重算并担责，责任不能空着',
      '复核人为空',
      grade >= 3 ? 'G3 结构负责人；G4 注册结构工程师/幕墙工程师' : '结构负责人'
    )
  }
  if (route === 'calculated' && grade === 4 && !/(工程师|设计|幕墙|结构师)/.test(cfg.reviewerTitle)) {
    addBlock('material', 'G4 超出店内工艺核定范围，计算档须由注册结构/幕墙工程师复核', cfg.reviewerTitle || '未填写身份', '注册结构工程师或幕墙工程师')
  }

  const maxWidthByAreaMm = Math.floor((material.maxAreaM2 * 1e6) / Math.max(1, hMm))
  const maxHeightByAreaMm = Math.floor((material.maxAreaM2 * 1e6) / Math.max(1, wMm))
  const maxWidthMm = Math.min(material.maxWidthMm, maxWidthByAreaMm)
  const maxHeightMm = Math.min(material.maxHeightMm, maxHeightByAreaMm)
  const compatibleMaterials = preset.materials
    .filter(
      (m) =>
        m.id !== material.id &&
        m.mountings.includes(panel.mounting) &&
        m.maxAreaM2 >= areaM2 &&
        m.maxWidthMm >= wMm &&
        m.maxHeightMm >= hMm
    )
    .map((m) => m.name)

  const aspectRatio = r1(wMm / Math.max(1, hMm))
  const contentAspectRatio = r1(occupiedWMm / Math.max(1, occupiedHMm))
  const slenderness = panel.mounting === 'freestanding' ? r1(topHeightMm / Math.max(1, wMm)) : r1(Math.max(wMm, hMm) / Math.max(1, Math.min(wMm, hMm)))
  const warnings: string[] = []
  if (aspectRatio > preset.maxAspectRatio) warnings.push(`门头宽高比 ${aspectRatio}:1 超过 ${preset.maxAspectRatio.toFixed(1)}:1，需拆成多块或加竖向分隔`)
  if (occupiedWMm > 0 && occupiedHMm > 0 && contentAspectRatio > preset.maxAspectRatio) {
    warnings.push(`实际排版占宽/占高比 ${contentAspectRatio}:1 超过 ${preset.maxAspectRatio.toFixed(1)}:1，建议分行/缩字`)
  }
  if (panel.mounting === 'freestanding' && slenderness > preset.maxSlenderness) {
    warnings.push(`独立立牌长细比（顶部高/总宽）${slenderness} 超过 ${preset.maxSlenderness.toFixed(1)}，必须加宽立柱间距或改双柱框架`)
  } else if (panel.mounting !== 'freestanding' && slenderness > preset.maxAspectRatio) {
    warnings.push(`门头长细比 ${slenderness} 超过 ${preset.maxAspectRatio.toFixed(1)}，长条板需沿长边加密龙骨`)
  }
  if (route === 'calculated' && grade === 4) warnings.push('G4 已到店内工艺最高档，正式施工前必须留存工程师计算书与现场基层照片')
  if (material.id === 'film') warnings.push('贴膜不承重：本核定按贴膜依附基层（通常为铝塑板）计，基层厚度必须另行填写确认')

  const escalation =
    route === 'calculated'
      ? [
          `基本风压由当前 ${windPressureKpa}kPa 提高（沿海、山口、屋顶或空旷场地按当地荷载规范取值）`,
          '顶部高度跨入更高风压系数档（6/10/15/20m）、安装基层松散，或现场发现空心墙/旧钢结构锈蚀',
          `面积/高度导致计算风力跨过 G${grade} 档阈值 ${preset.gradeDemandKn[Math.min(3, grade - 1)]}kN，或材料厚度低于 ${material.minThicknessMm}mm`,
          '翻到上一档后：由' + (grade >= 3 ? cfg.reviewerTitle || '注册结构/幕墙工程师' : '结构负责人') + '在下单前重算并签字；记录保存于本项目「结构核定版本」并随报价/清单导出'
        ]
      : [
          '保守档统一按偏保守高度/材质系数与 1.3 倍安全余量取加固档，不逐单复核风压',
          '若现场基层、材质或尺寸与订单不一致，立即停用本结论，改走计算档或按上一档重新核定',
          '结论版本、参数、用量与报价清单一并导出，车间和安装队各留一份'
        ]

  const fingerprint = JSON.stringify({
    w: wMm,
    h: hMm,
    m: panel.mounting,
    c: clearanceMm,
    mat: cfg.materialId,
    matFactor: material.factor,
    matMinGrade: material.minGrade,
    t: effectiveThicknessMm,
    ow: occupiedWMm,
    oh: occupiedHMm,
    route,
    wp: preset.basicWindPressureKpa,
    thresholds: preset.gradeDemandKn,
    limits: [material.maxAreaM2, material.maxWidthMm, material.maxHeightMm, material.mountings.join('|')]
  })

  return {
    wMm,
    hMm,
    topHeightMm,
    areaM2,
    occupiedWMm,
    occupiedHMm,
    aspectRatio,
    slenderness,
    demandKn,
    windPressureKpa,
    heightFactor: heightFactor1,
    mountingFactor: mountingFactor1,
    materialFactor: materialFactor1,
    effectiveThicknessMm,
    grade,
    conservativeGrade,
    tiePoints,
    keel: requirements[0],
    braces: requirements[1],
    posts: requirements.find((x) => x.spec.includes('立柱')) ?? null,
    anchors,
    requirements,
    blockReasons,
    approved: blockReasons.length === 0,
    maxWidthMm: Math.max(0, maxWidthMm),
    maxHeightMm: Math.max(0, maxHeightMm),
    maxAreaM2: r1(material.maxAreaM2),
    compatibleMaterials,
    gridCols,
    gridRows,
    gridCells: recommended.cells,
    escalation,
    reviewer: route === 'conservative' ? '门店结构负责人（保守档）' : cfg.reviewer.trim(),
    reviewerTitle: route === 'conservative' ? '保守最不利档，免逐单复核' : cfg.reviewerTitle,
    route,
    materialName: material.name,
    materialMatched: !blockReasons.some((b) => b.code === 'material' || b.code === 'mounting'),
    warnings,
    formula: [
      `受风面积 A = ${wMm}×${hMm} = ${areaM2}㎡`,
      `水平风力 F = q×A×μh×μm×μmat${route === 'conservative' ? '×1.5' : ''} = ${windPressureKpa}×${areaM2}×${heightFactor1}×${mountingFactor1}×${materialFactor1}${route === 'conservative' ? '×1.5' : ''} = ${demandKn}kN`,
      `分档阈值 ≤${preset.gradeDemandKn.join('/≤')}kN 对应 G1/G2/G3/G4；安装与材质最低档一并取大值`,
      `拉结点数取「分格节点、单点承载力反算、安装方式最低值」三者最大值${route === 'conservative' ? '，保守档再加 20% 且不少于 +2 点' : ''}`
    ],
    fingerprint
  }
}

export function activeStructuralReview(cfg: StructuralCfg | undefined): StructuralReviewRecord | null {
  if (!cfg?.reviews?.length) return null
  return [...cfg.reviews].reverse().find((r) => !r.superseded) ?? null
}

export function issueStructuralReview(project: Project, result: StructuralResult): StructuralReviewRecord {
  const cfg = project.structural ?? defaultStructuralCfg()
  project.layout.panel.wMm = result.wMm
  project.layout.panel.hMm = result.hMm
  cfg.clearanceMm = result.topHeightMm - result.hMm
  const version = Math.max(0, ...cfg.reviews.map((r) => r.version)) + 1
  for (const r of cfg.reviews) if (!r.superseded) r.superseded = true
  const record: StructuralReviewRecord = {
    version,
    issuedAt: Date.now(),
    route: result.route,
    result: JSON.parse(JSON.stringify(result)),
    fingerprint: result.fingerprint,
    reviewer: result.reviewer,
    reviewerTitle: result.reviewerTitle,
    superseded: false,
    trace: `本地项目 structural.reviews v${version}；导出的报价单/清单/工艺卡同步带版本号；翻档重算由 ${result.reviewerTitle} 负责复核。`
  }
  cfg.reviews.push(record)
  cfg.route = result.route
  project.structural = cfg
  return record
}

export function isStructuralReviewCurrent(record: StructuralReviewRecord | null, result: StructuralResult): boolean {
  return !!record && !record.superseded && record.fingerprint === result.fingerprint
}

export function structuralDiffLabel(prev: StructuralResult | null, next: StructuralResult): Array<{ label: string; before: string; after: string; changed: boolean }> {
  const rows = [
    ['门头宽', `${prev?.wMm ?? '—'}mm`, `${next.wMm}mm`],
    ['门头高', `${prev?.hMm ?? '—'}mm`, `${next.hMm}mm`],
    ['顶部离地', `${prev?.topHeightMm ?? '—'}mm`, `${next.topHeightMm}mm`],
    ['材质/厚度', prev ? `${prev.materialName} ${prev.effectiveThicknessMm}mm` : '—', `${next.materialName} ${next.effectiveThicknessMm}mm`],
    ['受风面积', `${prev?.areaM2 ?? '—'}㎡`, `${next.areaM2}㎡`],
    ['计算风力', `${prev?.demandKn ?? '—'}kN`, `${next.demandKn}kN`],
    ['加固等级', prev ? `G${prev.grade}` : '—', `G${next.grade}`],
    ['拉结点', `${prev?.tiePoints ?? '—'}套`, `${next.tiePoints}套`],
    ['龙骨', `${prev?.keel.qty ?? '—'}m`, `${next.keel.qty}m`],
    ['斜撑', prev ? `${prev.braces.qty}${prev.braces.unit}` : '—', `${next.braces.qty}${next.braces.unit}`],
    ['实际占宽高', prev ? `${prev.occupiedWMm}×${prev.occupiedHMm}mm` : '—', `${next.occupiedWMm}×${next.occupiedHMm}mm`]
  ]
  return rows.map(([label, before, after]) => ({ label, before, after, changed: before !== after }))
}

export function structuralRouteLabel(route: StructuralRoute): string {
  return route === 'conservative' ? '保守档' : '计算档'
}
