// 极简 hash 路由
import { computed, ref } from 'vue'

export type RouteName = 'house' | 'equipment' | 'batch' | 'analysis' | 'playback' | 'settings'

const routes: { name: RouteName; label: string; icon: string }[] = [
  { name: 'house', label: '鸡舍档案', icon: 'M3 21V10l9-7 9 7v11h-6v-7h-6v7z' },
  { name: 'equipment', label: '设备布置', icon: 'M4 6h16M4 12h16M4 18h10' },
  { name: 'batch', label: '批次管理', icon: 'M8 2v4m8-4v4M3 9h18M5 5h14v16H5z' },
  { name: 'analysis', label: '分布分析', icon: 'M4 19V5m0 14h16M8 16v-5m4 5V8m4 8v-8' },
  { name: 'playback', label: '回放', icon: 'M8 5v14l11-7zM4 5v14' },
  { name: 'settings', label: '设置', icon: 'M12 15a3 3 0 100-6 3 3 0 000 6z' },
]

const current = ref<RouteName>((location.hash.replace('#/', '') as RouteName) || 'house')

window.addEventListener('hashchange', () => {
  const name = location.hash.replace('#/', '') as RouteName
  if (routes.some((r) => r.name === name)) current.value = name
})

export function useRouter() {
  const route = computed(() => current.value)
  const go = (name: RouteName) => {
    location.hash = `#/${name}`
    current.value = name
  }
  return { route, go, routes }
}
