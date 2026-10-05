// «Библия книги»: подробный разбор каждой главы целиком, затем герои, мир, хронология, незакрытые линии,
// проверка несостыковок и стиль автора. Для цикла (папки с несколькими книгами) — сводная библия всего цикла.
import { docGet, docPut } from './store'
import { splitUnits, parseJSON, asText, styleStats, cut } from './text'

export const bibleKey = (id) => `bible:${id}`
export const seriesKey = (name) => `series:${name}`
export const V = 2
export const emptyBible = (n) => ({ v: V, chapters: Array(n).fill(null), brief: '', characters: '', world: '', threads: '', timeline: '', issues: '', style: '', stats: null, synthDone: -1, checkDone: -1 })
export const doneCount = (b) => (b ? b.chapters.filter(Boolean).length : 0)
// Библия, изученная прежней (краткой) версией разбора: её стоит переизучить подробно.
export const isShallow = (b) => !!b && (b.v || 1) < V

const LANG = 'Отвечай по-русски.'
const ANALYST = `Ты внимательный литературный аналитик и редактор-континуитетчик. Читаешь текст целиком и ничего не выдумываешь: всё, что пишешь, должно прямо следовать из текста. Имена пиши так, как в тексте. ${LANG}`
const CH = `Прочитай главу целиком и верни ТОЛЬКО JSON без пояснений и markdown:
{"summary":"подробный пересказ главы: 5-8 предложений, до 170 слов, что произошло, почему и чем закончилось",
"events":["ключевые события по порядку, до 8 пунктов"],
"who":["имена всех действующих в главе героев"],
"changes":["Имя: что изменилось у героя — цель, отношения, знание, статус, ранение, решение; до 6 пунктов"],
"facts":["важные факты канона, которые нельзя нарушить дальше: даты, возраст, места, правила мира, техника, обещания, тайны, кто что знает; до 10 пунктов"],
"place":"где происходит действие","time":"когда происходит и сколько времени прошло",
"opened":["вопросы, тайны и линии, которые глава открывает"],"closed":["линии, которые глава закрывает"],
"hook":"чем глава заканчивается и какой вопрос оставляет читателю"}`
const PART = 'Это часть длинной главы. Разбери только эту часть по той же схеме JSON.'
const RETRY = 'Предыдущий ответ не удалось разобрать. Верни СТРОГО валидный JSON по схеме, без текста до и после.'
const COMPRESS = `Сожми этот список разборов глав в связный подробный пересказ до 450 слов: сохрани по порядку все ключевые события, решения героев, раскрытые тайны, развилки и где сюжет остановился. Без вступлений. ${LANG}`
const SYN = `По подробным разборам глав составь «библию книги» для соавторов, которые будут писать продолжение. Верни ТОЛЬКО JSON:
{"brief":"о чём книга, главный конфликт и где сюжет остановился, до 160 слов",
"characters":"герои: «Имя — роль; цель; характер и манера речи; отношения; арка: каким был в начале → каким стал к концу». Каждый с новой строки, до 20 героев, главные первыми",
"world":"мир, эпоха, география, правила, технологии и ограничения, до 220 слов",
"threads":"незакрытые сюжетные линии, тайны, обещания и ружья на стене: каждый пункт с новой строки, с указанием главы, где линия появилась; до 15 пунктов",
"timeline":"хронология: ключевые события по порядку с привязкой к главам и времени; до 18 пунктов, каждый с новой строки"}`
const CHECK = `Ты проверяешь канон на несостыковки. Ниже факты и изменения героев по главам. Найди РЕАЛЬНЫЕ противоречия: разные имена, даты, возраст, внешность, кто где находился, погибшие, которые снова действуют, нарушенные правила мира, герой знает то, чего не мог знать, сломанная хронология. Каждое противоречие — одной строкой с указанием глав: «Главы X и Y: …». Если противоречий нет, напиши ровно «Несостыковок не найдено». Не придумывай проблем на пустом месте. ${LANG}`
const STYLE = `Опиши авторский стиль по отрывкам как подробную инструкцию тому, кто будет писать продолжение его голосом. 10-12 коротких правил: ритм и длина фраз, лексика и характерные слова и обороты (приведи 5-8 примеров прямо из текста), как строятся диалоги и ремарки, как подаются мысли героя, тон и юмор, как начинаются и заканчиваются сцены и главы, описания и детали, от какого лица и в каком времени ведётся рассказ, чего автор избегает. До 240 слов, без вступлений и похвалы. ${LANG}`
const SERIES = `Ниже библии всех книг одного цикла по порядку. Составь сводную «библию цикла» для соавторов, которые будут писать следующую книгу. Верни ТОЛЬКО JSON:
{"brief":"сквозной сюжет всего цикла по книгам и где он остановился, до 250 слов",
"characters":"сквозные герои: «Имя — роль; арка через книги: книга 1 → книга 2 → …; отношения». Каждый с новой строки, до 25 героев",
"world":"единые правила мира цикла и как мир менялся от книги к книге, до 250 слов",
"threads":"линии, открытые в одной книге и не закрытые к концу цикла, с указанием книги; до 20 пунктов",
"timeline":"хронология цикла: ключевые события по книгам, до 25 пунктов"}`
const SCHECK = `Ты проверяешь весь цикл книг на несостыковки МЕЖДУ книгами и внутри них: имена, возраст, даты, кто жив, кто что знает, правила мира, техника, география, повторы сюжетных ходов. Каждое противоречие одной строкой с указанием книг и глав. Если противоречий нет, напиши ровно «Несостыковок не найдено». Не придумывай проблем. ${LANG}`

