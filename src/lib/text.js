// Чистые функции работы с текстом: главы, фрагменты, цифры стиля, разбор JSON от модели.
// Заголовок главы: «Глава 5», «Глава V», «Глава пятая», «Chapter 3», «Часть 2», «Пролог», «Эпилог».
// Строка «Глава семьи кивнул.» — это текст, а не заголовок: после слова «глава» нужен номер.
const ORD = '(?:перв|втор|трет|четв[её]рт|пят|шест|седьм|восьм|девят|десят|одиннадцат|двенадцат|тринадцат|четырнадцат|пятнадцат|шестнадцат|семнадцат|восемнадцат|девятнадцат|двадцат|тридцат|сороков|пятидесят|шестидесят|семидесят|восьмидесят|девяност|сот|one|two|three|four|five|six|seven|eight|nine|ten)\\p{L}*'
const HEAD = new RegExp(`^[ \\t]*((?:(?:глава|chapter|часть|part)[ \\t]*(?:№[ \\t]*)?(?:\\d+|[IVXLC]+(?![\\p{L}\\p{N}])|${ORD})|пролог|эпилог|prologue|epilogue)(?![\\p{L}\\p{N}_])[^\\n]{0,80})$`, 'gimu')

export function chaptersOf(text) {
  const out = []
  let m
  HEAD.lastIndex = 0
  while ((m = HEAD.exec(text))) {
    const t = m[1].trim()
    // «Пролог» и «Эпилог» — заголовок, только если строка короткая, а не начало обычной фразы.
    if (/^(?:пролог|эпилог|prologue|epilogue)/i.test(t) && (t.length > 60 || /[.!?…]$/.test(t) && t.split(/\s+/).length > 6)) continue
    out.push({ title: t, at: m.index })
  }
  return out.length > 1 ? out : []
}

// Единицы анализа: главы, а если заголовков нет, куски по ~7000 знаков, разрезанные по границе абзаца,
// чтобы фраза и сцена не обрывались посередине.
export function splitUnits(text, size = 7000) {
  const ch = chaptersOf(text)
  if (ch.length) {
    const units = ch.map((c, i) => ({ title: c.title, text: text.slice(c.at, ch[i + 1]?.at ?? text.length) }))
    // Текст до первой главы (аннотация, предисловие) тоже часть книги.
    const pre = text.slice(0, ch[0].at)
    return pre.trim().length > 500 ? [{ title: 'Начало', text: pre }, ...units] : units
  }
  const out = []
  for (let p = 0, i = 1; p < text.length; i++) {
    let e = Math.min(text.length, p + size)
    if (e < text.length) {
      const nl = text.lastIndexOf('\n', e)
      if (nl > p + size * 0.6) e = nl + 1
      else { const dot = text.slice(p, e).search(/[.!?…][^.!?…]*$/); if (dot > size * 0.6) e = p + dot + 1 }
    }
    out.push({ title: `Часть ${i}`, text: text.slice(p, e) })
    p = e
  }
  return out
}

export function sample(text, head = 6000, tail = 2500) {
  return text.length <= head + tail ? text : `${text.slice(0, head)}\n[…]\n${text.slice(-tail)}`
}

export const cut = (s, n) => ((s || '').length > n ? `${s.slice(0, n - 1)}…` : s || '')

// Модели иногда оборачивают JSON в ```json и ставят лишние запятые.
export function parseJSON(s) {
  if (!s) return null
  const t = String(s).replace(/```(?:json)?/gi, '')
  const a = t.search(/[[{]/)
  if (a < 0) return null
  const close = t[a] === '{' ? '}' : ']'
  const b = t.lastIndexOf(close)
  if (b <= a) return null
  const body = t.slice(a, b + 1)
  for (const v of [body, body.replace(/,\s*([}\]])/g, '$1')]) {
    try { return JSON.parse(v) } catch { /* try next */ }
  }
  return null
}

export const asText = (v) => (Array.isArray(v) ? v.map(asText).join('\n') : v && typeof v === 'object' ? Object.values(v).map(asText).join('; ') : v == null ? '' : String(v)).trim()

export function styleStats(text) {
  const words = (s) => (s.match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu) || []).length
  const paras = text.split(/\n+/).map((s) => s.trim()).filter(Boolean)
  const dialog = paras.filter((p) => /^[—–]/.test(p) || /^-\s/.test(p)).length
  const sents = text.split(/(?<=[.!?…])\s+/).filter((s) => s.trim())
  const w = words(text)
  return {
    words: w,
    sentLen: sents.length ? Math.round((w / sents.length) * 10) / 10 : 0,
    paraLen: paras.length ? Math.round(w / paras.length) : 0,
    dialogShare: paras.length ? Math.round((dialog / paras.length) * 100) : 0,
  }
}

export const stemsOf = (q) => [...new Set((String(q).toLowerCase().match(/[a-zа-яё]{4,}/g) || []).map((w) => w.slice(0, 5)))]
// Оценка совпадения: важнее, сколько РАЗНЫХ слов вопроса нашлось, чем сколько раз встретилось одно имя.
export function score(text, stems) {
  const l = text.toLowerCase()
  let kinds = 0, tot = 0
  for (const w of stems) { const k = l.split(w).length - 1; if (k) { kinds++; tot += Math.min(k, 4) } }
  return kinds * 3 + tot
}

// Из книг достаём главу по номеру («глава 5») или самые подходящие фрагменты по словам вопроса.
// docs[0] — книга в работе, остальные — книги того же цикла: поиск идёт по всем сразу.
export function pickPassages(docs, query, limit = 16000) {
  const used = []
  let out = ''
  const num = query.match(/глав\S*\s*(?:№\s*)?(\d+)/i)
  const stems = stemsOf(query)
  const d0 = docs[0]
  if (num && d0) {
    const ch = chaptersOf(d0.text), n = +num[1]
    let i = ch.findIndex((c) => new RegExp(`(^|\\D)${n}(\\D|$)`).test(c.title))
    if (i < 0 && n <= ch.length) i = n - 1
    if (i >= 0) {
      const a = ch[i].at, b = ch[i + 1]?.at ?? d0.text.length
      out += `\n--- ${d0.name}, ${ch[i].title} ---\n${d0.text.slice(a, Math.min(b, a + 9000))}\n`
      used.push(`${d0.name}: ${ch[i].title}`)
    }
  }
  const size = 2000, scored = []
  docs.forEach((d, di) => {
    for (let p = 0; p < d.text.length; p += size) {
      const t = d.text.slice(p, p + size)
      scored.push({ di, p, t, s: stems.length ? score(t, stems) + (di === 0 ? 1 : 0) : 0 })
    }
  })
  const top = scored.filter((x) => x.s > 3).sort((a, b) => b.s - a.s).slice(0, 6).sort((a, b) => a.di - b.di || a.p - b.p)
  if (top.length) {
    for (const di of [...new Set(top.map((x) => x.di))]) {
      const xs = top.filter((x) => x.di === di)
      out += `\n--- ${docs[di].name} ---\n${xs.map((x) => x.t).join('\n[…]\n')}\n`
      used.push(`${docs[di].name}: фрагментов найдено: ${xs.length}`)
    }
  } else if (!used.length && d0) {
    // Ничего не нашлось: даём конец книги в работе — там, где сюжет остановился.
    out += `\n--- ${d0.name}, конец текста ---\n${d0.text.slice(-4000)}\n`
    used.push(`${d0.name}: конец текста`)
  }
  return { text: out.slice(0, limit), used }
}
