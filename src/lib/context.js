// Контекст для помощников: библия цикла и книги, подходящие к вопросу главы, стиль, вкус и уроки автора.
// Именно он заменяет «обучение»: всё, что изучено и выбрано, попадает в каждый запрос.
import { who } from './agents'
import { cut, stemsOf, score } from './text'
import { chapterLine } from './bible'

const hname = (id) => (id === 'me' ? 'сам автор' : who(id).n)
export const LIMIT = 26000

export function tasteText(taste) {
  if (!taste) return ''
  const hc = taste.hc || {}
  const tot = Object.values(hc).reduce((a, b) => a + b, 0)
  const lines = []
  if (taste.rules) lines.push(`Правила вкуса автора (выведены из его выборов):\n${cut(taste.rules, 1200)}`)
  if (tot >= 3) lines.push(`Чаще всего автор выбирает идеи: ${Object.entries(hc).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${hname(k)} (${v})`).join(', ')}.`)
  const picks = (taste.picks || []).slice(-10), skips = (taste.skips || []).slice(-6)
  if (picks.length) lines.push(`Недавно выбранные автором идеи (ориентир вкуса):\n${picks.map((p) => `+ ${cut(p.t, 160)}`).join('\n')}`)
  if (skips.length) lines.push(`Недавно отвергнутые идеи (так не надо):\n${skips.map((p) => `– ${cut(p.t, 130)}`).join('\n')}`)
  return lines.join('\n')
}

export const lessonsText = (taste) => (taste?.lessons?.length ? taste.lessons.slice(-20).map((l) => `- ${l}`).join('\n') : '')

// Книги того же цикла по порядку; книга без цикла — сама по себе.
export const seriesDocs = (docs, d) => (d?.series ? docs.filter((x) => x.series === d.series).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) : d ? [d] : [])

// Главы, подходящие к вопросу, из всех книг цикла (не только последние).
function relevant(books, bibles, query, skip) {
  const stems = stemsOf(query)
  if (!stems.length) return []
  const all = books.flatMap((d) => (bibles[d.id]?.chapters || []).map((c, i) => c && { d, c, i })).filter(Boolean)
  return all.filter((x) => !skip(x)).map((x) => ({ ...x, s: score(chapterLine(x.c), stems) })).filter((x) => x.s > 3).sort((a, b) => b.s - a.s).slice(0, 6)
}

export function buildContext({ docs, bibles, series = {}, activeId, notes, taste, passages = '', query = '', withSample = false }) {
  const parts = []
  const a = docs.find((d) => d.id === activeId)
  const b = a && bibles[a.id]
  const books = seriesDocs(docs, a)
  // Суть книги идёт первой: это то, что помощники обязаны держать в голове всегда.
  const core = b?.core || [...books].reverse().map((d) => bibles[d.id]?.core).find(Boolean)
  if (core) parts.push(`[СУТЬ КНИГИ: главное, от чего нельзя отходить]\n${cut(core, 2000)}`)
  if (notes) parts.push(`[О книгах автора]\n${cut(notes, 2000)}`)
  const sb = a?.series && series[a.series]
  if (sb) {
    parts.push([
      `[Цикл «${a.series}»: ${books.length} кн., книга в работе — ${books.findIndex((d) => d.id === a.id) + 1}-я]`,
      sb.brief && `Сквозной сюжет: ${sb.brief}`,
      sb.characters && `Сквозные герои и их арки:\n${cut(sb.characters, 2500)}`,
      sb.world && `Правила мира цикла:\n${cut(sb.world, 1500)}`,
      sb.threads && `Незакрытые линии цикла:\n${cut(sb.threads, 1500)}`,
      sb.timeline && `Хронология цикла:\n${cut(sb.timeline, 1500)}`,
    ].filter(Boolean).join('\n'))
  }
  const sib = books.filter((d) => d.id !== activeId && bibles[d.id]?.brief)
  if (sib.length) parts.push(`[Книги цикла]\n${sib.map((d) => `«${d.name}»: ${cut(bibles[d.id].brief, 500)}`).join('\n')}`)
  const others = docs.filter((d) => !books.includes(d) && d.on !== false && bibles[d.id]?.brief)
  if (others.length) parts.push(`[Другие книги автора]\n${others.map((d) => `«${d.name}»: ${cut(bibles[d.id].brief, 400)}`).join('\n')}`)
  if (a && b) {
    const done = b.chapters.map((c, i) => c && { c, i }).filter(Boolean)
    const last = done.slice(-8)
    const lastIdx = new Set(last.map((x) => x.i))
    const rel = relevant(books, bibles, query, (x) => x.d.id === a.id && lastIdx.has(x.i))
    parts.push([
      `[Книга в работе: «${a.name}»]`,
      b.brief && `О чём: ${b.brief}`,
      b.characters && `Герои:\n${cut(b.characters, 3000)}`,
      b.world && `Мир и правила:\n${cut(b.world, 1500)}`,
      b.threads && `Незакрытые линии:\n${cut(b.threads, 1500)}`,
      b.timeline && `Хронология:\n${cut(b.timeline, 1500)}`,
      rel.length && `Главы, связанные с вопросом:\n${rel.map((x) => `${x.d.id === a.id ? '' : `«${x.d.name}», `}${chapterLine(x.c, false)}`).join('\n')}`,
      last.length && `Последние главы (где остановился сюжет):\n${last.map((x, k) => chapterLine(x.c, k >= last.length - 3)).join('\n')}`,
    ].filter(Boolean).join('\n'))
  }
  const issues = [b?.issues, sb?.issues].filter((t) => t && !/^несостыковок не найдено/i.test(t))
  if (issues.length) parts.push(`[Найденные несостыковки канона: не повторяй их и помогай исправить]\n${cut(issues.join('\n'), 1500)}`)
  const style = b?.style || books.map((d) => bibles[d.id]?.style).find(Boolean) || others.map((d) => bibles[d.id].style).find(Boolean)
  if (style) parts.push(`[Стиль автора]\n${cut(style, 2000)}`)
  const l = lessonsText(taste)
  if (l) parts.push(`[Уроки из правок автора: соблюдай обязательно]\n${l}`)
  if (withSample && taste?.samples?.length) parts.push(`[Образец текста, принятого автором]\n${cut(taste.samples[taste.samples.length - 1], 2000)}`)
  const t = tasteText(taste)
  if (t) parts.push(`[Вкус автора]\n${t}`)
  if (passages) parts.push(`[Фрагменты книги]\n${passages}`)
  const out = parts.join('\n\n')
  // Если не влезли, сокращаем фрагменты, а не библию: она важнее.
  return (out.length > LIMIT && passages ? parts.slice(0, -1).join('\n\n') + `\n\n[Фрагменты книги]\n${passages.slice(0, Math.max(2000, LIMIT - out.length + passages.length))}` : out).slice(0, LIMIT) || '[Материалов о книге пока нет]'
}
