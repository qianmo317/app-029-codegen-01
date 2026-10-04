/**
 * 全局共享类型定义（对应规格书第 7 节数据模型）
 * 说明：内部长度单位统一 mm（1 位小数），金额统一整数「分」。
 */

export type Mounting = 'wall' | 'board' | 'freestanding'
export type Align = 'left' | 'center' | 'right' | 'justify'
export type CharMode = 'solid' | 'outline'
export type StructuralRoute = 'conservative' | 'calculated'
export type StructuralMaterialId = 'film' | 'pvc' | 'acrylic' | 'acm' | 'steel'

export interface StructuralConfig {
  /** 牌底下沿离地高度，mm */
  groundClearanceMm: number
  /** 承重面板厚度，mm */
  thicknessMm: number
  materialId: StructuralMaterialId
  route: StructuralRoute
  /** 保守档：现场负责人；计算档：编制人 */
  acceptedBy: string
  reviewerName: string
  reviewerRole: string
  traceLocation: string
  history: StructuralRecord[]
}

export interface StructuralRecord {
  id: string
  at: number
  pass: boolean
  route: StructuralRoute
  fingerprint: string
  acceptedBy: string
  reviewerName: string
  reviewerRole: string
  traceLocation: string
  input: {
    wMm: number
    hMm: number
    occupiedWMm: number
    occupiedHMm: number
    mounting: Mounting
    groundClearanceMm: number
    topHeightMm: number
    thicknessMm: number
    materialId: StructuralMaterialId
  }
  summary: {
    grade: number
    gradeLabel: string
    tiePoints: number
    windPressureKpa: number
    windForceKn: number
    areaM2: number
    blockReasons: string[]
    warnings: string[]
  }
}

/** 门头面板参数；frameMm = 铝塑板边框宽度，有效安装区 = 面板尺寸 - 2×边框 */
export interface SignPanel {
  wMm: number
  hMm: number
  mounting: Mounting
  frameMm: number
}

/** 逐字项；line 为行号、seq 为全文字序（多行扩展，供逐字微调定位用） */
export interface CharItem {
  char: string
  trackMm: number
  offsetYMm: number
  mode: CharMode
  line: number
  /** 是否手动调整过字距（未调整时跟随「默认字距比例 × 字号」） */
  trackTouched?: boolean
  seq?: number
}

export interface LayoutSettings {
  align: Align
  baseSizeMm: number
  fontId: string
  weight: number
  strokeLimitMm: number
  /** 默认字距 = trackRatio × 字号 */
  trackRatio: number
  /** 自动字号时预留的左右留边比例 */
  marginRatio: number
  /** 行距（行与行之间墨迹间隙）= lineGapRatio × 字号 */
  lineGapRatio: number
}

export interface LayoutDef {
  panel: SignPanel
  items: CharItem[]
  settings: LayoutSettings
}

export interface LedCfg {
  moduleSpacingMm: number
  modulePowerW: number
  moduleLumen: number
  safetyFactor: number
  psuEfficiency: number
}

export interface LedResult {
  /** 总布点长度（各连通域外轮廓周长之和） */
  perimeterTotalMm: number
  modules: number
  ratedW: number
  recommendedW: number
  suggestedPsu: string
  note: string
  /** 因向上取整补足的模组数 */
  extraModules: number
  /** 理论布点小数（L / spacing） */
  exactModules: number
  /** 末段余长 mm */
  spareMm: number
  psuCount: number
  psuUnitW: number
}

export type MaterialKind = 'acrylic' | 'led_module' | 'psu' | 'glue' | 'labor' | 'structural'

export interface Material {
  kind: MaterialKind
  spec: string
  qty: number
  unit: string
  unitPriceCents: number
  amountCents: number
}

export interface BBox {
  x: number
  y: number
  w: number
  h: number
}

export interface ContourInfo {
  areaMm2: number
  perimeterMm: number
  isHole: boolean
  blockIndex: number
}

export interface GlyphInfo {
  char: string
  fontId: string
  weight: number
  sizeMm: number
  bboxMm: BBox
  contours: ContourInfo[]
  /** 连通域（笔画块）数量 */
  strokeBlocks: number
  /** 最细笔画宽度 mm */
  minStrokeMm: number
  /** 最细笔画位置（mm，字形本地坐标 y 向下） */
  minStrokePoint: { x: number; y: number } | null
  /** 字体中不存在该字符 */
  missing: boolean
  /** 工艺警告 */
  warnings: string[]
}

export interface Project {
  id: string
  name: string
  layout: LayoutDef
  led: LedCfg
  /** 面板材料预设 id（见 materials.json 的 panelMaterials） */
  panelMaterialId: string
  sheetId: string
  ledModuleId: string
  structural?: StructuralConfig
  createdAt: number
  updatedAt: number
}