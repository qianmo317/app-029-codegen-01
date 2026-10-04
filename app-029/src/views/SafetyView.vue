<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { getProject, saveProject } from '../logic/store'
import { useSession } from '../logic/useSession'
import {
  STRUCTURAL_MATERIALS,
  assessStructure,
  diffStructuralRecords,
  ensureStructural,
  issueStructuralConclusion,
  mountingText
} from '../logic/structural'
import type { Project, StructuralMaterialId } from '../logic/types'

const route = useRoute()
const loaded = ref<Project | null>(getProject(String(route.params.id)))
const session = useSession(loaded)
const project = computed(() => loaded.value)
const layout = session.layout
const issueErrors = ref<string[]>([])
const issueOk = ref(false)

const cfg = computed(() => (project.value ? ensureStructural(project.value) : null))
const result = computed(() => (project.value ? assessStructure(project.value, layout.value) : null))
const latest = computed(() => cfg.value?.history[0] ?? null)
const previous = computed(() => cfg.value?.history[1] ?? null)
const diffRows = computed(() => diffStructuralRecords(previous.value, latest.value))
const thicknesses = computed(() => STRUCTURAL_MATERIALS.find((m) => m.id === cfg.value?.materialId)?.thicknesses ?? [])

function save(): void {
  if (project.value) saveProject(project.value)
  issueOk.value = false
}

function roundPanel(field: 'wMm' | 'hMm' | 'frameMm'): void {
  const p = project.value
  if (!p) return
  p.layout.panel[field] = Math.max(0, Math.round(p.layout.panel[field]))
  save()
}

function roundGround(): void {
  if (!project.value || !cfg.value) return
  cfg.value.groundClearanceMm = Math.max(0, Math.round(cfg.value.groundClearanceMm))
  save()
}

function changeMaterial(id: StructuralMaterialId): void {
  if (!cfg.value) return
  cfg.value.materialId = id
  const list = STRUCTURAL_MATERIALS.find((m) => m.id === id)?.thicknesses ?? []
  if (!list.includes(cfg.value.thicknessMm)) cfg.value.thicknessMm = list[0] ?? 0
  save()
}

function issue(): void {
  if (!project.value || !result.value) return
  const r = issueStructuralConclusion(project.value, result.value)
  issueErrors.value = r.errors
  if (r.ok) {
    saveProject(project.value)
    issueOk.value = true
  }
}

function applyMaxWidth(): void {
  const r = result.value
  if (!project.value || !r || r.maxWidthAtHeightMm === null) return
  project.value.layout.panel.wMm = r.maxWidthAtHeightMm
  save()
}
function applyMaxHeight(): void {
  const r = result.value
  if (!project.value || !r || r.maxHeightAtWidthMm === null) return
  project.value.layout.panel.hMm = r.maxHeightAtWidthMm
  save()
}
function applyPanel(w: number, h: number): void {
  if (!project.value) return
  project.value.layout.panel.wMm = w
  project.value.layout.panel.hMm = h
  save()
}
</script>

