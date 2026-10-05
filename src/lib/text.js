// Чистые функции работы с текстом: главы, фрагменты, цифры стиля, разбор JSON от модели.
export function chaptersOf(text) {
  // \b в JS не работает с кириллицей, поэтому граница слова задана через \p{L}.
  const re = /^[ \t]*((?:глава|chapter|пролог|эпилог|часть(?=[ \t]+[\dIVX]))(?![\p{L}\p{N}_])[^\n]{0,80})$/gimu
  const out = []
  let m
  while ((m = re.exec(text))) out.push({ title: m[1].trim(), at: m.index })
  return out.length > 1 ? out : []
}

// Единицы анализа: главы, а если заголовков нет, куски по ~7000 знаков.
export function splitUnits(text, size = 7000) {
  const ch = chaptersOf(text)
  if (ch.length) return ch.map((c, i) => ({ title: c.title, text: text.slice(c.at, ch[i + 1]?.at ?? text.length) }))
  const out = []
  for (let p = 0, i = 1; p < text.length; p += size, i++) out.push({ title: `Часть ${i}`, text: text.slice(p, p + size) })
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

// Из книги достаём главу по номеру («глава 5») или самые подходящие фрагменты по словам вопроса.
export function pickPassages(docs, query) {
  const used = []
  let out = ''
  const num = query.match(/глав\S*\s*(?:№\s*)?(\d+)/i)
  const stems = [...new Set((query.toLowerCase().match(/[a-zа-яё]{4,}/g) || []).map((w) => w.slice(0, 5)))]
  for (const d of docs) {
    const ch = chaptersOf(d.text)
    if (num && ch.length) {
      const n = +num[1]
      let i = ch.findIndex((c) => new RegExp(`(^|\\D)${n}(\\D|$)`).test(c.title))
      if (i < 0 && n <= ch.length) i = n - 1
      if (i >= 0) {
        const a = ch[i].at, b = ch[i + 1]?.at ?? d.text.length
        out += `\n--- ${d.name}, ${ch[i].title} ---\n${d.text.slice(a, Math.min(b, a + 6000))}\n`
        used.push(`${d.name}: ${ch[i].title}`)
        continue
      }
    }
    const size = 1500, scored = []
    for (let p = 0; p < d.text.length; p += size) {
      const t = d.text.slice(p, p + size), l = t.toLowerCase()
      scored.push({ p, t, s: stems.reduce((n, w) => n + (l.split(w).length - 1), 0) })
    }
    const top = scored.filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 3).sort((a, b) => a.p - b.p)
    const use = top.length ? top : scored.slice(0, 2)
    out += `\n--- ${d.name} ---\n${use.map((x) => x.t).join('\n[…]\n')}\n`
    used.push(`${d.name}: ${top.length ? `фрагментов найдено: ${top.length}` : 'начало текста'}`)
  }
  return { text: out.slice(0, 14000), used }
}
