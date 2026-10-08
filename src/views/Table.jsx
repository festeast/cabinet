import { useEffect, useRef, useState } from 'react'
import { WRITERS, who } from '../lib/agents'
import { prof, saveProf, feedback, ready, systemOf, distill } from '../lib/writers'
import { ls, uid, docGet } from '../lib/store'
import { short } from '../lib/ai'
import { textDoc } from '../lib/books'
import { cut, voiceSample } from '../lib/text'
import Av from './Av'
import EchoWave from './EchoWave'

// Круглый стол писарей: в каждой фазе четыре писаря пишут готовый фрагмент продолжения
// (каждый в своём направлении сюжета), автор выбирает один, и следующая фаза продолжает уже его.
const SIZES = [2000, 3000, 5000]
const words = (n) => Math.round(n / 6.5)
const SEP = '\n\n'

// Ответ писаря: «Сюжет: …», затем «---» и сам текст. Разбираем и на лету, пока текст пишется.
function parseDraft(raw) {
  const m = raw.match(/^\s*\**\s*Сюжет\s*\**\s*[:：]\s*\**\s*([^\n]+)\n?/i)
  if (!m) return { plot: '', text: raw.trim() }
  return { plot: m[1].replace(/\*+/g, '').trim(), text: raw.slice(m[0].length).replace(/^\s*(?:[-—–*_]{3,}|\*\*\*)\s*\n/, '').trim() }
}

function writerPrompt({ ctx, book, end, voice, s, ph, seen }) {
  const story = s.phases.filter((p) => p !== ph && p.chosen).map((p, k) => `${k + 1}. ${p.opts.find((o) => o.id === p.chosen)?.plot || ''}`).join('\n')
  const where = s.text
    ? `[Уже написанное продолжение, его конец: продолжай сразу после последней фразы]\n${s.text.length > 4500 ? `…${s.text.slice(-4500)}` : s.text}`
    : end
      ? `[Конец книги «${book}»: продолжение начинается сразу после последней фразы]\n…${end}`
      : '[Текста книги нет: начни историю по пожеланию автора и материалам]'
  return `${ctx}
${voice ? `\n[Образец голоса автора: отрывок из самой книги. Пиши так же: такие же фразы, слова, подача диалогов и мыслей]\n${voice}\n` : ''}
${where}
${story ? `\n[Как сюжет уже развивался в прошлых фазах]\n${story}\n` : ''}
[Пожелание автора к этой фазе]
${ph.wish || 'нет: выбери направление сам, исходя из канона и незакрытых линий'}
${seen.length ? `\n[Эти направления уже предлагали, придумай другое]\n${seen.map((t) => `- ${cut(t, 160)}`).join('\n')}\n` : ''}
Сначала вспомни [СУТЬ КНИГИ]: фрагмент должен работать на её центральный конфликт и обещание читателю, а герои вести себя в характере. Затем напиши следующий фрагмент книги объёмом около ${s.size} знаков (примерно ${words(s.size)} слов) в своём направлении сюжета. Продолжай ровно с места, где текст оборвался: не пересказывай и не повторяй написанное, не начинай заново. Сюжет должен заметно сдвинуться, но не завершай историю всей книги.
Ответ строго в таком виде:
Сюжет: одно предложение о том, куда ты ведёшь историю в этом фрагменте
---
текст фрагмента`
}