<template>
  <div class="page">
    <div v-if="!project || !cfg || !result" class="card">
      <h1>项目不存在</h1>
      <router-link to="/">返回项目列表</router-link>
    </div>

    <template v-else>
      <div class="grid cols-2" style="align-items: start">
        <section class="card">
          <header>
            <h1>门头结构安全核定</h1>
            <span class="hint">{{ project.name }}</span>
          </header>

          <div class="field">
            <label>门头总宽 × 总高（mm，整数）</label>
            <div class="ctl">
              <input type="number" v-model.number="project.layout.panel.wMm" min="100" step="1" @change="roundPanel('wMm')" />
              <span class="muted">×</span>
              <input type="number" v-model.number="project.layout.panel.hMm" min="100" step="1" @change="roundPanel('hMm')" />
            </div>
          </div>
          <div class="field">
            <label>安装方式</label>
            <div class="ctl">
              <select v-model="project.layout.panel.mounting" @change="save">
                <option value="wall">贴墙</option>
                <option value="board">挂板</option>
                <option value="freestanding">独立立牌</option>
              </select>
            </div>
          </div>
          <div class="field">
            <label>牌底下沿离地高度（mm）</label>
            <div class="ctl">
              <input type="number" v-model.number="cfg.groundClearanceMm" min="0" step="100" @change="roundGround" />
              <span class="muted">牌顶 {{ result.topHeightMm }}mm</span>
            </div>
          </div>
          <div class="field">
            <label>承重面板材质</label>
            <div class="ctl">
              <select :value="cfg.materialId" @change="changeMaterial(($event.target as HTMLSelectElement).value as StructuralMaterialId)">
                <option v-for="m in STRUCTURAL_MATERIALS" :key="m.id" :value="m.id">
                  {{ m.name }}（{{ m.mountings.map(mountingText).join('/') }}）
                </option>
              </select>
            </div>
          </div>
          <div class="field">
            <label>面板厚度（mm）</label>
            <div class="ctl">
              <select v-model.number="cfg.thicknessMm" @change="save">
                <option v-for="t in thicknesses" :key="t" :value="t">{{ t }}mm</option>
              </select>
              <span class="muted">无支承跨度上限 {{ result.material.unsupportedSpanMm[String(result.thicknessMm)] }}mm</span>
            </div>
          </div>
          <div class="field">
            <label>加固路线（二选一）</label>
            <div class="ctl">
              <label class="muted"><input type="radio" value="conservative" v-model="cfg.route" @change="save" /> 保守档</label>
              <label class="muted"><input type="radio" value="calculated" v-model="cfg.route" @change="save" /> 计算档</label>
            </div>
          </div>
          <div class="banner" :class="result.route === 'conservative' ? 'info' : 'warn'">
            <template v-if="result.route === 'conservative'">
              保守档按 1.5kPa 最不利阵风包络：材料更多、造价更高；常规条件免逐单结构复算，但现场负责人仍需确认墙体/基础可用。
            </template>
            <template v-else>
              计算档按实际风压受力求：省料省钱；达到翻档条件必须升档，由复核人重算并签字，记录痕迹随报价/清单存档。
            </template>
          </div>

          <h3 style="margin-top: 12px">责任与痕迹</h3>
          <div class="field">
            <label>{{ result.route === 'conservative' ? '现场负责人' : '计算/编制人' }}</label>
            <div class="ctl"><input type="text" v-model="cfg.acceptedBy" @input="save" placeholder="签字姓名" /></div>
          </div>
          <template v-if="result.route === 'calculated'">
            <div class="field">
              <label>翻档后复核人</label>
              <div class="ctl"><input type="text" v-model="cfg.reviewerName" @input="save" placeholder="结构负责人姓名" /></div>
            </div>
            <div class="field">
              <label>复核岗位/单位</label>
              <div class="ctl"><input type="text" v-model="cfg.reviewerRole" @input="save" placeholder="如：结构负责人 / 设计单位" /></div>
            </div>
          </template>
          <div class="field">
            <label>痕迹留存位置</label>
            <div class="ctl"><input type="text" v-model="cfg.traceLocation" @input="save" /></div>
          </div>
          <div class="row" style="margin-top: 10px">
            <button class="primary" :disabled="!result.pass || result.approved" @click="issue">出具当前核定结论（一份）</button>
            <router-link :to="`/materials/${project.id}`"><button :disabled="!result.approved">去材料清单</button></router-link>
          </div>
          <p class="muted">宽高按毫米整数；分档系数、风压和占比显示一位小数，避免浮点误差跨档。</p>
        </section>

        <section>
          <div class="card" :class="result.pass ? (result.approved ? 'pass-card' : 'warn-card') : 'fail-card'">
            <header>
              <h2>核定结论</h2>
              <span class="hint">当前只认下方这一份有效结论</span>
            </header>
            <div v-if="!result.pass" class="banner bad">
              <b>当场拦住，不能报价/下单：</b>
              <ul class="notes">
                <li v-for="(r, i) in result.blockReasons" :key="i">{{ r }}</li>
              </ul>
            </div>
            <div v-else-if="result.approved" class="banner ok">
              <b>核定通过并已签字：</b>{{ result.gradeLabel }}；拉结点/立柱点 {{ result.tiePoints }} 个。
              <div class="muted" style="color: inherit">
                {{ latest?.acceptedBy }} 于 {{ latest ? new Date(latest.at).toLocaleString('zh-CN') : '' }} 出具{{
                  latest?.reviewerName ? `，复核：${latest.reviewerName}（${latest.reviewerRole}）` : ''
                }}
              </div>
            </div>
            <div v-else class="banner warn"><b>计算通过但尚未出具有效结论：</b>请核对责任与痕迹后签字；当前仍会拦截报价。</div>

            <div class="metrics">
              <span class="k">尺寸 / 面积</span><span class="v">{{ result.wMm }}×{{ result.hMm }}mm · {{ result.areaM2.toFixed(2) }}㎡</span>
              <span class="k">实际占宽×占高</span><span class="v">{{ result.occupiedWMm || '排版后更新' }}×{{ result.occupiedHMm || '排版后更新' }}mm</span>
              <span class="k">安装 / 牌顶</span><span class="v">{{ mountingText(result.mounting) }} · {{ result.topHeightMm }}mm</span>
              <span class="k">材质 / 厚度</span><span class="v">{{ result.material.name }} · {{ result.thicknessMm }}mm</span>
              <span class="k">风压 / 风荷载</span><span class="v">{{ result.windPressureKpa }}kPa · {{ result.windForceKn }}kN</span>
              <span class="k">面板抗力</span><span class="v">{{ result.capacityKpa }}kPa</span>
              <span class="k">控制项</span><span class="v">{{ result.controlling }}</span>
              <span class="k">加固等级</span><span class="v"><b>{{ result.gradeLabel }}</b></span>
              <span class="k">拉结点数</span><span class="v"><b>{{ result.tiePoints }}</b> 个</span>
              <span class="k">龙骨/立柱</span>
              <span class="v">{{ result.mounting === 'freestanding' ? `${result.posts} 根 / ${result.postsM} 米` : `${result.railsM} 米` }}</span>
              <span class="k">斜撑</span><span class="v">{{ result.braces }} 根</span>
              <span class="k">拉结间距</span><span class="v">≤{{ result.gridSpacingMm }}mm</span>
            </div>
            <div v-if="issueErrors.length" class="banner bad" style="margin-top: 10px">
              <ul class="notes"><li v-for="(e, i) in issueErrors" :key="i">{{ e }}</li></ul>
            </div>
            <div v-if="issueOk" class="banner ok" style="margin-top: 10px">已出具并写入项目本地痕迹；材料用量、报价单和导出清单会同步刷新。</div>
          </div>

          <div class="card" style="margin-top: 14px">
            <header><h2>分档计算与翻档条件</h2></header>
            <table>
              <tbody>
                <tr><td>风压利用率</td><td class="num" :class="{ bad: result.pressureUtilization > 100 }">{{ result.pressureUtilization }}%</td></tr>
                <tr><td>面积利用率</td><td class="num" :class="{ bad: result.areaUtilization > 100 }">{{ result.areaUtilization }}%</td></tr>
                <tr><td>跨度利用率</td><td class="num" :class="{ bad: result.spanUtilization > 100 }">{{ result.spanUtilization }}%</td></tr>
                <tr><td>高度利用率</td><td class="num">{{ result.heightUtilization }}%</td></tr>
              </tbody>
            </table>
            <div class="formula" style="margin-top: 10px">
              <div v-for="(f, i) in result.formulas" :key="i">{{ f }}</div>
            </div>
            <ul class="notes" style="margin-top: 8px">
              <li v-for="(u, i) in result.upgradeConditions" :key="i">{{ u }}</li>
            </ul>
            <h3>加固做法</h3>
            <ul class="notes">
              <li v-for="(r, i) in result.recommendations" :key="i">{{ r }}</li>
            </ul>
            <div v-if="result.warnings.length" class="banner warn">
              <b>排版后复核提醒：</b>
              <ul class="notes"><li v-for="(w, i) in result.warnings" :key="i">{{ w }}</li></ul>
            </div>
          </div>
        </section>
      </div>

      <section v-if="!result.pass" class="card" style="margin-top: 14px">
        <header><h2>反算：当前条件最多能做多大 / 怎么分格</h2></header>
        <div class="grid cols-3">
          <div>
            <h3>保持总高 {{ result.hMm }}mm</h3>
            <p class="mono">最大总宽：{{ result.maxWidthAtHeightMm ?? '—' }}mm</p>
            <button :disabled="result.maxWidthAtHeightMm === null" @click="applyMaxWidth">采用该宽度重核</button>
          </div>
          <div>
            <h3>保持总宽 {{ result.wMm }}mm</h3>
            <p class="mono">最大总高：{{ result.maxHeightAtWidthMm ?? '—' }}mm</p>
            <button :disabled="result.maxHeightAtWidthMm === null" @click="applyMaxHeight">采用该高度重核</button>
          </div>
          <div v-if="result.maxSinglePanel">
            <h3>最大单件平衡尺寸</h3>
            <p class="mono">{{ result.maxSinglePanel.wMm }}×{{ result.maxSinglePanel.hMm }}mm</p>
            <button @click="applyPanel(result.maxSinglePanel!.wMm, result.maxSinglePanel!.hMm)">采用单件尺寸</button>
          </div>
        </div>
        <template v-if="result.gridPlan">
          <h3>建议分格方案：{{ result.gridPlan.cols }} 列 × {{ result.gridPlan.rows }} 行，共 {{ result.gridPlan.count }} 块</h3>
          <p class="mono">
            单件约 {{ result.gridPlan.cellWMm }}×{{ result.gridPlan.cellHMm }}mm；需在缝后补竖向/横向龙骨，并按新分格逐块计算拉结。
          </p>
          <div class="grid-plan" :style="{ gridTemplateColumns: `repeat(${result.gridPlan.cols}, minmax(80px, 1fr))` }">
            <div v-for="(c, i) in result.gridPlan.cells" :key="i" class="grid-cell">{{ c.w }}×{{ c.h }}</div>
          </div>
        </template>
        <p v-else class="muted">当前材质/安装方式无法用常规分格解决，请更换更高强度材质、改贴墙安装或转专项设计。</p>
      </section>

      <section class="card" style="margin-top: 14px">
        <header>
          <h2>重核差异（只保留一份当前结论）</h2>
          <span class="hint">展示最近两次签字结论；改尺寸未重核时上方结论自动失效</span>
        </header>
        <p v-if="!latest" class="muted">尚无已出具的结论。首次核定后这里会记录；之后任何尺寸、材质、离地高度或实际占宽占高变化都必须重核。</p>
        <table v-else>
          <thead><tr><th>项目</th><th>上一次</th><th>最新一次</th><th>差异</th></tr></thead>
          <tbody>
            <tr v-for="(d, i) in diffRows" :key="i" :class="{ 'row-active': d.changed }">
              <td>{{ d.label }}</td><td>{{ d.before }}</td><td>{{ d.after }}</td><td>{{ d.changed ? '变化' : '一致' }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </div>
</template>

<style scoped>
.pass-card,
.good {
  border-color: var(--good, #2f9e44);
}
.warn-card {
  border-color: var(--warn, #f08c00);
}
.fail-card,
.bad {
  border-color: var(--danger, #e03131);
}
.grid-plan {
  display: grid;
  gap: 4px;
  margin-top: 10px;
  max-width: 720px;
}
.grid-cell {
  border: 1px dashed var(--border);
  padding: 8px;
  text-align: center;
  font-family: monospace;
  background: var(--surface-2);
}
</style>
