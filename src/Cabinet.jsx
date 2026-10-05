import { useEffect, useRef, useState } from 'react'
import './cabinet.css'
import { ls, docGet, docPut, docDel } from './lib/store'
import * as ai from './lib/ai'
import { buildContext } from './lib/context'
import { pickPassages } from './lib/text'
import { bibleKey, studyBook } from './lib/bible'
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
  const [notes, setNotes] = useState(() => ls.get('cab_notes', ''))
  const [taste, setTaste] = useState(() => ls.get('cab_taste', { picks: [], skips: [], hc: {}, samples: [] }))
  const [activeId, setActiveId] = useState(() => ls.get('cab_active', ''))
  const [job, setJob] = useState(null)
  const [studyErr, setStudyErr] = useState('')
  const [, setTick] = useState(0)
  const jobCtl = useRef(null)
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
      if (!off) setBibles(m)
    })()
    return () => { off = true }
  }, [ids]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = (prompt, o = {}) => ai.complete(key, prompt, { models: models.free, model, paid: { on: usePaid, id: paidModel }, cap: capEff, ...o })
  // Контекст для помощников: библия активной книги + стиль + вкус (+ найденные фрагменты текста).
  async function ctx(query = '', o = {}) {
    const book = o.book || active
    let passages = '', used = []
    const d = lib.find((x) => x.id === book)
    if (o.passages !== false && d) {
      const text = await docGet(d.id).catch(() => null)
      if (text) { const r = pickPassages([{ name: d.name, text }], query); passages = r.text; used = r.used }
    }
    return { text: buildContext({ docs: lib, bibles, activeId: book, notes, taste, passages, withSample: !!o.sample }), used }
  }
  const learn = ({ picked, skipped = [] }) => setTaste((t) => {
    const n = { picks: [...(t.picks || [])], skips: [...(t.skips || [])], hc: { ...(t.hc || {}) }, samples: t.samples || [] }
    if (picked) { n.picks.push({ h: picked.by, t: picked.text }); n.hc[picked.by] = (n.hc[picked.by] || 0) + 1 }
    skipped.forEach((s) => n.skips.push({ h: s.by, t: s.text }))
    n.picks = n.picks.slice(-40); n.skips = n.skips.slice(-40)
    ls.set('cab_taste', n)
    return n
  })
  const addSample = (text) => setTaste((t) => {
    const n = { ...t, samples: [...(t.samples || []), text.slice(0, 1500)].slice(-3) }
    ls.set('cab_taste', n)
    return n
  })

  async function addDoc(meta, text) { await docPut(meta.id, text); setLib((l) => [meta, ...l]); setActiveId((a) => a || meta.id) }
  async function removeDoc(id) {
    if (!confirm('Убрать из библиотеки вместе с изученным?')) return
    await docDel(id).catch(() => {}); await docDel(bibleKey(id)).catch(() => {})
    setLib((l) => l.filter((d) => d.id !== id))
  }
  const toggleDoc = (id) => setLib((l) => l.map((d) => (d.id === id ? { ...d, on: d.on === false } : d)))
  const setBible = (id, b) => setBibles((m) => ({ ...m, [id]: b }))
  const saveBible = (id, b) => { setBible(id, b); docPut(bibleKey(id), b).catch(() => {}) }

  async function study(doc) {
    if (job) return
    setStudyErr('')
    const ac = new AbortController(); jobCtl.current = ac
    setJob({ id: doc.id, phase: 'chapters', i: 0, n: 0 })
    try {
      const text = await docGet(doc.id)
      if (!text) throw new Error('Текст книги не найден в библиотеке.')
      const b = await studyBook({ doc, text, signal: ac.signal, run: (p, o) => run(p, { ...o, signal: ac.signal }), onStep: (s) => { setJob({ id: doc.id, phase: s.phase, i: s.i, n: s.n }); setBible(doc.id, s.bible) } })
      setBible(doc.id, b)
    } catch (e) {
      if (e.name !== 'AbortError') setStudyErr(`${e.message} Прогресс сохранён: нажмите «Продолжить изучение», когда лимит вернётся.`)
      const b = await docGet(bibleKey(doc.id)).catch(() => null)
      if (b) setBible(doc.id, b)
    }
    jobCtl.current = null; setJob(null)
  }

  const app = { key, run, ctx, learn, addSample, lib, bibles, notes, setNotes, active, setActive: setActiveId, addDoc, removeDoc, toggleDoc, saveBible, study, stopStudy: () => jobCtl.current?.abort(), job, studyErr, capEff }
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
        {nav.view === 'table' && <Table key={nav.arg?.pick?.join() || 'all'} app={app} arg={nav.arg} toChapter={(a) => go('chapter', a)} />}
        {nav.view === 'chapter' && <Chapter key={nav.arg?.brief || 'c'} app={app} arg={nav.arg} go={go} />}
      </div>
    </div>
  )
}
