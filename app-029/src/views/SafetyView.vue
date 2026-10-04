<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { getProject } from '../logic/store'
import { useSession } from '../logic/useSession'
import {
  activeStructuralReview,
  computeStructural,
  isStructuralReviewCurrent,
  issueStructuralReview,
  structuralDiffLabel,
  structuralMaterial,
  structuralRouteLabel
} from '../logic/structural'
import { mountingLabel } from '../logic/layout'
import type { Project, StructuralRoute } from '../logic/types'

const route = useRoute()
const loaded = ref<Project | null>(getProject(String(route.params.id)))
const session = useSession(loaded)
const project = computed(() => loaded.value)
const layout = session.layout
const preset = session.preset
const issuedNow = ref(false)

const result = computed(() =>
  project.value && layout.value ? computeStructural(project.value, layout.value, preset.value.structural) : null
)
const active = computed(() => activeStructuralReview(project.value?.structural))
const current = computed(() => (active.value && result.value ? isStructuralReviewCurrent(active.value, result.value) : false))
const material = computed(() =>
  project.value ? structuralMaterial(preset.value.structural, project.value.structural.materialId) : preset.value.structural.materials[0]
)
const previousRecord = computed(() => {
  const reviews = project.value?.structural.reviews ?? []
  const activeVersion = active.value?.version
  return [...reviews].reverse().find((r) => r.version !== activeVersion) ?? null
})
const diff = computed(() => {
  if (!result.value) return []
  if (active.value && !current.value) return structuralDiffLabel(active.value.result, result.value)
  if (active.value && previousRecord.value) return structuralDiffLabel(previousRecord.value.result, active.value.result)
  return []
})

function setRoute(route: StructuralRoute): void {
  if (!project.value) return
  project.value.structural.route = route
  issuedNow.value = false
}

function issue(): void {
  if (!project.value || !result.value) return
  if (!result.value.approved) return
  issueStructuralReview(project.value, result.value)
  session.save()
  issuedNow.value = true
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', { hour12: false })
}
function roundPanel(field: 'wMm' | 'hMm' | 'clearanceMm'): void {
  if (!project.value) return
  if (field === 'clearanceMm') {
    project.value.structural.clearanceMm = Math.max(0, Math.round(Number(project.value.structural.clearanceMm) || 0))
  } else {
    project.value.layout.panel[field] = Math.max(0, Math.round(Number(project.value.layout.panel[field]) || 0))
  }
}
</script>