export default function Table({ app }) {
  const [sessions, setSessions] = useState(() => ls.get('cab_desk', []))
  const [sid, setSid] = useState(null)
  const [wish, setWish] = useState('')
  const [size, setSize] = useState(() => ls.get('cab_desk_size', 3000))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const [showText, setShowText] = useState(false)
  const [why, setWhy] = useState({})
  const [, setTick] = useState(0)
  const learning = useRef(new Set())
  const ctl = useRef(null)
  const cur = sessions.find((s) => s.id === sid)
  const ph = cur?.phases[cur.phases.length - 1]
  const book = app.lib.find((d) => d.id === (cur?.bookId || app.active))

  useEffect(() => { if (!busy) ls.set('cab_desk', sessions.slice(0, 15)) }, [sessions, busy])
  useEffect(() => { ls.set('cab_desk_size', size) }, [size])
  const updS = (id, fn) => setSessions((ss) => ss.map((x) => (x.id === id ? fn(x) : x)))
  const updPh = (id, fn) => updS(id, (x) => ({ ...x, phases: x.phases.map((p, k) => (k === x.phases.length - 1 ? fn(p) : p)) }))
  const setOpt = (id, oid, patch) => updPh(id, (p) => ({ ...p, opts: p.opts.map((o) => (o.id === oid ? { ...o, ...patch } : o)) }))

  // Все писари пишут одновременно: контекст книги собирается один раз на фазу.
  async function write(s, phase, only) {
    setBusy(true); setErr(''); setNote('')
    const ac = new AbortController(); ctl.current = ac
    try {
      const last = s.phases.filter((p) => p.chosen).pop()
      const q = [phase.wish, last?.opts.find((o) => o.id === last.chosen)?.plot, s.wish].filter(Boolean).join(' ')
      const ctx = (await app.ctx(q, { book: s.bookId, sample: true })).text
      const d = app.lib.find((x) => x.id === s.bookId)
      const full = d ? (await docGet(d.id).catch(() => '')) || '' : ''
      const end = !s.text && full ? full.slice(-3500) : ''
      const voice = full ? voiceSample(full) : ''
      const seen = [...(phase.seen || [])]
      const ws = only ? WRITERS.filter((w) => w.id === only.by) : WRITERS
      const res = await Promise.allSettled(ws.map(async (w) => {
        const oid = only?.id || uid()
        if (!only) updPh(s.id, (p) => ({ ...p, opts: [...p.opts, { id: oid, by: w.id, plot: '', text: '', done: false }] }))
        else setOpt(s.id, oid, { plot: '', text: '', err: '', done: false })
        try {
          const raw = await app.run(writerPrompt({ ctx, book: d?.name || '', end, voice, s, ph: phase, seen }), {
            system: systemOf(w), temperature: 0.9, signal: ac.signal,
            onText: (x) => setOpt(s.id, oid, parseDraft(x)), onModel: (m) => setOpt(s.id, oid, { m }),
          })
          const r = parseDraft(raw)
          if (r.text.length < 200) throw new Error('Писарь прислал слишком короткий текст.')
          setOpt(s.id, oid, { ...r, done: true })
        } catch (e) {
          setOpt(s.id, oid, { done: true, err: e.name === 'AbortError' ? 'Остановлено' : e.message || 'ошибка' })
          throw e
        }
      }))
      const bad = res.filter((r) => r.status === 'rejected')
      if (bad.length && !ac.signal.aborted) setErr(bad.length === ws.length ? bad[0].reason.message : `Не дописали: ${bad.length} из ${ws.length}. Их можно повторить.`)
    } catch (e) { if (e.name !== 'AbortError') setErr(e.message || 'Сбой сети') }
    setBusy(false)
  }

  function start(e) {
    e.preventDefault()
    if (busy) return
    const w = wish.trim()
    const phase = { id: uid(), wish: w, opts: [], chosen: null, seen: [] }
    const name = app.lib.find((d) => d.id === app.active)?.name
    const s = { id: uid(), title: cut(w || `Продолжение «${name || 'книги'}»`, 60), bookId: app.active, wish: w, size, text: '', phases: [phase], created: Date.now() }
    setSessions((x) => [s, ...x]); setSid(s.id); setWish(''); setShowText(false)
    write(s, phase)
  }
  // Следующая фаза: варианты прошлой больше не нужны целиком, оставляем только выбранный.
  function next(e) {
    e.preventDefault()
    if (busy || !ph?.chosen) return
    const phase = { id: uid(), wish: wish.trim(), opts: [], chosen: null, seen: [] }
    const s = { ...cur, size, phases: [...cur.phases.map((p) => ({ ...p, opts: p.opts.filter((o) => o.id === p.chosen) })), phase] }
    updS(cur.id, () => s); setWish('')
    write(s, phase)
  }
  // Ещё четыре варианта той же фазы: прежние направления писари не повторяют.
  function more() {
    if (busy || ph.chosen) return
    const phase = { ...ph, wish: wish.trim() || ph.wish, opts: [], seen: [...(ph.seen || []), ...ph.opts.map((o) => o.plot || cut(o.text, 160)).filter(Boolean)].slice(-12) }
    const s = { ...cur, size, phases: [...cur.phases.slice(0, -1), phase] }
    updS(cur.id, () => s); setWish('')
    write(s, phase)
  }
  const retry = (o) => { if (!busy) write({ ...cur, size }, ph, o) }

  // Выбор варианта: текст встаёт в рукопись, а выбор и отвергнутые соседи учат вкус автора.
  function choose(o) {
    if (busy || ph.chosen || !o.text) return
    if (!ph.learned) {
      const others = ph.opts.filter((x) => x.id !== o.id && x.text && !x.err)
      app.learn({ picked: { by: o.by, text: o.plot || cut(o.text, 300) }, skipped: others.filter((x) => !x.no).map((x) => ({ by: x.by, text: x.plot || cut(x.text, 200) })) })
      feedback(o.by, { ok: true, t: o.plot || cut(o.text, 300) })
      others.filter((x) => !x.no).forEach((x) => feedback(x.by, { ok: false, t: x.plot || cut(x.text, 200) }))
      grow(o.by)
    }
    updS(cur.id, (x) => ({ ...x, text: x.text ? `${x.text.trimEnd()}${SEP}${o.text}` : o.text, phases: x.phases.map((p) => (p.id === ph.id ? { ...p, chosen: o.id, base: x.text, learned: true } : p)) }))
    setNote(`Фаза ${cur.phases.length} выбрана: ${who(o.by).n}. Текст добавлен в рукопись.`)
  }
  // «Не то, потому что…»: самый ценный урок. Идёт и писарю лично, и в общий вкус автора.
  function reject(o) {
    const t = (why[o.id] || '').trim()
    if (!t) return
    const plot = o.plot || cut(o.text, 200)
    feedback(o.by, { ok: false, t: plot, why: t })
    app.learn({ skipped: [{ by: o.by, text: `${plot} — автор: ${t}` }] })
    setOpt(cur.id, o.id, { no: t })
    setWhy((m) => { const n = { ...m }; delete n[o.id]; return n })
    grow(o.by)
  }
  // Накопилось достаточно оценок: писарь в фоне пересобирает свои правила.
  function grow(id) {
    const w = WRITERS.find((x) => x.id === id)
    if (!w || !ready(id) || learning.current.has(id)) return
    learning.current.add(id)
    distill(w, app.run).then((t) => t && setNote(`${w.n} обновил свои правила по вашим выборам. Их видно в «Настроить писарей».`)).catch(() => {})
      .finally(() => { learning.current.delete(id); setTick((x) => x + 1) })
  }

  function undo() {
    if (busy || !ph?.chosen) return
    const o = ph.opts.find((x) => x.id === ph.chosen)
    const clean = cur.text === (ph.base ? `${ph.base.trimEnd()}${SEP}${o?.text}` : o?.text)
    if (!clean && !confirm('Рукопись правилась после выбора. Вернуть её к состоянию до этой фазы?')) return
    updS(cur.id, (x) => ({ ...x, text: ph.base || '', phases: x.phases.map((p) => (p.id === ph.id ? { ...p, chosen: null } : p)) }))
    setNote('')
  }

  async function toLib() {
    const { meta, text } = textDoc(`${book?.name || 'Книга'}: ${cur.title} (круглый стол)`, cur.text, 'draft')
    await app.addDoc(meta, text)
    setNote('Рукопись добавлена в библиотеку. Нажмите там «Изучить», чтобы помощники знали и этот текст.')
  }
  const copy = async () => { try { await navigator.clipboard.writeText(cur.text); setNote('Скопировано.') } catch { setNote('Не удалось скопировать: выделите текст вручную.') } }
  const save = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([cur.text], { type: 'text/plain;charset=utf-8' }))
    a.download = `${cur.title}.txt`; a.click(); URL.revokeObjectURL(a.href)
  }
  const del = (id) => { if (confirm('Удалить эту рукопись круглого стола?')) setSessions((s) => s.filter((x) => x.id !== id)) }

  // Сцена стола: Эхо в центре, четыре писаря вокруг; пишущие сейчас подсвечиваются.
  function stage(compact = false) {
    const live = new Set(busy && ph ? ph.opts.filter((o) => !o.done).map((o) => o.by) : [])
    return (
      <div className={`stage${compact ? ' compact' : ''}`}>
        <div className="seats">
          {WRITERS.map((h, i) => {
            const a = ((-90 + (i * 360) / WRITERS.length) * Math.PI) / 180
            return (
              <span key={h.id} className={`seat${live.has(h.id) ? ' on' : ''}`} style={{ '--c': h.c, '--x': `${50 + 41 * Math.cos(a)}%`, '--y': `${50 + 36 * Math.sin(a)}%` }} title={h.n}>
                <Av w={h} /><small>{h.n}</small>
              </span>
            )
          })}
        </div>
        <div className="echo-center">
          <EchoWave level={busy ? 1 : 0} label={busy ? 'Писари пишут' : 'Эхо слушает'} />
          <b>Эхо</b>
        </div>
      </div>
    )
  }
  const setup = (
    <details className="who-pick">
      <summary>Настроить писарей: указания и чему они научились</summary>
      <p className="muted small">Писари учатся на ваших выборах и на кнопке «Не то…». Чем точнее вы объясните, почему вариант не подошёл, тем быстрее они поймут суть. Самое важное о книге правьте в Библиотеке → «Суть книги».</p>
      {WRITERS.map((w) => {
        const p = prof(w.id), ok = p.fb.filter((f) => f.ok).length, no = p.fb.filter((f) => f.why).length
        return (
          <div key={w.id} className="wset" style={{ '--c': w.c }}>
            <h4><Av w={w} size="sm" />{w.n}<small className="muted">выбран {ok} раз, замечаний {no}</small></h4>
            <label className="fld"><span className="lbl">Ваши указания этому писарю</span>
              <textarea rows={2} defaultValue={p.mine} placeholder="Например: больше диалогов, не убивай главных героев, держи темп как в боевике…" onBlur={(e) => { saveProf(w.id, { mine: e.target.value.trim() }); setTick((x) => x + 1) }} />
            </label>
            <label className="fld"><span className="lbl">Чему научился (можно поправить)</span>
              <textarea key={p.notes} rows={3} defaultValue={p.notes} placeholder="Пока ничего: выбирайте варианты и объясняйте, что не так." onBlur={(e) => { saveProf(w.id, { notes: e.target.value.trim() }); setTick((x) => x + 1) }} />
            </label>
          </div>
        )
      })}
    </details>
  )
  const sizePick = (
    <label className="lbl inl">Объём фрагмента
      <select value={size} onChange={(e) => setSize(+e.target.value)} disabled={busy}>
        {SIZES.map((n) => <option key={n} value={n}>~{n} знаков</option>)}
      </select>
    </label>
  )

  if (!cur) {
    return (
      <div className="page">
        <h2>Круглый стол писарей</h2>
        <p className="muted">Четыре писаря пишут по готовому фрагменту продолжения, каждый в своём направлении сюжета. Вы выбираете вариант, и следующая фаза продолжает уже его.</p>
        {stage()}
        <form onSubmit={start} className="stack">
          {app.lib.length > 0 ? (
            <label className="bookpick"><span className="lbl">Книга, которую продолжаем</span>
              <select value={app.active} onChange={(e) => app.setActive(e.target.value)} aria-label="Книга">
                {app.lib.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
          ) : <p className="empty-note">Библиотека пуста: писари начнут историю только по вашему пожеланию.</p>}
          <textarea rows={3} value={wish} onChange={(e) => setWish(e.target.value)} placeholder="Пожелание к продолжению (можно пусто): что должно произойти, чего избегать…" aria-label="Пожелание к продолжению" />
          {sizePick}
          {setup}
          {err && <p className="err" role="alert">{err}</p>}
          <button className="go">Фаза 1: писари пишут</button>
        </form>
        {sessions.length > 0 && (
          <div className="prev">
            <h3>Продолжить рукопись</h3>
            {sessions.slice(0, 6).map((s) => (
              <div key={s.id} className="sess">
                <button onClick={() => { setSid(s.id); setNote(''); setErr('') }}><b>{s.title}</b><small>{new Date(s.created).toLocaleDateString('ru-RU')}, фаз: {s.phases.filter((p) => p.chosen).length}, {Math.round(s.text.length / 1000)} тыс. знаков</small></button>
                <button className="ghost" onClick={() => del(s.id)} aria-label="Удалить рукопись">Удалить</button>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  const done = cur.phases.filter((p) => p.chosen)
  return (
    <div className="page wide">
      <div className="bar2">
        <button className="ghost" disabled={busy} onClick={() => setSid(null)}>← К рукописям</button>
        <b className="ttl">{cur.title}</b>
        {busy && <button className="go" onClick={() => ctl.current?.abort()}>Стоп</button>}
      </div>
      {stage(true)}
      {!app.bibles[cur.bookId] && app.lib.length > 0 && <p className="empty-note">Книга ещё не изучена: писари знают её только по концу текста.</p>}

      {(cur.text || done.length > 0) && (
        <div className="blk">
          <div className="row top">
            <h3 className="grow">Рукопись <small className="muted">{Math.round(cur.text.length / 100) / 10} тыс. знаков</small></h3>
            <button className="ghost sm" aria-expanded={showText} onClick={() => setShowText((v) => !v)}>{showText ? 'Свернуть' : 'Показать'}</button>
          </div>
          <ol className="path">
            {done.map((p, k) => { const o = p.opts.find((x) => x.id === p.chosen), w = who(o?.by); return <li key={p.id} style={{ '--c': w.c }}><b>Фаза {k + 1}, {w.n}:</b> {o?.plot || cut(o?.text, 140)}</li> })}
          </ol>
          {showText && <textarea className="draft" rows={16} value={cur.text} disabled={busy} onChange={(e) => updS(cur.id, (x) => ({ ...x, text: e.target.value }))} aria-label="Рукопись" />}
          <div className="row">
            <button className="ghost" onClick={copy}>Копировать</button>
            <button className="ghost" onClick={save}>Скачать .txt</button>
            <button className="ghost" disabled={busy || !cur.text} onClick={toLib}>В библиотеку</button>
          </div>
          <p className="muted small">Текст создан с помощью ИИ. Если публикуете на Автор Тудей, проверьте правила площадки о маркировке таких текстов.</p>
        </div>
      )}

      <div className="blk">
        <div className="row top">
          <h3 className="grow">Фаза {cur.phases.length}{ph.chosen ? <small className="ok"> выбрано</small> : ': выберите, как развивается сюжет'}</h3>
          {ph.chosen && !busy && <button className="ghost sm" onClick={undo}>Отменить выбор</button>}
        </div>
        {ph.wish && <p className="muted brief">Пожелание: {ph.wish}</p>}
        <div className="drafts">
          {ph.opts.map((o) => {
            const w = who(o.by), live = busy && !o.done, picked = ph.chosen === o.id
            if (ph.chosen && !picked) return null
            return (
              <article key={o.id} className={`dr${live ? ' live' : ''}${picked ? ' picked' : ''}`} style={{ '--c': w.c }}>
                <h4><Av w={w} size="sm" />{w.n}{o.m && <small className="mdl">{short(o.m)}</small>}</h4>
                {o.plot && <p className="plot">{o.plot}</p>}
                {o.err && !o.text ? <p className="err">{o.err}</p> : <div className="txt">{o.text || (live ? 'Пишет…' : '')}{live && <span className="cur" />}</div>}
                {o.no && <p className="muted small">Не то: {o.no}</p>}
                {!busy && !ph.chosen && (
                  <div className="row">
                    {o.text && !o.err && <button className="go" onClick={() => choose(o)}>Выбрать этот вариант</button>}
                    {o.text && !o.err && !o.no && why[o.id] === undefined && <button className="ghost sm" onClick={() => setWhy((m) => ({ ...m, [o.id]: '' }))}>Не то…</button>}
                    {(o.err || !o.text) && <button className="ghost sm" onClick={() => retry(o)}>Повторить</button>}
                    {o.text && <small className="muted">{o.text.length} знаков</small>}
                  </div>
                )}
                {!busy && !ph.chosen && why[o.id] !== undefined && (
                  <form className="row own" onSubmit={(e) => { e.preventDefault(); reject(o) }}>
                    <input autoFocus value={why[o.id]} onChange={(e) => setWhy((m) => ({ ...m, [o.id]: e.target.value }))} placeholder="Почему не то? Например: герой так бы не поступил, слишком быстро…" aria-label={`Почему не подошёл вариант: ${w.n}`} />
                    <button className="ghost sm" disabled={!why[o.id].trim()}>Запомнить</button>
                  </form>
                )}
              </article>
            )
          })}
        </div>
        {err && <p className="err" role="alert">{err}</p>}
        {note && <p className="okmsg" role="status">{note}</p>}
        {!busy && (
          <form onSubmit={ph.chosen ? next : (e) => { e.preventDefault(); more() }} className="stack">
            <textarea rows={2} value={wish} onChange={(e) => setWish(e.target.value)} placeholder={ph.chosen ? 'Пожелание к следующей фазе (можно пусто)…' : 'Ни один не подошёл? Уточните пожелание (можно пусто)…'} aria-label="Пожелание к фазе" />
            <div className="row">
              {sizePick}
              <button className={ph.chosen ? 'go' : 'ghost'}>{ph.chosen ? `Фаза ${cur.phases.length + 1}: писари пишут дальше` : 'Ещё 4 варианта'}</button>
            </div>
            {setup}
          </form>
        )}
      </div>
    </div>
  )
}
