// IndexedDB 轻量封装
import type {
  Batch,
  BatchReport,
  EquipmentLayout,
  HuddleEvent,
  HouseProfile,
  Settings,
} from '@/types'

const DB_NAME = 'flock-scope'
const DB_VERSION = 1

export const STORES = {
  houses: 'houses',
  layouts: 'layouts',
  batches: 'batches',
  huddles: 'huddles',
  reports: 'reports',
  settings: 'settings',
} as const

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORES.houses)) db.createObjectStore(STORES.houses, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(STORES.layouts)) db.createObjectStore(STORES.layouts, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(STORES.batches)) db.createObjectStore(STORES.batches, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(STORES.huddles)) {
        const s = db.createObjectStore(STORES.huddles, { keyPath: 'id', autoIncrement: true })
        s.createIndex('batchId', 'batchId')
        s.createIndex('frameIndex', 'frameIndex')
      }
      if (!db.objectStoreNames.contains(STORES.reports)) db.createObjectStore(STORES.reports, { keyPath: 'batchId' })
      if (!db.objectStoreNames.contains(STORES.settings)) db.createObjectStore(STORES.settings, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode)
        const req = fn(t.objectStore(store))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

export async function putRecord<T>(store: string, value: T): Promise<IDBValidKey> {
  return tx(store, 'readwrite', (s) => s.put(value))
}

export async function getRecord<T>(store: string, key: string): Promise<T | undefined> {
  return tx(store, 'readonly', (s) => s.get(key) as IDBRequest<T>)
}

export async function getAllRecords<T>(store: string): Promise<T[]> {
  return tx(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>)
}

export async function deleteRecord(store: string, key: string): Promise<void> {
  await tx(store, 'readwrite', (s) => s.delete(key))
}

export async function getIndexAll<T>(store: string, indexName: string, value: IDBValidKey): Promise<T[]> {
  return openDb().then(
    (db) =>
      new Promise<T[]>((resolve, reject) => {
        const t = db.transaction(store, 'readonly')
        const req = t.objectStore(store).index(indexName).getAll(value)
        req.onsuccess = () => resolve(req.result as T[])
        req.onerror = () => reject(req.error)
      }),
  )
}

export const db = {
  houses: {
    put: (v: HouseProfile) => putRecord(STORES.houses, v),
    get: (id: string) => getRecord<HouseProfile>(STORES.houses, id),
    all: () => getAllRecords<HouseProfile>(STORES.houses),
    del: (id: string) => deleteRecord(STORES.houses, id),
  },
  layouts: {
    put: (v: EquipmentLayout) => putRecord(STORES.layouts, v),
    get: (id: string) => getRecord<EquipmentLayout>(STORES.layouts, id),
    all: () => getAllRecords<EquipmentLayout>(STORES.layouts),
    del: (id: string) => deleteRecord(STORES.layouts, id),
  },
  batches: {
    put: (v: Batch) => putRecord(STORES.batches, v),
    get: (id: string) => getRecord<Batch>(STORES.batches, id),
    all: () => getAllRecords<Batch>(STORES.batches),
    del: (id: string) => deleteRecord(STORES.batches, id),
  },
  huddles: {
    put: (v: HuddleEvent) => putRecord(STORES.huddles, v),
    byBatch: (batchId: string) => getIndexAll<HuddleEvent>(STORES.huddles, 'batchId', batchId),
    clearBatch: async (batchId: string) => {
      const list = await getIndexAll<HuddleEvent>(STORES.huddles, 'batchId', batchId)
      await Promise.all(list.map((h) => deleteRecord(STORES.huddles, String((h as { id?: IDBValidKey }).id ?? ''))))
    },
  },
  reports: {
    put: (v: BatchReport) => putRecord(STORES.reports, v),
    get: (batchId: string) => getRecord<BatchReport>(STORES.reports, batchId),
  },
  settings: {
    put: (v: Settings) => putRecord(STORES.settings, v),
    get: () => getRecord<Settings>(STORES.settings, 'app'),
  },
}
