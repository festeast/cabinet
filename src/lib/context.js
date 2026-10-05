// Контекст для помощников: «библия» книги + стиль + вкус автора. Именно он заменяет «обучение».
import { HELPERS } from './agents'
import { cut } from './text'

const hname = (id) => (id === 'me' ? 'сам автор' : HELPERS.find((h) => h.id === id)?.n || id)

export function tasteText(taste) {
  if (!taste) return ''
  const hc = taste.hc || {}
  const tot = Object.values(hc).reduce((a, b) => a + b, 0)
  const lines = []
  if (tot >= 3) lines.push(`Чаще всего автор выбирает идеи: ${Object.entries(hc).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${hname(k)} (${v})`).join(', ')}.`)
  const picks = (taste.picks || []).slice(-6), skips = (taste.skips || []).slice(-4)
  if (picks.length) lines.push(`Недавно выбранные автором идеи (ориентир вкуса):\n${picks.map((p) => `+ ${cut(p.t, 140)}`).join('\n')}`)
  if (skips.length) lines.push(`Недавно отвергнутые идеи (так не надо):\n${skips.map((p) => `– ${cut(p.t, 120)}`).join('\n')}`)
  return lines.join('\n')
}

export function buildContext({ docs, bibles, activeId, notes, taste, passages = '', withSample = false }) {
  const parts = []
  if (notes) parts.push(`[О книге автора]\n${cut(notes, 1500)}`)
  const others = docs.filter((d) => d.id !== activeId && d.on !== false && bibles[d.id]?.brief)
  if (others.length) parts.push(`[Другие книги автора]\n${others.map((d) => `«${d.name}»: ${cut(bibles[d.id].brief, 600)}`).join('\n')}`)
  const a = docs.find((d) => d.id === activeId)
  const b = a && bibles[a.id]
  if (a && b) {
    const last = b.chapters.filter(Boolean).slice(-8).map((c) => `${c.title}: ${cut(c.summary, 320)}`).join('\n')
    parts.push([
      `[Активная книга: «${a.name}»]`,
      b.brief && `О чём: ${b.brief}`,
      b.characters && `Герои:\n${b.characters}`,
      b.world && `Мир и правила:\n${b.world}`,
      b.threads && `Незакрытые линии:\n${b.threads}`,
      last && `Последние главы:\n${last}`,
    ].filter(Boolean).join('\n'))
  }
  const style = b?.style || others.map((d) => bibles[d.id].style).find(Boolean)
  if (style) parts.push(`[Стиль автора]\n${cut(style, 1200)}`)
  if (withSample && taste?.samples?.length) parts.push(`[Образец текста, принятого автором]\n${cut(taste.samples[taste.samples.length - 1], 1200)}`)
  const t = tasteText(taste)
  if (t) parts.push(`[Вкус автора]\n${t}`)
  if (passages) parts.push(`[Фрагменты книги]\n${passages}`)
  return parts.join('\n\n').slice(0, 14000) || '[Материалов о книге пока нет]'
}
