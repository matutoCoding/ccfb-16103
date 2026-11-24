// 全局应用状态（组合式，无 Pinia）
import { computed, reactive, readonly } from 'vue'
import type { Batch, EquipmentLayout, HouseProfile, Settings } from '@/types'
import { db } from '@/lib/db'
import { defaultBatch, defaultHouse, defaultSettings } from '@/lib/seed_data'
import { defaultLayout } from '@/lib/equipment'

interface AppState {
  ready: boolean
  houses: HouseProfile[]
  layouts: EquipmentLayout[]
  batches: Batch[]
  settings: Settings
  currentHouseId: string
  currentBatchId: string
  currentLayoutId: string
}

const state = reactive<AppState>({
  ready: false,
  houses: [],
  layouts: [],
  batches: [],
  settings: defaultSettings(),
  currentHouseId: '',
  currentBatchId: '',
  currentLayoutId: '',
})

async function ensureSeed(): Promise<void> {
  if (state.houses.length === 0) {
    const house = defaultHouse()
    const layout = defaultLayout(house)
    const batch = defaultBatch(house.id, layout.id)
    await db.houses.put(house)
    await db.layouts.put(layout)
    await db.batches.put(batch)
    state.houses = [house]
    state.layouts = [layout]
    state.batches = [batch]
    state.currentHouseId = house.id
    state.currentLayoutId = layout.id
    state.currentBatchId = batch.id
  }
}

export async function initStore(): Promise<void> {
  const [houses, layouts, batches, settings] = await Promise.all([
    db.houses.all(),
    db.layouts.all(),
    db.batches.all(),
    db.settings.get(),
  ])
  state.houses = houses
  state.layouts = layouts
  state.batches = batches
  state.settings = settings ?? defaultSettings()
  if (!settings) await db.settings.put(state.settings)
  await ensureSeed()
  state.currentHouseId = state.houses[0]?.id ?? ''
  state.currentLayoutId = state.layouts[0]?.id ?? ''
  state.currentBatchId = state.batches[0]?.id ?? ''
  state.ready = true
}

export function useStore() {
  const currentHouse = computed(() => state.houses.find((h) => h.id === state.currentHouseId))
  const currentLayout = computed(() => state.layouts.find((l) => l.id === state.currentLayoutId))
  const currentBatch = computed(() => state.batches.find((b) => b.id === state.currentBatchId))

  async function saveHouse(house: HouseProfile): Promise<void> {
    house.updatedAt = Date.now()
    await db.houses.put(house)
    const idx = state.houses.findIndex((h) => h.id === house.id)
    if (idx >= 0) state.houses[idx] = house
    else state.houses.push(house)
  }

  async function saveLayout(layout: EquipmentLayout): Promise<void> {
    layout.updatedAt = Date.now()
    await db.layouts.put(layout)
    const idx = state.layouts.findIndex((l) => l.id === layout.id)
    if (idx >= 0) state.layouts[idx] = layout
    else state.layouts.push(layout)
  }

  async function saveBatch(batch: Batch): Promise<void> {
    await db.batches.put(batch)
    const idx = state.batches.findIndex((b) => b.id === batch.id)
    if (idx >= 0) state.batches[idx] = batch
    else state.batches.push(batch)
  }

  async function saveSettings(): Promise<void> {
    await db.settings.put(state.settings)
  }

  async function removeHouse(id: string): Promise<void> {
    await db.houses.del(id)
    state.houses = state.houses.filter((h) => h.id !== id)
  }

  return {
    state: readonly(state),
    currentHouse,
    currentLayout,
    currentBatch,
    saveHouse,
    saveLayout,
    saveBatch,
    saveSettings,
    removeHouse,
    setCurrentHouse: (id: string) => (state.currentHouseId = id),
    setCurrentLayout: (id: string) => (state.currentLayoutId = id),
    setCurrentBatch: (id: string) => (state.currentBatchId = id),
    mutateSettings: (patch: Partial<Settings>) => Object.assign(state.settings, patch),
  }
}