const arr = (v, n) => (Array.isArray(v) ? v.map(asText).filter(Boolean).slice(0, n) : typeof v === 'string' && v.trim() ? [v.trim()] : [])
const abortErr = () => Object.assign(new Error('Остановлено'), { name: 'AbortError' })
const obj = (j) => j && typeof j === 'object' && !Array.isArray(j)
function chunks(text, size) {
  const out = []
  let cur = ''
  for (const ln of text.split('\n')) {
    if (cur && cur.length + ln.length > size) { out.push(cur); cur = '' }
    cur += (cur ? '\n' : '') + ln
  }
  return cur ? [...out, cur] : out
}
const sys = { system: ANALYST, temperature: 0.2 }

// JSON с одной повторной попыткой: подробный разбор дороже потерять, чем сделать лишний запрос.
async function askJSON(run, prompt, ok) {
  const raw = await run(prompt, sys)
  const j = parseJSON(raw)
  if (ok(j)) return { j, raw }
  const raw2 = await run(`${RETRY}\n\n${prompt}`, sys)
  const j2 = parseJSON(raw2)
  return ok(j2) ? { j: j2, raw: raw2 } : { j: null, raw: raw2 || raw }
}

// Глава читается ЦЕЛИКОМ. Слишком длинная делится на части, разборы частей сливаются.
const FULL = 28000
async function analyzeChapter(unit, run) {
  const parts = unit.text.length <= FULL ? [unit.text] : chunks(unit.text, 22000)
  const rs = []
  for (const [k, p] of parts.entries()) {
    const head = parts.length > 1 ? `${PART} (часть ${k + 1} из ${parts.length})\n` : ''
    rs.push(await askJSON(run, `${CH}\n${head}\n[Глава: ${unit.title}]\n${p}`, (j) => obj(j) && j.summary))
  }
  const js = rs.map((r) => r.j).filter(Boolean)
  if (!js.length) return { title: unit.title, summary: rs.map((r) => r.raw).join(' ').replace(/\s+/g, ' ').trim().slice(0, 900), events: [], who: [], changes: [], facts: [], opened: [], closed: [], place: '', time: '', hook: '', d: V }
  const all = (k, n) => [...new Set(js.flatMap((j) => arr(j[k], n)))].slice(0, n)
  return {
    title: unit.title,
    summary: js.map((j) => asText(j.summary)).join(' ').slice(0, 1400),
    events: all('events', 12), who: all('who', 20), changes: all('changes', 10), facts: all('facts', 14),
    opened: all('opened', 8), closed: all('closed', 8),
    place: [...new Set(js.map((j) => asText(j.place)).filter(Boolean))].join('; ').slice(0, 200),
    time: [...new Set(js.map((j) => asText(j.time)).filter(Boolean))].join('; ').slice(0, 200),
    hook: asText(js[js.length - 1].hook).slice(0, 400),
    d: V,
  }
}

