// Хранилище: настройки в localStorage, тексты книг и «библии» в IndexedDB (та же база, что была в старом кабинете).
export const ls = {
  get: (k, f) => { try { const v = localStorage.getItem(k); return v === null ? f : JSON.parse(v) } catch { return f } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* storage blocked */ } },
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5)

const idbDo = async (mode, fn) => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('cab_lib_db', 1)
    r.onupgradeneeded = () => r.result.createObjectStore('docs')
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
  return new Promise((res, rej) => {
    const t = db.transaction('docs', mode)
    const rq = fn(t.objectStore('docs'))
    t.oncomplete = () => res(rq?.result)
    t.onerror = () => rej(t.error)
  })
}
export const docGet = (id) => idbDo('readonly', (st) => st.get(id))
export const docPut = (id, v) => idbDo('readwrite', (st) => st.put(v, id))
export const docDel = (id) => idbDo('readwrite', (st) => st.delete(id))