<template>
  <div class="page">
    <div v-if="!project" class="card">
      <h1>项目不存在</h1>
      <router-link to="/">返回项目列表</router-link>
    </div>
    <div v-else-if="!layout" class="card">
      <h1>字体加载中…</h1>
      <p class="muted">结构核定需要使用排版后的实际占宽占高。</p>
    </div>
    <template v-else-if="result">
      <div :class="['banner', active && current && result.approved ? 'ok' : 'bad']">
        <template v-if="active && current && result.approved">
          <b>结构核定通过：v{{ active?.version }} · {{ structuralRouteLabel(result.route) }} · G{{ result.grade }} · {{ result.tiePoints }} 个拉结点</b>
          <span class="muted">出具人：{{ active?.reviewerTitle }} {{ active?.reviewer }}；{{ fmtTime(active?.issuedAt ?? 0) }}</span>
        </template>
        <template v-else>
          <b>{{ active ? '核定结论已失效，当前参数被拦住' : '结构核定尚未通过，材料/报价页已拦住' }}</b>
          <span class="muted">处理完下方拦截项后，才能出具唯一有效结论。</span>
        </template>
      </div>

      <div class="split safety-layout">
        <section class="card">
          <header>
            <h1>结构安全核定</h1>
            <span class="hint">{{ project.name }}</span>
          </header>

          <div class="field">
            <label>门头总宽 × 总高（mm 整数）</label>
            <div class="ctl">
              <input type="number" v-model.number="project.layout.panel.wMm" step="10" @change="roundPanel('wMm')" />
              <span class="muted">×</span>
              <input type="number" v-model.number="project.layout.panel.hMm" step="10" @change="roundPanel('hMm')" />
            </div>
          </div>
          <div class="field">
            <label>离地高度（mm）</label>
            <div class="ctl">
              <input type="number" v-model.number="project.structural.clearanceMm" step="100" @change="roundPanel('clearanceMm')" />
              <span class="muted">顶部 {{ result.topHeightMm }}mm</span>
            </div>
          </div>
          <div class="field">
            <label>安装方式</label>
            <div class="ctl">
              <select v-model="project.layout.panel.mounting">
                <option value="wall">贴墙</option>
                <option value="board">挂板</option>
                <option value="freestanding">独立立牌</option>
              </select>
            </div>
          </div>
          <div class="field">
            <label>面板材质</label>
            <div class="ctl">
              <select v-model="project.structural.materialId">
                <option v-for="m in preset.structural.materials" :key="m.id" :value="m.id">{{ m.name }}</option>
              </select>
            </div>
          </div>
          <div class="field">
            <label>面板厚度（mm）</label>
            <div class="ctl">
              <select v-model.number="project.structural.thicknessMm">
                <option v-for="t in material.thicknesses.length ? material.thicknesses : [0]" :key="t" :value="t">
                  {{ t === 0 ? '依附基层（不单列膜厚）' : `${t}mm` }}
                </option>
              </select>
            </div>
          </div>
          <p class="muted">{{ material.note }}；最低厚度 {{ material.minThicknessMm }}mm，允许：{{ material.mountings.map(mountingLabel).join('、') }}</p>

          <h3>加固路线二选一</h3>
          <div class="route-grid">
            <button :class="{ active: project.structural.route === 'conservative' }" @click="setRoute('conservative')">
              <b>保守档</b>
              <span>按最不利情况加固；材料多、造价高；不用逐单复核</span>
            </button>
            <button :class="{ active: project.structural.route === 'calculated' }" @click="setRoute('calculated')">
              <b>计算档</b>
              <span>按实际受力求；省料省钱；但翻档责任必须有人签</span>
            </button>
          </div>

          <template v-if="result.route === 'calculated'">
            <div class="field" style="margin-top: 10px">
              <label>翻档/批准担责人</label>
              <div class="ctl"><input type="text" v-model="project.structural.reviewer" placeholder="姓名" /></div>
            </div>
            <div class="field">
              <label>担责人身份</label>
              <div class="ctl">
                <select v-model="project.structural.reviewerTitle">
                  <option>结构负责人</option>
                  <option>注册结构工程师</option>
                  <option>幕墙工程师</option>
                  <option>项目工程师</option>
                </select>
              </div>
            </div>
          </template>

          <div class="banner" :class="result.approved ? 'ok' : 'bad'" style="margin-top: 12px">
            <b>{{ result.approved ? '本档可出具核定结论' : '核定不通过，当场拦住' }}</b>
            <ul class="notes">
              <li v-for="(b, i) in result.blockReasons" :key="i">
                {{ b.message }}（实际：{{ b.actualText }}；限制：{{ b.limitText }}）
              </li>
              <li v-if="result.approved">
                实际占宽/占高 {{ result.occupiedWMm }}×{{ result.occupiedHMm }}mm；宽高比 {{ result.aspectRatio }}:1；长细比 {{ result.slenderness }}
              </li>
            </ul>
          </div>

          <div class="row" style="margin-top: 12px">
            <button class="primary" :disabled="!result.approved" @click="issue">
              {{ active && !current ? '重核并作废旧版（只保留新版有效）' : active ? '重新出具核定结论' : '出具结构核定结论' }}
            </button>
            <router-link :to="`/materials/${project.id}`"><button :disabled="!current">去材料清单</button></router-link>
            <router-link :to="`/quote/${project.id}`"><button :disabled="!current">去报价单</button></router-link>
          </div>
          <p class="muted" v-if="issuedNow">已写入本项目本地结构核定记录；加固材料、报价与导出清单会同步使用这一版。</p>
        </section>

        <section>
          <div class="card">
            <header>
              <h2>计算结果与加固项</h2>
              <span class="hint">系数/占比保留 1 位小数，宽高按 mm 整数</span>
            </header>
            <div class="grade-row">
              <div :class="['grade-box', `g${result.grade}`]">
                <b>G{{ result.grade }}</b>
                <span>{{ ['常规龙骨', '加密龙骨+斜撑', '主副框架+抗风撑', '重载框架/工程师件'][result.grade - 1] }}</span>
              </div>
              <div class="kv-list" style="flex:1">
                <span class="muted">受风面积</span><span class="mono">{{ result.areaM2 }} ㎡</span>
                <span class="muted">水平风力</span><span class="mono">{{ result.demandKn }} kN</span>
                <span class="muted">高度/安装/材质系数</span><span class="mono">{{ result.heightFactor }} / {{ result.mountingFactor }} / {{ result.materialFactor }}</span>
                <span class="muted">拉结点数</span><span class="mono"><b>{{ result.tiePoints }}</b> 套</span>
              </div>
            </div>
            <ul class="notes">
              <li v-for="(f, i) in result.formula" :key="i">{{ f }}</li>
            </ul>
            <table>
              <thead><tr><th>加固项</th><th>规格</th><th class="num">数量</th><th>说明</th></tr></thead>
              <tbody>
                <tr v-for="(r, i) in result.requirements" :key="i">
                  <td>{{ ['龙骨', '斜撑', '立柱', '拉结/锚栓'][i] ?? r.spec }}</td>
                  <td>{{ r.spec }}</td>
                  <td class="num">{{ r.qty }} {{ r.unit }}</td>
                  <td class="muted">{{ r.note }}</td>
                </tr>
              </tbody>
            </table>
            <p class="muted" v-if="result.route === 'conservative'">
              保守档按最不利余量取 G{{ result.grade }}；同参数计算档可切换查看实际受力结果。
            </p>
          </div>

          <div class="card" style="margin-top:14px">
            <header>
              <h2>不通过反算与分格方案</h2>
              <span class="hint">当前材质/安装/离地条件不变</span>
            </header>
            <div class="kv-list">
              <span class="muted">当前最多总宽</span><span class="mono">{{ result.maxWidthMm }} mm</span>
              <span class="muted">当前最多总高</span><span class="mono">{{ result.maxHeightMm }} mm</span>
              <span class="muted">最大受风面积</span><span class="mono">{{ result.maxAreaM2 }} ㎡</span>
              <span class="muted">可替换材质</span><span>{{ result.compatibleMaterials.length ? result.compatibleMaterials.join('、') : '需同时缩小尺寸或改安装方式' }}</span>
              <span class="muted">推荐分格</span><span class="mono">{{ result.gridCols }} 列 × {{ result.gridRows }} 行</span>
            </div>
            <table style="margin-top:8px">
              <thead><tr><th>板号</th><th class="num">宽 mm</th><th class="num">高 mm</th></tr></thead>
              <tbody>
                <tr v-for="cell in result.gridCells" :key="cell.no">
                  <td>{{ cell.no }}</td><td class="num">{{ cell.wMm }}</td><td class="num">{{ cell.hMm }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="card" style="margin-top:14px" v-if="result.warnings.length">
            <header><h2>排版宽高比 / 长细比提醒</h2><span class="hint">不替代拦截，但必须告知</span></header>
            <ul class="notes"><li v-for="(w, i) in result.warnings" :key="i">{{ w }}</li></ul>
          </div>

          <div class="card" style="margin-top:14px">
            <header><h2>计算档翻档条件与责任留痕</h2></header>
            <ul class="notes">
              <li v-for="(e, i) in result.escalation" :key="i">{{ e }}</li>
              <li><b>痕迹留哪：</b>本项目浏览器本地记录 structural.reviews；报价单 Excel、CSV 工艺卡与打印件均带 v 版本号。</li>
            </ul>
          </div>

          <div class="card" style="margin-top:14px" v-if="diff.length">
            <header>
              <h2>{{ current ? '上一版与当前有效结论差异' : '旧版结论与当前重算差异' }}</h2>
              <span class="hint">只有一处有效结论；改动必须看清差额</span>
            </header>
            <table>
              <thead><tr><th>项目</th><th>旧版</th><th>本次</th></tr></thead>
              <tbody>
                <tr v-for="d in diff" :key="d.label" :class="{ 'row-active': d.changed }">
                  <td>{{ d.label }}</td><td>{{ d.before }}</td><td><b>{{ d.after }}</b></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="card" style="margin-top:14px">
            <header><h2>核定记录</h2><span class="hint">仅最新一份有效</span></header>
            <table>
              <thead><tr><th>版本</th><th>路线</th><th>结论</th><th>担责人</th><th>时间</th></tr></thead>
              <tbody>
                <tr v-for="r in [...project.structural.reviews].reverse()" :key="r.version">
                  <td>v{{ r.version }} {{ r.superseded ? '（已作废）' : '✔' }}</td>
                  <td>{{ structuralRouteLabel(r.route) }}</td>
                  <td>G{{ r.result.grade }} / {{ r.result.tiePoints }}套</td>
                  <td>{{ r.reviewerTitle }} {{ r.reviewer }}</td>
                  <td class="muted">{{ fmtTime(r.issuedAt) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.safety-layout {
  grid-template-columns: 430px minmax(0, 1fr);
}
.route-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.route-grid button {
  text-align: left;
  min-height: 82px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.route-grid button.active {
  border-color: var(--brand);
  background: var(--brand-soft);
}
.route-grid span {
  color: var(--ink-2);
  line-height: 1.45;
}
.grade-row {
  display: flex;
  gap: 14px;
  align-items: center;
}
.grade-box {
  width: 118px;
  height: 92px;
  border-radius: 10px;
  border: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: var(--brand-soft);
}
.grade-box b {
  font-size: 34px;
  line-height: 1;
}
.grade-box.g4 {
  background: var(--danger-soft);
}
</style>