// Строка главы для сводных запросов: чем подробнее, тем точнее библия и проверка.
export function chapterLine(c, full = true) {
  if (!c) return ''
  const meta = [c.place, c.time].filter(Boolean).join('; ')
  return [
    `${c.title}${meta ? ` [${meta}]` : ''}: ${c.summary}`,
    full && c.events?.length && `  События: ${c.events.join('; ')}`,
    full && c.changes?.length && `  Изменения героев: ${c.changes.join('; ')}`,
    full && c.opened?.length && `  Открыто: ${c.opened.join('; ')}`,
    full && c.closed?.length && `  Закрыто: ${c.closed.join('; ')}`,
    c.hook && `  Финал: ${c.hook}`,
  ].filter(Boolean).join('\n')
}

async function digest(lines, run, limit = 40000) {
  let text = lines.join('\n')
  for (let g = 0; text.length > limit && g < 3; g++) {
    const parts = []
    for (const ch of chunks(text, 20000)) parts.push((await run(`${COMPRESS}\n\n${ch}`, sys)).trim())
    text = parts.join('\n')
  }
  return text
}

const pick = (j, raw) => (obj(j) && j.brief
  ? { brief: asText(j.brief), characters: asText(j.characters), world: asText(j.world), threads: asText(j.threads), timeline: asText(j.timeline) }
  : { brief: raw.replace(/\s+/g, ' ').trim().slice(0, 1200), characters: '', world: '', threads: '', timeline: '' })

async function synthesize(bible, run) {
  const text = await digest(bible.chapters.filter(Boolean).map((c) => chapterLine(c)), run)
  const freq = {}
  bible.chapters.forEach((c) => c?.who?.forEach((n) => { freq[n] = (freq[n] || 0) + 1 }))
  const names = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([n, c]) => `${n} (${c})`).join(', ')
  const facts = cut(bible.chapters.filter(Boolean).map((c) => (c.facts?.length ? `${c.title}: ${c.facts.join('; ')}` : '')).filter(Boolean).join('\n'), 14000)
  const { j, raw } = await askJSON(run, `${SYN}\n\n[Частота героев по главам]\n${names || 'нет'}\n[Факты канона по главам]\n${facts || 'нет'}\n[Разборы глав]\n${text}`, (x) => obj(x) && x.brief)
  return pick(j, raw)
}

// Проверка несостыковок по всем главам, частями, если фактов много.
async function check(lines, run, prompt = CHECK) {
  const found = []
  for (const ch of chunks(lines.join('\n'), 24000)) {
    const t = (await run(`${prompt}\n\n${ch}`, sys)).trim()
    if (t && !/^несостыковок не найдено/i.test(t)) found.push(t)
  }
  return found.join('\n') || 'Несостыковок не найдено.'
}
const factLines = (b, prefix = '') => b.chapters.filter(Boolean).map((c) => `${prefix}${c.title}: ${[...(c.facts || []), ...(c.changes || [])].join('; ') || c.summary}`)

async function styleOf(text, run) {
  const stats = styleStats(text), n = text.length, L = 2500
  const parts = [0.04, 0.2, 0.38, 0.56, 0.74, 0.92].map((f) => text.slice(Math.floor(n * f), Math.floor(n * f) + L)).filter((s) => s.trim())
  // Отдельно кусок с самым плотным диалогом: по нему видно, как автор пишет реплики.
  let best = '', bs = -1
  for (let p = 0; p < n; p += 3000) { const t = text.slice(p, p + 3000), s = (t.match(/^\s*[—–-]\s/gm) || []).length; if (s > bs) { bs = s; best = t } }
  const ai = await run(`${STYLE}\n\n${parts.join('\n[…]\n')}${bs > 3 ? `\n[Фрагмент с диалогом]\n${best}` : ''}`, sys)
  return { stats, style: `Цифры: средняя фраза ${stats.sentLen} слов, абзац ${stats.paraLen} слов, диалог в ${stats.dialogShare}% абзацев.\n${ai.trim()}` }
}

