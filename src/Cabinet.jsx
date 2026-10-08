import { useEffect, useRef, useState } from 'react'
import './cabinet.css'
import { ls, docGet, docPut, docDel } from './lib/store'
import * as ai from './lib/ai'
import { buildContext, seriesDocs } from './lib/context'
import { pickPassages, cut } from './lib/text'
import { bibleKey, seriesKey, studyBook, studyCycle, priorOf } from './lib/bible'
import { readFileDoc, natural } from './lib/books'
import { BASE } from './lib/agents'
import Home from './views/Home'
import Library from './views/Library'
import Table from './views/Table'
import Chapter from './views/Chapter'

const NAV = [['home', 'Главная'], ['chapter', 'Новая глава'], ['table', 'Круглый стол'], ['library', 'Библиотека']]
const THEMES = [['aurora', 'Северное сияние'], ['sakura', 'Аниме: сакура'], ['neon', 'Аниме: неон-город'], ['fantasy', 'Фэнтези'], ['scifi', 'Фантастика'], ['history', 'Историческая проза'], ['noir', 'Детектив'], ['custom', 'Своя картинка']]

function UsageBar({ cap }) {
  const n = ai.used(), pct = Math.min(100, Math.round((n / cap) * 100)), out = ai.hits()
  return (
    <div className="usage" role="status">
      <span>Запросов сегодня: {n} из ~{cap} ({pct}%)</span>
      <span className="bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>
      {out.length > 0 && <span className="out">Лимит исчерпан: {out.map((o) => `${ai.short(o.id)} (${o.daily ? 'до завтра' : 'на минуту'})`).join(', ')}</span>}
    </div>
  )
}

