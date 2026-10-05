// «Библия книги»: пересказ каждой главы, затем герои, мир, незакрытые линии и стиль автора.
import { docGet, docPut } from './store'
import { splitUnits, sample, parseJSON, asText, styleStats } from './text'

export const bibleKey = (id) => `bible:${id}`
export const emptyBible = (n) => ({ v: 1, chapters: Array(n).fill(null), brief: '', characters: '', world: '', threads: '', style: '', stats: null, synthDone: -1 })
export const doneCount = (b) => (b ? b.chapters.filter(Boolean).length : 0)

const CH = 'Ты литературный аналитик. Прочитай главу и верни ТОЛЬКО JSON без пояснений и markdown: {"summary":"пересказ главы в 2-3 предложениях, до 70 слов: что произошло и чем закончилось","who":["имена героев, действующих в главе"],"facts":["до 4 важных фактов канона: даты, места, правила мира, обещания, тайны"]}. Отвечай по-русски.'
const COMPRESS = 'Сожми этот список пересказов глав в связный пересказ до 250 слов: сохрани ключевые события по порядку, героев и развилки. Без вступлений. Отвечай по-русски.'
const SYN = 'Ты литературный аналитик. По пересказам глав составь «библию книги». Верни ТОЛЬКО JSON: {"brief":"о чём книга и где сюжет остановился, до 90 слов","characters":"главные герои: имя — роль, цель, характер, отношения; каждый с новой строки, до 12 героев","world":"мир, эпоха, правила, технологии, география, до 80 слов","threads":"незакрытые сюжетные линии, тайны и обещания, списком до 8 пунктов"}. Отвечай по-русски.'
const STYLE = 'Опиши авторский стиль по отрывкам как инструкцию тому, кто будет писать продолжение его голосом. 6-8 коротких правил: ритм и длина фраз, лексика и обороты, как строятся диалоги, тон и юмор, типичные приёмы сцены и главы, чего автор избегает. До 130 слов, без вступлений и похвалы. Отвечай по-русски.'

const arr = (v) => (Array.isArray(v) ? v.map(String) : [])
const abortErr = () => Object.assign(new Error('Остановлено'), { name: 'AbortError' })
function chunks(text, size) {
  const out = []
  let cur = ''
  for (const ln of text.split('\n')) {
    if (cur && cur.length + ln.length > size) { out.push(cur); cur = '' }
    cur += (cur ? '\n' : '') + ln
  }
  return cur ? [...out, cur] : out
}

async function synthesize(bible, run) {
  let text = bible.chapters.filter(Boolean).map((c) => `${c.title}: ${c.summary}`).join('\n')
  for (let g = 0; text.length > 12000 && g < 3; g++) {
    const parts = []
    for (const ch of chunks(text, 10000)) parts.push((await run(`${COMPRESS}\n\n${ch}`)).trim())
    text = parts.join('\n')
  }
  const freq = {}
  bible.chapters.forEach((c) => c?.who?.forEach((n) => { freq[n] = (freq[n] || 0) + 1 }))
  const names = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([n, c]) => `${n} (${c})`).join(', ')
  const facts = bible.chapters.flatMap((c) => c?.facts || []).slice(-25).join('; ')
  const raw = await run(`${SYN}\n\n[Частота героев по главам]\n${names || 'нет'}\n[Факты канона из глав]\n${facts || 'нет'}\n[Пересказы глав]\n${text}`)
  const j = parseJSON(raw)
  if (j && typeof j === 'object' && !Array.isArray(j) && j.brief) {
    return { brief: asText(j.brief), characters: asText(j.characters), world: asText(j.world), threads: asText(j.threads) }
  }
  return { brief: raw.replace(/\s+/g, ' ').trim().slice(0, 700), characters: '', world: '', threads: '' }
}

async function styleOf(text, run) {
  const stats = styleStats(text), n = text.length, L = 2200
  const parts = [0.12, 0.5, 0.85].map((f) => text.slice(Math.floor(n * f), Math.floor(n * f) + L)).filter((s) => s.trim())
  const ai = await run(`${STYLE}\n\n${parts.join('\n[…]\n')}`)
  return { stats, style: `Цифры: средняя фраза ${stats.sentLen} слов, абзац ${stats.paraLen} слов, диалог в ${stats.dialogShare}% абзацев.\n${ai.trim()}` }
}

// Возобновляемый разбор: каждая глава сохраняется сразу, поэтому после остановки или лимита можно продолжить.
export async function studyBook({ doc, text, run, signal, onStep }) {
  const units = splitUnits(text)
  let bible = await docGet(bibleKey(doc.id)).catch(() => null)
  if (!bible || bible.chapters.length !== units.length) bible = emptyBible(units.length)
  const snap = () => ({ ...bible, chapters: [...bible.chapters] })
  const r = (p) => run(p, { signal })
  for (let i = 0; i < units.length; i++) {
    if (bible.chapters[i]) continue
    if (signal?.aborted) throw abortErr()
    onStep({ phase: 'chapters', i, n: units.length, bible: snap() })
    const raw = await r(`${CH}\n\n[Глава: ${units[i].title}]\n${sample(units[i].text)}`)
    const j = parseJSON(raw)
    bible.chapters[i] = j && typeof j === 'object' && !Array.isArray(j) && j.summary
      ? { title: units[i].title, summary: String(j.summary).slice(0, 600), who: arr(j.who).slice(0, 12), facts: arr(j.facts).slice(0, 5) }
      : { title: units[i].title, summary: raw.replace(/\s+/g, ' ').trim().slice(0, 500), who: [], facts: [] }
    await docPut(bibleKey(doc.id), bible)
  }
  const done = doneCount(bible)
  if (bible.synthDone !== done) {
    onStep({ phase: 'summary', i: units.length, n: units.length, bible: snap() })
    Object.assign(bible, await synthesize(bible, r), { synthDone: done })
    await docPut(bibleKey(doc.id), bible)
  }
  if (!bible.style) {
    onStep({ phase: 'style', i: units.length, n: units.length, bible: snap() })
    Object.assign(bible, await styleOf(text, r))
    await docPut(bibleKey(doc.id), bible)
  }
  onStep({ phase: 'done', i: units.length, n: units.length, bible: snap() })
  return bible
}
