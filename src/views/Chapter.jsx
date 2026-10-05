import { useEffect, useRef, useState } from 'react'
import { who } from '../lib/agents'
import { BLOCKS, genOptions, planPrompt, draftPrompt, contPrompt } from '../lib/ideas'
import { ls, uid } from '../lib/store'
import { textDoc } from '../lib/books'
import Av from './Av'

const blank = () => Object.fromEntries(BLOCKS.map((b) => [b.k, { opts: [], chosen: null, seen: [] }]))
const withChosen = (x, k, v) => ({ ...x, blocks: { ...x.blocks, [k]: { ...x.blocks[k], chosen: v } } })

export default function Chapter({ app, arg, go }) {
  const [list, setList] = useState(() => ls.get('cab_chapters', []))
  const [cid, setCid] = useState(null)
  const [title, setTitle] = useState('')
  const [brief, setBrief] = useState(arg?.brief || '')
  const [cust, setCust] = useState({})
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const ctl = useRef(null)
  const learned = useRef(new Set())
  const cur = list.find((c) => c.id === cid)
  const book = app.lib.find((d) => d.id === (cur?.bookId || app.active))

  useEffect(() => { if (!busy) ls.set('cab_chapters', list.slice(0, 20)) }, [list, busy])
  const upd = (fn) => setList((l) => l.map((c) => (c.id === cid ? fn(c) : c)))
  const run = (ac) => (p, o) => app.run(p, { ...o, signal: ac.signal })
  const begin = (what) => { setBusy(what); setErr(''); setNote(''); const ac = new AbortController(); ctl.current = ac; return ac }

  function create(e) {
    e.preventDefault()
    const c = { id: uid(), bookId: app.active, title: title.trim() || 'Новая глава', brief: brief.trim(), blocks: blank(), plan: '', draft: '', words: 1000, done: false, created: Date.now() }
    setList((l) => [c, ...l]); setCid(c.id); setTitle(''); setBrief('')
  }
  const del = (id) => { if (confirm('Удалить эту главу из мастерской?')) setList((l) => l.filter((c) => c.id !== id)) }

  async function genBlock(b) {
    if (busy) return
    const c = cur
    const ac = begin(b.k)
    try {
      const ctx = (await app.ctx(`${c.title} ${c.brief}`, { book: c.bookId, passages: false })).text
      const opts = await genOptions({ block: b, ctx, chapter: c, seen: c.blocks[b.k].seen || [], run: run(ac) })
      upd((x) => {
        const bl = x.blocks[b.k]
        const kept = bl.chosen ? bl.opts.filter((o) => o.id === bl.chosen.id) : []
        return { ...x, blocks: { ...x.blocks, [b.k]: { ...bl, opts: [...kept, ...opts], seen: [...(bl.seen || []), ...opts.map((o) => o.text)].slice(-20) } } }
      })
    } catch (e) { if (e.name !== 'AbortError') setErr(e.message) }
    setBusy('')
  }

  // Каждый клик учится: выбранный ход и отвергнутые соседи попадают в «вкус автора».
  function choose(k, o) {
    const bl = cur.blocks[k]
    if (bl.chosen?.id === o.id) { upd((x) => withChosen(x, k, null)); return }
    if (!learned.current.has(o.id)) {
      const others = bl.opts.filter((p) => p.id !== o.id && !learned.current.has(p.id)).slice(0, 3)
      app.learn({ picked: o, skipped: others })
      learned.current.add(o.id); others.forEach((p) => learned.current.add(p.id))
    }
    upd((x) => withChosen(x, k, o))
  }
  function own(k) {
    const text = (cust[k] || '').trim()
    if (!text) return
    const o = { id: uid(), by: 'me', text }
    app.learn({ picked: o }); learned.current.add(o.id)
    upd((x) => ({ ...withChosen(x, k, o), blocks: { ...x.blocks, [k]: { ...x.blocks[k], chosen: o, opts: [o, ...x.blocks[k].opts] } } }))
    setCust((m) => ({ ...m, [k]: '' }))
  }

  async function makePlan() {
    if (busy) return
    const c = cur
    const ac = begin('plan')
    try {
      const ctx = (await app.ctx(`${c.title} ${c.brief}`, { book: c.bookId, passages: false })).text
      const t = await run(ac)(planPrompt(ctx, c), { onText: (x) => upd((y) => ({ ...y, plan: x })) })
      upd((y) => ({ ...y, plan: t.trim() }))
    } catch (e) { if (e.name !== 'AbortError') setErr(e.message) }
    setBusy('')
  }
  async function makeDraft(more) {
    if (busy) return
    const c = cur
    if (!more && c.draft && !confirm('Заменить текущий черновик новым?')) return
    const ac = begin('draft')
    const baseText = more ? `${c.draft.trimEnd()}\n\n` : ''
    try {
      const ctx = (await app.ctx(`${c.title} ${c.brief}`, { book: c.bookId, passages: false, sample: true })).text
      const t = await run(ac)((more ? contPrompt : draftPrompt)(ctx, c), { onText: (x) => upd((y) => ({ ...y, draft: baseText + x, done: false })) })
      upd((y) => ({ ...y, draft: baseText + t.trim() }))
    } catch (e) { if (e.name !== 'AbortError') setErr(e.message) }
    setBusy('')
  }
  function accept() {
    app.addSample(cur.draft)
    upd((x) => ({ ...x, done: true }))
    setNote('Принято: этот текст и ваши выборы будут учтены в следующих главах.')
  }
  async function toLib() {
    const name = `${book?.name || 'Книга'}: ${cur.title} (черновик)`
    const { meta, text } = textDoc(name, cur.draft, 'draft')
    await app.addDoc(meta, text)
    setNote('Черновик добавлен в библиотеку. Откройте её и нажмите «Изучить», чтобы помощники знали и эту главу.')
  }
  const copy = async () => { try { await navigator.clipboard.writeText(cur.draft); setNote('Скопировано.') } catch { setNote('Не удалось скопировать: выделите текст вручную.') } }
  const save = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([cur.draft], { type: 'text/plain;charset=utf-8' }))
    a.download = `${cur.title}.txt`; a.click(); URL.revokeObjectURL(a.href)
  }

  if (!cur) {
    return (
      <div className="page">
        <h2>Новая глава</h2>
        {app.lib.length === 0 && <p className="empty-note">Библиотека пуста: помощникам не на что опереться. <button className="ghost sm" onClick={() => go('library')}>Добавить книги</button></p>}
        <form onSubmit={create} className="stack">
          {app.lib.length > 0 && (
            <label className="bookpick"><span className="lbl">Книга</span>
              <select value={app.active} onChange={(e) => app.setActive(e.target.value)} aria-label="Книга">{app.lib.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
            </label>
          )}
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Название или номер: «Глава 13»" aria-label="Название главы" />
          <textarea rows={4} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="Что должно произойти? Пожелания, ограничения, желаемый финал… (можно пусто)" aria-label="Пожелания к главе" />
          <button className="go">Открыть мастерскую главы</button>
        </form>
        {list.length > 0 && (
          <div className="prev">
            <h3>Мои главы в работе</h3>
            {list.slice(0, 8).map((c) => (
              <div key={c.id} className="sess">
                <button onClick={() => setCid(c.id)}><b>{c.title}</b><small>{c.done ? 'принята' : c.draft ? 'есть черновик' : 'сборка'}, {new Date(c.created).toLocaleDateString('ru-RU')}</small></button>
                <button className="ghost" onClick={() => del(c.id)} aria-label="Удалить главу">Удалить</button>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  const picked = BLOCKS.filter((b) => cur.blocks[b.k].chosen).length
  const bible = app.bibles[cur.bookId]
  return (
    <div className="page wide">
      <div className="bar2">
        <button className="ghost" disabled={!!busy} onClick={() => setCid(null)}>← К списку</button>
        <input className="ttl-in" value={cur.title} onChange={(e) => upd((x) => ({ ...x, title: e.target.value }))} aria-label="Название главы" />
        {busy && <button className="go" onClick={() => ctl.current?.abort()}>Стоп</button>}
      </div>
      {!bible && <p className="empty-note">Книга ещё не изучена, помощники работают почти вслепую. <button className="ghost sm" onClick={() => go('library')}>Открыть библиотеку</button></p>}
      {cur.brief && <p className="muted brief">{cur.brief}</p>}
      {err && <p className="err" role="alert">{err}</p>}

      {BLOCKS.map((b) => {
        const bl = cur.blocks[b.k]
        return (
          <div key={b.k} className="blk">
            <div className="row top">
              <h3 className="grow">{b.n}{bl.chosen && <small className="ok"> выбрано</small>}</h3>
              <button className="ghost" disabled={!!busy} onClick={() => genBlock(b)}>{busy === b.k ? 'Думают…' : bl.opts.length ? 'Ещё варианты' : 'Предложить варианты'}</button>
            </div>
            <p className="muted small">{b.q}</p>
            {bl.opts.length > 0 && (
              <div className="opts">
                {bl.opts.map((o) => {
                  const w = who(o.by)
                  return (
                    <button key={o.id} type="button" className="opt" style={{ '--c': w.c }} aria-pressed={bl.chosen?.id === o.id} onClick={() => choose(b.k, o)}>
                      <span className="who"><Av w={w} size="sm" />{w.n}</span>
                      <span>{o.text}</span>
                    </button>
                  )
                })}
              </div>
            )}
            <div className="row own">
              <input value={cust[b.k] || ''} onChange={(e) => setCust((m) => ({ ...m, [b.k]: e.target.value }))} placeholder="Или свой вариант…" aria-label={`Свой вариант: ${b.n}`} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); own(b.k) } }} />
              <button className="ghost" disabled={!(cust[b.k] || '').trim()} onClick={() => own(b.k)}>Взять свой</button>
            </div>
          </div>
        )
      })}

      <div className="blk">
        <div className="row top">
          <h3 className="grow">План главы</h3>
          <button className="ghost" disabled={!!busy || !picked} onClick={makePlan}>{busy === 'plan' ? 'Составляю…' : cur.plan ? 'Составить заново' : 'Собрать план'}</button>
        </div>
        {!picked && <p className="muted small">Выберите хотя бы один ход выше.</p>}
        {(cur.plan || busy === 'plan') && <textarea rows={8} value={cur.plan} onChange={(e) => upd((x) => ({ ...x, plan: e.target.value }))} aria-label="План главы" />}
      </div>

      <div className="blk">
        <div className="row top">
          <h3 className="grow">Черновик</h3>
          <label className="lbl inl">Объём
            <select value={cur.words} onChange={(e) => upd((x) => ({ ...x, words: +e.target.value }))} disabled={!!busy}>
              <option value={600}>~600 слов</option><option value={1000}>~1000 слов</option><option value={1600}>~1600 слов</option>
            </select>
          </label>
          <button className="go" disabled={!!busy || !picked} onClick={() => makeDraft(false)}>{busy === 'draft' ? 'Пишу…' : cur.draft ? 'Переписать' : 'Написать черновик'}</button>
        </div>
        {(cur.draft || busy === 'draft') && (
          <>
            <textarea className="draft" rows={16} value={cur.draft} onChange={(e) => upd((x) => ({ ...x, draft: e.target.value, done: false }))} aria-label="Черновик главы" />
            <div className="row">
              <button className="ghost" disabled={!!busy} onClick={() => makeDraft(true)}>Продолжить</button>
              <button className="go" disabled={!!busy || cur.done} onClick={accept}>{cur.done ? 'Принято' : 'Принять'}</button>
              <button className="ghost" onClick={copy}>Копировать</button>
              <button className="ghost" onClick={save}>Скачать .txt</button>
              <button className="ghost" disabled={!!busy} onClick={toLib}>В библиотеку</button>
            </div>
            <p className="muted small">Черновик создан с помощью ИИ. Если публикуете на Автор Тудей, проверьте правила площадки о маркировке таких текстов.</p>
          </>
        )}
        {note && <p className="okmsg" role="status">{note}</p>}
      </div>
    </div>
  )
}
