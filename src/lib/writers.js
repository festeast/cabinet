// Специализация писарей: у каждого свои указания автора и своя память о том, какие его варианты
// автор выбирал, какие отвергал и почему. Раз в несколько оценок писарь сам выводит из них правила.
import { ls } from './store'
import { cut } from './text'
import { SCRIBE } from './agents'

const KEY = 'cab_writers'
const all = () => ls.get(KEY, {})
export const prof = (id) => ({ mine: '', notes: '', fb: [], fresh: 0, ...(all()[id] || {}) })
export function saveProf(id, patch) {
  const a = all()
  a[id] = { ...prof(id), ...patch }
  ls.set(KEY, a)
  return a[id]
}

// Выбор и замечание «почему не то» — сильный сигнал; просто невыбранный вариант — слабый, его не считаем.
export function feedback(id, item) {
  const p = prof(id)
  return saveProf(id, { fb: [...p.fb, { ...item, at: Date.now() }].slice(-40), fresh: p.fresh + (item.ok || item.why ? 1 : 0) })
}
export const ready = (id) => prof(id).fresh >= 4

export function systemOf(w) {
  const p = prof(w.id)
  return [
    SCRIBE, w.p,
    p.mine && `Личные указания автора тебе (выполняй обязательно):\n${p.mine}`,
    p.notes && `Чему ты научился у автора по его выборам и замечаниям:\n${p.notes}`,
  ].filter(Boolean).join('\n')
}

export async function distill(w, run) {
  const p = prof(w.id)
  const lines = p.fb.slice(-25).map((f) => `${f.ok ? '+' : '–'} ${cut(f.t, 220)}${f.why ? ` | автор сказал: ${f.why}` : ''}`).join('\n')
  const t = (await run(`Ты ${w.n}, писарь-соавтор. ${w.p}
Ниже твои прошлые варианты продолжения: какие автор выбрал (+), какие отверг (–) и что он о них сказал. Выведи 4-7 конкретных правил о том, чего автор ждёт именно от тебя: направление сюжета, тон, темп, герои, длина сцен, и чего избегать. Замечания автора важнее всего. Уточняй прежние правила, а не повторяй их. Каждое правило с новой строки с «- », до 150 слов, без вступлений. Отвечай по-русски.

[Прежние правила]
${p.notes || 'нет'}
[Твои варианты]
${lines}`, { temperature: 0.3 })).trim()
  if (t) saveProf(w.id, { notes: t, fresh: 0 })
  return t
}
