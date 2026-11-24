<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1>鸡舍档案</h1>
        <p class="muted">按长宽、湿帘风机位置和隔栏建档，隔栏门洞是鸡群跨段的唯一通道</p>
      </div>
    </header>

    <div v-if="!house" class="card empty-state">
      <div class="empty-icon">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
          <path d="M3 21V10l9-7 9 7v11h-6v-7h-6v7z" />
        </svg>
      </div>
      <h3>还没有鸡舍档案</h3>
      <p>点击下方按钮创建第一栋鸡舍</p>
      <button class="primary" @click="createHouse">新建鸡舍</button>
    </div>

    <template v-else>
      <div class="grid-2">
        <section class="card">
          <h3>基础参数</h3>
          <div class="form-grid" style="margin-top: var(--sp-4)">
            <div class="field">
              <label>鸡舍名称</label>
              <input v-model="form.name" />
            </div>
            <div class="field">
              <label>宽度（米）</label>
              <input v-model.number="form.width" type="number" min="6" step="0.5" />
            </div>
            <div class="field">
              <label>长度（米）</label>
              <input v-model.number="form.length" type="number" min="20" step="1" />
            </div>
            <div class="field">
              <label>湿帘位置 y（米）</label>
              <input v-model.number="form.wetPadY" type="number" min="0" step="1" />
            </div>
            <div class="field">
              <label>风机位置 y（米）</label>
              <input v-model.number="form.fanY" type="number" min="0" step="1" />
            </div>
          </div>
          <div class="toolbar" style="margin-top: var(--sp-5)">
            <button class="primary" @click="save">保存档案</button>
            <span v-if="savedTip" class="success-text">{{ savedTip }}</span>
          </div>
        </section>

        <section class="card">
          <div class="toolbar" style="justify-content: space-between">
            <h3>隔栏与门洞</h3>
            <button @click="addPartition">添加隔栏</button>
          </div>
          <div class="table-wrap" style="margin-top: var(--sp-4)">
            <table>
              <thead>
                <tr><th>位置 y（米）</th><th>门洞 x（米）</th><th>门洞宽（米）</th><th></th></tr>
              </thead>
              <tbody>
                <tr v-for="(p, i) in form.partitions" :key="p.id">
                  <td><input v-model.number="p.y" type="number" min="1" step="1" style="width: 96px" /></td>
                  <td>
                    <template v-for="d in p.doors" :key="d.x">
                      <input v-model.number="d.x" type="number" min="0" step="0.5" style="width: 88px" />
                    </template>
                  </td>
                  <td>
                    <template v-for="d in p.doors" :key="d.x">
                      <input v-model.number="d.width" type="number" min="0.5" step="0.5" style="width: 88px" />
                    </template>
                  </td>
                  <td>
                    <button class="danger" @click="removePartition(i)">删除</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section class="card" style="margin-top: var(--sp-5)">
        <h3>平面示意</h3>
        <HousePlan :house="form" class="plan" />
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { useStore } from '@/store/app'
import { defaultHouse } from '@/lib/seed_data'
import { uid } from '@/lib/equipment'
import HousePlan from '@/components/house_plan.vue'
import type { HouseProfile } from '@/types'

const store = useStore()
const house = store.currentHouse
const form = reactive<HouseProfile>(JSON.parse(JSON.stringify(house.value ?? defaultHouse())))
const savedTip = ref('')

watch(house, (v) => {
  if (v) Object.assign(form, JSON.parse(JSON.stringify(v)))
})

function createHouse(): void {
  const h = defaultHouse()
  store.saveHouse(h)
  store.setCurrentHouse(h.id)
  Object.assign(form, JSON.parse(JSON.stringify(h)))
}

function addPartition(): void {
  form.partitions.push({
    id: uid('part'),
    y: Math.round(form.length / 2),
    doors: [{ x: form.width / 2 - 1, width: 2 }],
  })
}

function removePartition(i: number): void {
  form.partitions.splice(i, 1)
}

async function save(): Promise<void> {
  if (form.wetPadY >= form.fanY) {
    savedTip.value = '湿帘与风机位置不合法'
    return
  }
  await store.saveHouse({ ...form, partitions: [...form.partitions].sort((a, b) => a.y - b.y) })
  savedTip.value = '已保存'
  setTimeout(() => (savedTip.value = ''), 2000)
}
</script>

<style scoped>
.page { display: flex; flex-direction: column; gap: var(--sp-5); max-width: 1280px; }
.page-head p { margin: var(--sp-2) 0 0; }
.grid-2 { display: grid; grid-template-columns: 1fr 1.2fr; gap: var(--sp-5); }
.plan { margin-top: var(--sp-4); }
@media (max-width: 1080px) { .grid-2 { grid-template-columns: 1fr; } }
</style>