export default function Cabinet() {
  const [key, setKey] = useState(() => sessionStorage.getItem('or_key') || ls.get('or_key', ''))
  const [input, setInput] = useState('')
  const [remember, setRemember] = useState(false)
  const [nav, setNav] = useState({ view: 'home' })
  const [models, setModels] = useState({ free: [], paid: [] })
  const [model, setModel] = useState(() => ls.get('cab_model', 'auto'))
  const [cap, setCap] = useState(50)
  const [capMan, setCapMan] = useState(() => ls.get('cab_capman', 'auto'))
  const [usePaid, setUsePaid] = useState(() => ls.get('cab_usepaid', false))
  const [paidModel, setPaidModel] = useState(() => ls.get('cab_paidm', ''))
  const [showSet, setShowSet] = useState(false)
  const [theme, setTheme] = useState(() => ls.get('cab_theme', 'aurora'))
  const [lib, setLib] = useState(() => ls.get('cab_lib', []))
  const [bibles, setBibles] = useState({})
  const [series, setSeries] = useState({})
  const [cycles, setCycles] = useState(() => ls.get('cab_cycles', []))
  const [notes, setNotes] = useState(() => ls.get('cab_notes', ''))
  const [taste, setTaste] = useState(() => ls.get('cab_taste', { picks: [], skips: [], hc: {}, samples: [] }))
  const [activeId, setActiveId] = useState(() => ls.get('cab_active', ''))
  const [job, setJob] = useState(null)
  const [studyErr, setStudyErr] = useState('')
  const [, setTick] = useState(0)
  const jobCtl = useRef(null)
  const distilling = useRef(false)
  const capEff = capMan === 'auto' ? cap : +capMan
  const active = lib.some((d) => d.id === activeId) ? activeId : lib[0]?.id || ''

  useEffect(() => { document.title = 'Кабинет автора' }, [])
  useEffect(() => ai.subscribe(() => setTick((t) => t + 1)), [])
  useEffect(() => { if (key) ai.loadCap(key).then(setCap) }, [key])
  useEffect(() => {
    ai.loadModels().then((m) => { setModels(m); setModel((cur) => (cur === 'auto' || (m.free.some((x) => x.id === cur) && !ai.isBad(cur)) ? cur : 'auto')) }).catch(() => {})
  }, [])
  useEffect(() => { ls.set('cab_model', model); ls.set('cab_usepaid', usePaid); ls.set('cab_paidm', paidModel); ls.set('cab_capman', capMan) }, [model, usePaid, paidModel, capMan])
  useEffect(() => { ls.set('cab_lib', lib) }, [lib])
  useEffect(() => { ls.set('cab_cycles', cycles) }, [cycles])
  useEffect(() => { ls.set('cab_notes', notes) }, [notes])
  useEffect(() => { ls.set('cab_active', active) }, [active])
  useEffect(() => {
    ls.set('cab_theme', theme)
    document.body.dataset.cabTheme = theme
    return () => { delete document.body.dataset.cabTheme }
  }, [theme])
  useEffect(() => {
    docGet('bg_img').then((u) => u && document.body.style.setProperty('--bgimg', `url("${u}")`)).catch(() => {})
    return () => document.body.style.removeProperty('--bgimg')
  }, [])
  const ids = lib.map((d) => d.id).join()
  useEffect(() => {
    let off = false
    ;(async () => {
      const m = {}
      for (const d of lib) { const b = await docGet(bibleKey(d.id)).catch(() => null); if (b) m[d.id] = b }
      const sm = {}
      for (const n of new Set(lib.map((d) => d.series).filter(Boolean))) { const b = await docGet(seriesKey(n)).catch(() => null); if (b) sm[n] = b }
      if (!off) { setBibles(m); setSeries(sm) }
    })()
    return () => { off = true }
  }, [ids]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = (prompt, o = {}) => ai.complete(key, prompt, { models: models.free, model, paid: { on: usePaid, id: paidModel }, cap: capEff, ...o })
  // Контекст для помощников: библия цикла и книги, связанные главы, стиль, вкус и уроки
  // (+ фрагменты текста, найденные по всем книгам цикла).
  async function ctx(query = '', o = {}) {
    const book = o.book || active
    let passages = '', used = []
    const d = lib.find((x) => x.id === book)
    if (o.passages !== false && d) {
      const books = [d, ...seriesDocs(lib, d).filter((x) => x.id !== d.id)]
      const texts = []
      for (const x of books) { const text = await docGet(x.id).catch(() => null); if (text) texts.push({ name: x.name, text }) }
      if (texts.length) { const r = pickPassages(texts, query); passages = r.text; used = r.used }
    }
    return { text: buildContext({ docs: lib, bibles, series, activeId: book, notes, taste, passages, query, withSample: !!o.sample }), used }
  }
  const saveTaste = (fn) => setTaste((t) => { const n = fn(t); ls.set('cab_taste', n); return n })
  const learn = ({ picked, skipped = [] }) => saveTaste((t) => {
    const n = { ...t, picks: [...(t.picks || [])], skips: [...(t.skips || [])], hc: { ...(t.hc || {}) } }
    if (picked) { n.picks.push({ h: picked.by, t: picked.text }); n.hc[picked.by] = (n.hc[picked.by] || 0) + 1 }
    skipped.forEach((s) => n.skips.push({ h: s.by, t: s.text }))
    n.picks = n.picks.slice(-80); n.skips = n.skips.slice(-80)
    n.fresh = (t.fresh || 0) + (picked ? 1 : 0) + skipped.length
    return n
  })
  const addSample = (text) => saveTaste((t) => ({ ...t, samples: [...(t.samples || []), text.slice(0, 2500)].slice(-3) }))
  const setLessons = (lessons) => saveTaste((t) => ({ ...t, lessons }))
  const setRules = (rules) => saveTaste((t) => ({ ...t, rules }))

  // Каждые 10 новых выборов помощники сами выводят из них правила вкуса автора.
  useEffect(() => {
    if (!key || distilling.current || (taste.fresh || 0) < 10 || (taste.picks || []).length < 5) return
    distilling.current = true
    const picks = taste.picks.slice(-40).map((p) => `+ ${cut(p.t, 200)}`).join('\n'), skips = (taste.skips || []).slice(-30).map((p) => `– ${cut(p.t, 160)}`).join('\n')
    run(`Ниже идеи, которые автор книги выбрал (+), и которые отверг (–). Выведи 6-8 точных правил его вкуса: какие ходы, тон, темп, типы поворотов и героев ему нравятся, а какие нет. Учитывай прежние правила, уточняй их, а не повторяй. Каждое правило с новой строки, начиная с «- », до 160 слов всего, без вступлений.\n\n[Прежние правила]\n${taste.rules || 'нет'}\n[Выбрано]\n${picks}\n[Отвергнуто]\n${skips || 'нет'}`, { system: BASE, temperature: 0.3 })
      .then((t) => { if (t.trim()) saveTaste((x) => ({ ...x, rules: t.trim(), fresh: 0 })) })
      .catch(() => {})
      .finally(() => { distilling.current = false })
  }, [taste.fresh, key]) // eslint-disable-line react-hooks/exhaustive-deps

  // Учимся на правках: сравниваем черновик ИИ с тем, что автор оставил, и сохраняем уроки.
  async function learnEdits(aiText, final) {
    const pa = (t) => t.split(/\n+/).map((x) => x.trim()).filter(Boolean)
    const A = pa(aiText), F = pa(final), sa = new Set(A), sf = new Set(F)
    const gone = A.filter((x) => !sf.has(x)), added = F.filter((x) => !sa.has(x))
    if (gone.join('').length + added.join('').length < 200) return 0
    const t = await run(`Сравни абзацы черновика ИИ, которые автор убрал или переписал, с абзацами, которые он написал вместо них. Сформулируй до 6 конкретных уроков для соавтора: что автор меняет в лексике, длине фраз, диалогах, подаче героев, что вычёркивает и что добавляет. Каждый урок одной строкой, начиная с «- », без вступлений.\n\n[Было у ИИ]\n${cut(gone.join('\n'), 7000)}\n\n[Стало у автора]\n${cut(added.join('\n'), 7000)}`, { system: BASE, temperature: 0.3 })
    const ls2 = t.split('\n').map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter((l) => l.length > 10).slice(0, 6)
    if (ls2.length) saveTaste((x) => ({ ...x, lessons: [...new Set([...(x.lessons || []), ...ls2])].slice(-30) }))
    return ls2.length
  }

  async function addDoc(meta, text) { await docPut(meta.id, text); setLib((l) => [meta, ...l]); setActiveId((a) => a || meta.id) }
  // Папка добавляется целиком, книги цикла — по порядку.
  async function addDocs(list) {
    for (const { meta, text } of list) await docPut(meta.id, text)
    setLib((l) => [...list.map((x) => x.meta), ...l]); setActiveId((a) => a || list[list.length - 1]?.meta.id || '')
  }
  async function renameSeries(from, to) {
    const n = to.trim()
    if (!n || n === from) return
    const sb = await docGet(seriesKey(from)).catch(() => null)
    if (sb) { await docPut(seriesKey(n), { ...sb, name: n }).catch(() => {}); await docDel(seriesKey(from)).catch(() => {}) }
    setLib((l) => l.map((d) => (d.series === from ? { ...d, series: n } : d)))
    setCycles((c) => [...new Set(c.map((x) => (x === from ? n : x)))])
  }
  // Цикл создаётся пустым, части добавляются в него по одной или пачкой (работает и на телефоне).
  const addCycle = (name) => { const n = name.trim(); if (n) setCycles((c) => (c.includes(n) ? c : [...c, n])) }
  async function addParts(name, files) {
    const fs = [...files].sort((a, b) => natural(a.name, b.name))
    const base = Math.max(-1, ...lib.filter((d) => d.series === name).map((d) => d.order ?? 0)) + 1
    const out = [], bad = []
    for (const f of fs) {
      try { const x = await readFileDoc(f); x.meta = { ...x.meta, name: f.name.replace(/\.[^.]+$/, ''), series: name, order: base + out.length }; out.push(x) } catch { bad.push(f.name) }
    }
    if (out.length) await addDocs(out.reverse())
    addCycle(name)
    return { added: out.length, bad }
  }
  async function removeCycle(name) {
    const docs = lib.filter((d) => d.series === name)
    if (docs.length && !confirm(`Удалить цикл «${name}» вместе с частями (${docs.length}) и всем изученным?`)) return
    for (const d of docs) { await docDel(d.id).catch(() => {}); await docDel(bibleKey(d.id)).catch(() => {}) }
    await docDel(seriesKey(name)).catch(() => {})
    setLib((l) => l.filter((d) => d.series !== name)); setCycles((c) => c.filter((x) => x !== name))
  }
  const setDocSeries = (id, name) => setLib((l) => {
    const n = name.trim(), max = Math.max(-1, ...l.filter((d) => d.series === n).map((d) => d.order ?? 0))
    return l.map((d) => (d.id === id ? { ...d, series: n || undefined, order: max + 1 } : d))
  })
  const moveDoc = (id, dir) => setLib((l) => {
    const d = l.find((x) => x.id === id), g = seriesDocs(l, d), i = g.indexOf(d), j = i + dir
    if (i < 0 || j < 0 || j >= g.length) return l
    const ord = new Map(g.map((x, k) => [x.id, k])); ord.set(g[i].id, j); ord.set(g[j].id, i)
    return l.map((x) => (ord.has(x.id) ? { ...x, order: ord.get(x.id) } : x))
  })
  async function removeDoc(id) {
    if (!confirm('Убрать из библиотеки вместе с изученным?')) return
    await docDel(id).catch(() => {}); await docDel(bibleKey(id)).catch(() => {})
    setLib((l) => l.filter((d) => d.id !== id))
  }
  const toggleDoc = (id) => setLib((l) => l.map((d) => (d.id === id ? { ...d, on: d.on === false } : d)))
  const setBible = (id, b) => setBibles((m) => ({ ...m, [id]: b }))
  const saveBible = (id, b) => { setBible(id, b); docPut(bibleKey(id), b).catch(() => {}) }
  const saveSeries = (n, b) => { setSeries((m) => ({ ...m, [n]: b })); docPut(seriesKey(n), b).catch(() => {}) }

  // onWait: модель занята или упёрлась в минутный лимит — показываем, что ждём, а не зависли.
  const jrun = (ac) => (p, x) => run(p, { ...x, signal: ac.signal, onWait: (ms) => setJob((j) => ({ ...j, wait: Date.now() + ms })), onModel: () => setJob((j) => (j?.wait ? { ...j, wait: 0 } : j)) })
  async function studyOne(doc, ac, o = {}) {
    const text = await docGet(doc.id)
    if (!text) throw new Error(`Текст книги «${doc.name}» не найден в библиотеке.`)
    const b = await studyBook({ doc, text, fresh: o.fresh, prior: o.prior || '', signal: ac.signal, run: jrun(ac), onStep: (s) => { setJob((j) => ({ ...j, book: doc.id, phase: s.phase, i: s.i, n: s.n })); setBible(doc.id, s.bible) } })
    setBible(doc.id, b)
    return b
  }
  async function guard(j, fn) {
    if (job) return
    setStudyErr('')
    const ac = new AbortController(); jobCtl.current = ac
    setJob({ phase: 'chapters', i: 0, n: 0, ...j })
    try { await fn(ac) } catch (e) {
      if (e.name !== 'AbortError') setStudyErr(`${e.message} Прогресс сохранён: нажмите «Продолжить изучение», когда лимит вернётся.`)
      if (j.book) { const b = await docGet(bibleKey(j.book)).catch(() => null); if (b) setBible(j.book, b) }
    }
    jobCtl.current = null; setJob(null)
  }
  // Часть цикла изучается «с продолжением»: ей передаётся память о всех прошлых частях.
  const priorFor = (doc, bs) => { const g = seriesDocs(lib, doc); return priorOf(g.slice(0, Math.max(0, g.findIndex((d) => d.id === doc.id))), bs) }
  const study = (doc, o = {}) => guard({ id: doc.id, book: doc.id }, (ac) => studyOne(doc, ac, { ...o, prior: doc.series ? priorFor(doc, bibles) : '' }))
  // Весь цикл: каждая книга подробно по порядку, затем сводная библия цикла и проверка несостыковок между книгами.
  const studySeries = (name, o = {}) => guard({ id: `series:${name}`, series: name }, async (ac) => {
    const docs = seriesDocs(lib, lib.find((d) => d.series === name))
    const bs = { ...bibles }
    for (const d of docs) bs[d.id] = await studyOne(d, ac, { ...o, prior: priorFor(d, bs) })
    setJob((j) => ({ ...j, book: '', phase: 'series' }))
    const sb = await studyCycle({ name, docs, bibles: bs, signal: ac.signal, run: jrun(ac), onStep: (s) => setJob((j) => ({ ...j, phase: s.phase })) })
    setSeries((m) => ({ ...m, [name]: sb }))
  })

  const app = { key, run, ctx, learn, addSample, learnEdits, setLessons, setRules, taste, lib, bibles, series, notes, setNotes, active, setActive: setActiveId, addDoc, addDocs, removeDoc, cycles, addCycle, addParts, removeCycle, toggleDoc, renameSeries, setDocSeries, moveDoc, saveBible, saveSeries, study, studySeries, stopStudy: () => jobCtl.current?.abort(), job, studyErr, capEff }
  const go = (view, arg) => setNav({ view, arg })

  function login(e) {
    e.preventDefault()
    const k = input.trim()
    if (!k) return
    sessionStorage.setItem('or_key', k)
    if (remember) ls.set('or_key', k)
    setKey(k)
  }
  function logout() { sessionStorage.removeItem('or_key'); localStorage.removeItem('or_key'); setKey(''); setInput(''); setNav({ view: 'home' }) }
  function onBg(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    const r = new FileReader()
    r.onload = async () => {
      try { await docPut('bg_img', r.result) } catch { /* picture just won't persist */ }
      document.body.style.setProperty('--bgimg', `url("${r.result}")`); setTheme('custom')
    }
    r.readAsDataURL(f)
  }

  if (!key) {
    return (
      <div className="cab cab-login">
        <form onSubmit={login}>
          <h1>Кабинет автора</h1>
          <p>Личное пространство для работы над книгами вместе с ИИ-помощниками. Введите ключ OpenRouter, чтобы войти.</p>
          <input type="password" autoComplete="off" placeholder="sk-or-v1-…" value={input} onChange={(e) => setInput(e.target.value)} aria-label="Ключ OpenRouter" />
          <label className="chk"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Запомнить на этом устройстве</label>
          <button className="go" disabled={!input.trim()}>Войти</button>
          <p className="muted">Ключ бесплатно создаётся на <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">openrouter.ai/keys</a>. Он хранится только в вашем браузере. Тексты книг отправляются в OpenRouter и выбранным моделям, поэтому в его настройках лучше запретить использование данных для обучения.</p>
        </form>
      </div>
    )
  }

  const warn = ai.used() >= capEff * 0.9 || ai.hits().length > 0
  return (
    <div className="cab">
      <header>
        <button className="brand" onClick={() => go('home')} aria-label="На главную">Кабинет автора</button>
        <nav aria-label="Разделы">
          {NAV.map(([v, t]) => <button key={v} className="ghost" aria-current={nav.view === v ? 'page' : undefined} onClick={() => go(v)}>{t}</button>)}
        </nav>
        <button className={`ghost${warn ? ' warn' : ''}`} aria-expanded={showSet} onClick={() => setShowSet((v) => !v)} title="Модели, лимиты, фон">⚙ {ai.used()}/{capEff}</button>
        <button className="ghost" onClick={logout}>Выйти</button>
      </header>
      {showSet && (
        <div className="set">
          <UsageBar cap={capEff} />
          <div className="row">
            <select value={model} onChange={(e) => setModel(e.target.value)} aria-label="Бесплатная модель ИИ">
              <option value="auto">Авто: модели меняются сами</option>
              {models.free.filter((m) => !ai.isBad(m.id)).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <select value={theme} onChange={(e) => setTheme(e.target.value)} aria-label="Фон">{THEMES.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select>
            <label className="ghost file" title="Загрузить свою картинку для фона">🖼 Фон<input type="file" accept="image/*" hidden onChange={onBg} /></label>
          </div>
          <p className="muted small">Платных запросов: {ls.get('cab_paidn', 0)}</p>
          <label className="chk"><input type="checkbox" checked={usePaid} disabled={!paidModel} onChange={(e) => setUsePaid(e.target.checked)} /> Когда бесплатный лимит исчерпан, использовать платную модель (деньги спишутся с баланса OpenRouter)</label>
          <div className="row">
            <select value={paidModel} onChange={(e) => setPaidModel(e.target.value)} aria-label="Платная модель"><option value="">Выберите платную модель…</option>{models.paid.map((m) => <option key={m.id} value={m.id}>{m.name} · ${m.c.toFixed(2)}/1М</option>)}</select>
            <select value={capMan} onChange={(e) => setCapMan(e.target.value)} aria-label="Дневной лимит бесплатных запросов"><option value="auto">Лимит: определить сам</option><option value="50">Лимит: 50 в день</option><option value="1000">Лимит: 1000 в день</option></select>
          </div>
          <p className="muted small">Задайте ключу лимит расходов в настройках OpenRouter: так платный режим не потратит лишнего.</p>
        </div>
      )}
      <div className="view">
        {nav.view === 'home' && <Home app={app} go={go} />}
        {nav.view === 'library' && <Library app={app} />}
        {nav.view === 'table' && <Table app={app} />}
        {nav.view === 'chapter' && <Chapter key={nav.arg?.brief || 'c'} app={app} arg={nav.arg} go={go} />}
      </div>
    </div>
  )
}