// Возобновляемый разбор: каждая глава сохраняется сразу, поэтому после остановки или лимита можно продолжить.
export async function studyBook({ doc, text, run, signal, onStep, fresh = false }) {
  const units = splitUnits(text)
  let bible = fresh ? null : await docGet(bibleKey(doc.id)).catch(() => null)
  if (!bible || bible.chapters.length !== units.length) bible = emptyBible(units.length)
  if (isShallow(bible)) bible = emptyBible(units.length)
  const snap = () => ({ ...bible, chapters: [...bible.chapters] })
  const r = (p, o) => run(p, { ...o, signal })
  const n = units.length
  for (let i = 0; i < n; i++) {
    if (bible.chapters[i]) continue
    if (signal?.aborted) throw abortErr()
    onStep({ phase: 'chapters', i, n, bible: snap() })
    bible.chapters[i] = await analyzeChapter(units[i], r)
    await docPut(bibleKey(doc.id), bible)
  }
  const done = doneCount(bible)
  if (bible.synthDone !== done) {
    onStep({ phase: 'summary', i: n, n, bible: snap() })
    Object.assign(bible, await synthesize(bible, r), { synthDone: done })
    await docPut(bibleKey(doc.id), bible)
  }
  if (bible.checkDone !== done) {
    onStep({ phase: 'check', i: n, n, bible: snap() })
    Object.assign(bible, { issues: await check(factLines(bible), r), checkDone: done })
    await docPut(bibleKey(doc.id), bible)
  }
  if (!bible.style) {
    onStep({ phase: 'style', i: n, n, bible: snap() })
    Object.assign(bible, await styleOf(text, r))
    await docPut(bibleKey(doc.id), bible)
  }
  onStep({ phase: 'done', i: n, n, bible: snap() })
  return bible
}

// Подпись состояния цикла: если книги доизучены или добавлены, сводную библию нужно пересобрать.
export const seriesSig = (docs, bibles) => docs.map((d) => `${d.id}:${doneCount(bibles[d.id])}`).join('|')

// Сводная библия цикла: склеивает библии книг по порядку и проверяет несостыковки между книгами.
export async function studyCycle({ name, docs, bibles, run, signal, onStep }) {
  const r = (p, o) => run(p, { ...o, signal })
  const sig = seriesSig(docs, bibles)
  let sb = await docGet(seriesKey(name)).catch(() => null)
  if (sb?.sig === sig && sb.brief && sb.issues) return sb
  sb = { v: V, name, sig, books: docs.map((d) => d.id) }
  const books = docs.map((d, i) => {
    const b = bibles[d.id] || {}
    return [`=== Книга ${i + 1}: «${d.name}» ===`, b.brief && `О чём: ${b.brief}`, b.characters && `Герои:\n${b.characters}`, b.world && `Мир:\n${b.world}`, b.threads && `Незакрытые линии:\n${b.threads}`, b.timeline && `Хронология:\n${b.timeline}`].filter(Boolean).join('\n')
  })
  if (signal?.aborted) throw abortErr()
  onStep({ phase: 'series', i: 0, n: 2 })
  const text = await digest(books, r, 50000)
  const { j, raw } = await askJSON(r, `${SERIES}\n\n${text}`, (x) => obj(x) && x.brief)
  Object.assign(sb, pick(j, raw))
  await docPut(seriesKey(name), sb)
  if (signal?.aborted) throw abortErr()
  onStep({ phase: 'seriesCheck', i: 1, n: 2 })
  const lines = docs.flatMap((d, i) => (bibles[d.id] ? factLines(bibles[d.id], `Книга ${i + 1} «${d.name}», `) : []))
  sb.issues = await check(lines, r, SCHECK)
  await docPut(seriesKey(name), sb)
  onStep({ phase: 'done', i: 2, n: 2 })
  return sb
}
