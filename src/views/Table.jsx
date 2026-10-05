import { useEffect, useRef, useState } from 'react'
import { HELPERS, who, RULE, INTRO, SUM } from '../lib/agents'
import { ls, uid } from '../lib/store'
import { short } from '../lib/ai'
import Av from './Av'
import Chips from './Chips'

export default function Table({ app, arg, toChapter }) {
  const [sessions, setSessions] = useState(() => ls.get('cab_tables', []))
  const [sid, setSid] = useState(null)
  const [pick, setPick] = useState(arg?.pick || HELPERS.map((h) => h.id))
  const [topic, setTopic] = useState('')
  const [q, setQ] = useState('')
  const [fast, setFast] = useState(() => ls.get('cab_fast', true))
  const [busy, setBusy] = useState(false)
  const [speaking, setSpeaking] = useState('')
  const [err, setErr] = useState('')
  const ctl = useRef(null)
  const feed = useRef(null)
  const cur = sessions.find((s) => s.id === sid)

  useEffect(() => { if (!busy) ls.set('cab_tables', sessions.slice(0, 30)) }, [sessions, busy])
  useEffect(() => { ls.set('cab_fast', fast) }, [fast])
  useEffect(() => { if (feed.current) feed.current.scrollTop = feed.current.scrollHeight }, [sessions, sid])

  async function runRound(id, question, base) {
    const ids = HELPERS.filter((h) => pick.includes(h.id))
    setBusy(true); setErr('')
    const ac = new AbortController(); ctl.current = ac
    const tr = [...base.turns]
    let context = ''
    const upd = (fn) => setSessions((s) => s.map((x) => (x.id === id ? { ...x, turns: fn(x.turns) } : x)))
    const set = (i, patch) => { Object.assign(tr[i], patch); upd((ts) => { const a = [...ts]; a[i] = { ...a[i], ...patch }; return a }) }
    const add = (t) => { tr.push({ ...t }); upd((ts) => [...ts, { ...t }]); return tr.length - 1 }
    const say = async (w, kind, instr, upto) => {
      const i = add({ who: w, kind, text: '' })
      setSpeaking(upto !== undefined ? 'all' : w)
      const u = upto ?? i
      const hist = tr.slice(Math.max(0, u - 16), u).filter((t) => t.kind !== 'src').map((t) => `${who(t.who).n}: ${t.text.slice(0, 600)}`).join('\n')
      const prompt = `${instr}\n\n${context}\n\n[Ход обсуждения]\n${hist}\n\nТвоя реплика (${who(w).n}):`
      try {
        const t = await app.run(prompt, { signal: ac.signal, onText: (x) => set(i, { text: x }), onModel: (m) => set(i, { m }) })
        if (!t.trim()) throw new Error('Модель ничего не ответила.')
      } catch (e) {
        if (!tr[i].text) set(i, { text: e.name === 'AbortError' ? 'Остановлено' : `Не смог ответить: ${e.message || 'ошибка'}` })
        throw e
      }
    }
    try {
      add({ who: 'me', kind: 'q', text: question })
      const c = await app.ctx(question, { passages: true })
      context = c.text
      if (c.used.length) add({ who: 'core', kind: 'src', text: `Из книги взято: ${c.used.join('; ')}` })
      await say('core', 'mod', INTRO)
      if (fast) {
        const upto = tr.length
        const res = await Promise.allSettled(ids.map((a) => say(a.id, 'adv', `${a.p}\n${RULE}`, upto)))
        const bad = res.find((r) => r.status === 'rejected')
        if (bad && ac.signal.aborted) throw bad.reason
        if (bad) setErr(bad.reason.message)
      } else for (const a of ids) await say(a.id, 'adv', `${a.p}\n${RULE}`)
      await say('core', 'sum', SUM)
    } catch (e) { if (e.name !== 'AbortError') setErr(e.message || 'Сбой сети') }
    setSpeaking(''); setBusy(false)
  }

  function start(e) {
    e.preventDefault()
    const t = topic.trim()
    if (!t || busy || !pick.length) return
    const s = { id: uid(), title: t.slice(0, 60), created: Date.now(), turns: [] }
    setSessions((x) => [s, ...x]); setSid(s.id); setTopic('')
    runRound(s.id, t, s)
  }
  function ask(e) {
    e.preventDefault()
    const v = q.trim()
    if (!v || busy || !pick.length) return
    setQ(''); runRound(cur.id, v, cur)
  }
  const del = (id) => { if (confirm('Удалить это обсуждение?')) setSessions((s) => s.filter((x) => x.id !== id)) }

  const books = app.lib.length > 0 && (
    <label className="bookpick"><span className="lbl">Книга в работе</span>
      <select value={app.active} onChange={(e) => app.setActive(e.target.value)} disabled={busy} aria-label="Книга в работе">
        {app.lib.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
    </label>
  )

  if (!cur) {
    return (
      <div className="page">
        <h2>Круглый стол</h2>
        <form onSubmit={start} className="stack">
          <textarea rows={4} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Идея, вопрос или «как продолжить главу 12»…" aria-label="Тема обсуждения" />
          {books}
          <p className="lbl">Кто участвует</p>
          <Chips pick={pick} setPick={setPick} />
          {err && <p className="err" role="alert">{err}</p>}
          <button className="go" disabled={!topic.trim() || !pick.length}>Начать обсуждение</button>
        </form>
        {sessions.length > 0 && (
          <div className="prev">
            <h3>Продолжить прошлый разговор</h3>
            {sessions.slice(0, 5).map((s) => (
              <div key={s.id} className="sess">
                <button onClick={() => setSid(s.id)}><b>{s.title}</b><small>{new Date(s.created).toLocaleDateString('ru-RU')}, реплик: {s.turns.length}</small></button>
                <button className="ghost" onClick={() => del(s.id)} aria-label="Удалить обсуждение">Удалить</button>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="col fill">
      <div className="bar2">
        <button className="ghost" disabled={busy} onClick={() => setSid(null)}>← Новые темы</button>
        <b className="ttl">{cur.title}</b>
        <button className="ghost" aria-pressed={fast} disabled={busy} onClick={() => setFast((f) => !f)} title="Все сразу быстрее, по очереди помощники отвечают друг другу">{fast ? '⚡ Все сразу' : '⛓ По очереди'}</button>
      </div>
      <div className="table" ref={feed}>
        {cur.turns.map((t, i) => {
          if (t.kind === 'src') return <p key={i} className="muted srcnote">{t.text}</p>
          const w = who(t.who)
          const live = busy && (speaking === t.who || speaking === 'all') && i === cur.turns.length - 1
          return (
            <article key={i} className={`card ${t.kind}`} style={{ '--c': w.c }}>
              <h3><Av w={w} />{w.n}{t.kind === 'sum' && ': итог'}{t.m && <small className="mdl">{short(t.m)}</small>}</h3>
              <p>{t.text}{live && <span className="cur" />}</p>
              {t.kind === 'sum' && !busy && t.text && <button className="ghost sm" onClick={() => toChapter({ brief: `${cur.turns.find((x) => x.kind === 'q')?.text || cur.title}\n\nИтог обсуждения: ${t.text}` })}>Взять в новую главу</button>}
            </article>
          )
        })}
      </div>
      {err && <p className="err" role="alert">{err}</p>}
      <div className="ask">
        {busy ? (
          <div className="row"><span className="say"><i />Сейчас говорит: {speaking === 'all' ? 'все сразу' : who(speaking)?.n}</span><button className="go" onClick={() => ctl.current?.abort()}>Стоп</button></div>
        ) : (
          <form onSubmit={ask} className="stack">
            {books}
            <Chips pick={pick} setPick={setPick} />
            <div className="row">
              <textarea rows={2} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ваш вопрос… например: «проверь главу 5»" aria-label="Следующий вопрос" onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) ask(e) }} />
              <button className="go" disabled={!q.trim() || !pick.length}>Спросить</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
