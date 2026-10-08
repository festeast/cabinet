import { useState } from 'react'
import { doneCount, isShallow, seriesSig } from '../lib/bible'
import { readFileDoc, readFolder, readLink, textDoc } from '../lib/books'
import { splitUnits } from '../lib/text'
import { seriesDocs } from '../lib/context'
import { docGet } from '../lib/store'

const FIELDS = [['brief', 'О чём книга'], ['characters', 'Герои и их арки'], ['world', 'Мир и правила'], ['threads', 'Незакрытые линии'], ['timeline', 'Хронология'], ['issues', 'Несостыковки (проверка канона)'], ['style', 'Стиль автора (правьте под себя)']]
const SFIELDS = [['brief', 'Сквозной сюжет цикла'], ['characters', 'Сквозные герои и арки через книги'], ['world', 'Правила мира цикла'], ['threads', 'Незакрытые линии цикла'], ['timeline', 'Хронология цикла'], ['issues', 'Несостыковки между книгами']]
const PHASE = { chapters: 'главы', summary: 'библия книги', check: 'проверка несостыковок', style: 'стиль', series: 'библия цикла', seriesCheck: 'проверка цикла', memory: 'обновляю память сюжета', done: 'готово' }
// Что сейчас делает изучение: фаза, номер главы и «жду модель», если все заняты или упёрлись в лимит.
const now = (job) => `${PHASE[job.phase] || ''}${job.phase === 'chapters' && job.n ? ` ${job.i + 1} из ${job.n}` : ''}${job.wait > Date.now() ? ', жду свободную модель (до 2–3 мин)…' : ''}`
const KIND = { link: 'ссылка', draft: 'ваш черновик', folder: 'папка' }
const rows = (f) => (['characters', 'threads', 'timeline', 'issues'].includes(f) ? 8 : f === 'style' ? 8 : 4)

// Оценка запросов: глава читается целиком (длинная — частями), плюс библия, проверка, стиль и запас на повторы.
async function estimate(docs, bibles) {
  let n = 0
  for (const d of docs) {
    const text = await docGet(d.id).catch(() => null)
    if (!text) continue
    const units = splitUnits(text), b = bibles[d.id], fresh = !b || isShallow(b) || b.chapters.length !== units.length
    n += units.reduce((s, u, i) => s + (fresh || !b.chapters[i] ? Math.ceil(u.text.length / 22000) : 0), 0) + 3 + Math.ceil(text.length / 400000)
  }
  return Math.ceil(n * 1.1)
}

export default function Library({ app }) {
  const { lib, bibles, series, job, taste } = app
  const [open, setOpen] = useState('')
  const [link, setLink] = useState('')
  const [pname, setPname] = useState('')
  const [ptext, setPtext] = useState('')
  const [mode, setMode] = useState('series')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const toggle = (k) => setOpen(open === k ? '' : k)
  const names = [...new Set([...app.cycles, ...lib.map((d) => d.series).filter(Boolean)])]
  const [cname, setCname] = useState('')
  const [pcycle, setPcycle] = useState('')

  async function onFile(e) {
    const fs = [...(e.target.files || [])]
    e.target.value = ''
    setBusy(true); setErr(''); setMsg('')
    for (const f of fs) {
      try { const { meta, text } = await readFileDoc(f); await app.addDoc(meta, text) } catch (x) { setErr(x.message || `Не удалось сохранить файл ${f.name}`) }
    }
    setBusy(false)
  }
  async function onFolder(e) {
    const input = e.target, fs = [...(input.files || [])]
    if (!fs.length) return
    setBusy(true); setErr(''); setMsg('')
    try {
      const r = await readFolder(fs, mode)
      if (!r.docs.length) throw new Error('В папке не нашлось текста.')
      await app.addDocs(r.docs)
      setMsg(r.series
        ? `Цикл «${r.series}»: добавлено книг ${r.docs.length}${r.skipped ? `, пропущено файлов другого формата: ${r.skipped}` : ''}. Нажмите «Изучить весь цикл».`
        : `Книга «${r.docs[0].meta.name}»: глав ${r.docs[0].meta.chapters} из файлов ${r.docs[0].meta.files}. Нажмите «Изучить».`)
    } catch (x) { setErr(x.message || 'Не удалось прочитать папку.') }
    // Очищаем выбор только после чтения: иначе Chrome теряет доступ к файлам папки.
    input.value = ''
    setBusy(false)
  }
  async function onParts(e, name) {
    const input = e.target, fs = [...(input.files || [])]
    if (!fs.length) return
    setBusy(true); setErr(''); setMsg('')
    try {
      const r = await app.addParts(name, fs)
      setMsg(`Цикл «${name}»: добавлено частей ${r.added}.${r.bad.length ? ` Не подошли: ${r.bad.join(', ')} (нужны .txt .md .fb2 .html).` : ''}`)
    } catch (x) { setErr(x.message || 'Не удалось добавить части.') }
    input.value = ''
    setBusy(false)
  }
  async function onLink() {
    setBusy(true); setErr('')
    try { const { meta, text } = await readLink(link.trim()); await app.addDoc(meta, text); setLink('') }
    catch (x) { setErr(/^Ссылка/.test(x.message) ? x.message : 'Не удалось прочитать страницу (возможно, нужен вход на сайт). Сохраните главу в .txt и добавьте файлом.') }
    setBusy(false)
  }
  async function onPaste(e) {
    e.preventDefault()
    setBusy(true); setErr('')
    try { const { meta, text } = textDoc(pname.trim() || 'Вставленный текст', ptext); if (pcycle) { meta.series = pcycle; meta.order = Math.max(-1, ...lib.filter((d) => d.series === pcycle).map((d) => d.order ?? 0)) + 1 } await app.addDoc(meta, text); setPname(''); setPtext('') } catch { setErr('Не удалось сохранить текст.') }
    setBusy(false)
  }
  const ask = (n, what) => confirm(`${what}: нужно примерно ${n} запросов к ИИ. Каждая глава читается целиком и разбирается подробно (события, герои, факты канона, хронология), затем строится библия и проверяются несостыковки. Бесплатный лимит около ${app.capEff} в день; прогресс сохраняется после каждой главы, продолжить можно в любой момент. Начать?`)
  async function study(d, fresh = false) {
    if (fresh && !confirm('Изучить книгу заново подробно? Прежний разбор глав будет заменён.')) return
    const n = await estimate([d], fresh ? {} : bibles)
    if (ask(n, `«${d.name}»`)) app.study(d, { fresh })
  }
  async function studyAll(name) {
    const docs = seriesDocs(lib, lib.find((d) => d.series === name))
    const n = (await estimate(docs, bibles)) + 3
    if (ask(n, `Цикл «${name}», книг: ${docs.length}`)) app.studySeries(name)
  }

  function book(d, inSeries = false) {
    const b = bibles[d.id], n = b ? b.chapters.length : 0, k = doneCount(b), mine = job?.book === d.id, shallow = isShallow(b)
    const g = inSeries ? seriesDocs(lib, d) : [], pos = g.indexOf(d)
    return (
      <div key={d.id} className="doc col">
        <div className="row top">
          <label className="chk"><input type="checkbox" checked={d.on !== false} onChange={() => app.toggleDoc(d.id)} aria-label={`Книга «${d.name}» доступна помощникам`} /></label>
          <span className="grow"><b>{inSeries ? `Часть ${pos + 1}. ` : ''}{d.name}</b><small>{KIND[d.kind] || 'файл'}{d.files > 1 ? ` из ${d.files} файлов` : ''}, {Math.round(d.size / 1000)} тыс. знаков, {b ? `изучено ${k} из ${n}${shallow ? ' (старый разбор)' : ''}` : 'не изучена'}{mine ? `, сейчас: ${now(job)}` : ''}</small></span>
          {inSeries && <span className="row">
            <button className="ghost sm" disabled={pos === 0 || !!job} onClick={() => app.moveDoc(d.id, -1)} aria-label="Выше в цикле">↑</button>
            <button className="ghost sm" disabled={pos === g.length - 1 || !!job} onClick={() => app.moveDoc(d.id, 1)} aria-label="Ниже в цикле">↓</button>
          </span>}
          {mine && !job.series
            ? <button className="ghost" onClick={app.stopStudy}>Остановить</button>
            : <button className="ghost" disabled={!!job} onClick={() => study(d)}>{b && k === n && b.brief && !shallow ? 'Доизучить' : k && !shallow ? 'Продолжить изучение' : 'Изучить'}</button>}
          {b && <button className="ghost" disabled={!!job} onClick={() => study(d, true)} title="Подробный разбор каждой главы целиком">{shallow ? 'Переизучить точнее' : 'Заново'}</button>}
          <button className="ghost" disabled={mine} onClick={() => app.removeDoc(d.id)}>Убрать</button>
        </div>
        {b && n > 0 && <span className="bar" aria-hidden="true"><i style={{ width: `${Math.round((k / n) * 100)}%` }} /></span>}
        <div className="row">
          {b && <button type="button" className="ghost sm" aria-expanded={open === d.id} onClick={() => toggle(d.id)}>{open === d.id ? 'Скрыть библию' : 'Показать библию'}</button>}
          {b && k > 0 && <button type="button" className="ghost sm" aria-expanded={open === `ch:${d.id}`} onClick={() => toggle(`ch:${d.id}`)}>{open === `ch:${d.id}` ? 'Скрыть разбор глав' : `Разбор глав (${k})`}</button>}
          <label className="sm muted">Цикл: <input className="sm" list="series-names" defaultValue={d.series || ''} placeholder="нет" aria-label={`Цикл книги «${d.name}»`} onBlur={(e) => e.target.value.trim() !== (d.series || '') && app.setDocSeries(d.id, e.target.value)} /></label>
        </div>
        {open === d.id && b && FIELDS.map(([f, t]) => (
          <label key={f} className="fld"><span className="lbl">{t}</span>
            <textarea rows={rows(f)} value={b[f] || ''} onChange={(e) => app.saveBible(d.id, { ...b, [f]: e.target.value })} />
          </label>
        ))}
        {open === `ch:${d.id}` && b && (
          <ol className="chs">
            {b.chapters.map((c, i) => c && (
              <li key={i}>
                <b>{c.title}</b>{(c.place || c.time) && <small> · {[c.place, c.time].filter(Boolean).join(' · ')}</small>}
                <p>{c.summary}</p>
                {c.events?.length > 0 && <p className="small"><i>События:</i> {c.events.join('; ')}</p>}
                {c.changes?.length > 0 && <p className="small"><i>Герои:</i> {c.changes.join('; ')}</p>}
                {c.facts?.length > 0 && <p className="small"><i>Канон:</i> {c.facts.join('; ')}</p>}
                {c.opened?.length > 0 && <p className="small"><i>Открыто:</i> {c.opened.join('; ')}</p>}
                {c.hook && <p className="small"><i>Финал:</i> {c.hook}</p>}
              </li>
            ))}
          </ol>
        )}
      </div>
    )
  }

  function seriesBlock(name) {
    const docs = seriesDocs(lib, lib.find((d) => d.series === name))
    const sb = series[name], mine = job?.series === name
    const k = docs.reduce((s, d) => s + doneCount(bibles[d.id]), 0), n = docs.reduce((s, d) => s + (bibles[d.id]?.chapters.length || d.chapters || 0), 0)
    const stale = sb && sb.sig !== seriesSig(docs, bibles)
    return (
      <section key={name} className="series col">
        <div className="cyc-head">
          <span className="grow"><b>Цикл «{name}»</b><small>частей: {docs.length}, глав изучено {k} из {n}{sb ? (stale ? ', библия цикла устарела' : ', библия цикла готова') : ''}{mine ? `, сейчас: ${now(job)}${job.book ? ` — «${lib.find((d) => d.id === job.book)?.name || ''}»` : ''}` : ''}</small></span>
        </div>
        <div className="row top">
          {mine
            ? <button className="ghost" onClick={app.stopStudy}>Остановить</button>
            : <button className="go" disabled={!!job || !docs.length} onClick={() => studyAll(name)}>{k ? 'Продолжить изучение цикла' : 'Изучить весь цикл'}</button>}
          <label className="ghost file">{busy ? 'Загружаю…' : '＋ Добавить части'}
            <input type="file" multiple accept=".txt,.md,.text,.fb2,.html,.htm,.xml" onChange={(e) => onParts(e, name)} hidden disabled={busy} />
          </label>
          <button className="ghost" disabled={!!job} onClick={() => { const t = prompt('Новое название цикла', name); if (t) app.renameSeries(name, t) }}>Переименовать</button>
          <button className="ghost" disabled={!!job} onClick={() => app.removeCycle(name)}>Удалить цикл</button>
        </div>
        {!docs.length && <p className="empty-note">Цикл пока пуст. Нажмите «＋ Добавить части» и выберите файлы частей (можно несколько сразу): они встанут по порядку названий. Порядок потом можно поправить стрелками.</p>}
        {n > 0 && <span className="bar" aria-hidden="true"><i style={{ width: `${Math.round((k / n) * 100)}%` }} /></span>}
        {sb && <button type="button" className="ghost sm" aria-expanded={open === `s:${name}`} onClick={() => toggle(`s:${name}`)}>{open === `s:${name}` ? 'Скрыть библию цикла' : 'Показать библию цикла'}</button>}
        {open === `s:${name}` && sb && SFIELDS.map(([f, t]) => (
          <label key={f} className="fld"><span className="lbl">{t}</span>
            <textarea rows={rows(f)} value={sb[f] || ''} onChange={(e) => app.saveSeries(name, { ...sb, [f]: e.target.value })} />
          </label>
        ))}
        <div className="lib">{docs.map((d) => book(d, true))}</div>
      </section>
    )
  }

  const single = lib.filter((d) => !d.series)
  return (
    <div className="page">
      <h2>Библиотека</h2>
      <p className="muted">Создайте цикл и добавьте в него части. «Изучить весь цикл» читает части по порядку, каждую главу целиком, и помнит всё прочитанное раньше: к каждой главе прикладывается память сюжета прошлых глав и частей, поэтому связи и смысл цикла не обрываются. Получается подробная «библия» каждой части и всего цикла: события, герои и их арки, факты канона, хронология, стиль и найденные несостыковки.</p>
      <datalist id="series-names">{names.map((n) => <option key={n} value={n} />)}</datalist>
      <form className="row newcycle" onSubmit={(e) => { e.preventDefault(); if (cname.trim()) { app.addCycle(cname); setCname('') } }}>
        <input value={cname} onChange={(e) => setCname(e.target.value)} placeholder="Название цикла, например: Цена вершины" aria-label="Название нового цикла" />
        <button className="go" disabled={!cname.trim()}>＋ Добавить цикл</button>
      </form>
      <div className="lib">
        {lib.length === 0 && !names.length && <p className="empty-note">Пока пусто. Создайте цикл и добавьте в него части или добавьте отдельную книгу ниже.</p>}
        {names.map(seriesBlock)}
        {single.map((d) => book(d))}
      </div>
      {app.studyErr && <p className="err" role="alert">{app.studyErr}</p>}
      {err && <p className="err" role="alert">{err}</p>}
      {msg && <p className="muted" role="status">{msg}</p>}
      <div className="row">
        <label className="ghost file">{busy ? 'Загружаю…' : 'Добавить отдельную книгу (.txt .md .fb2 .html)'}
          <input type="file" multiple accept=".txt,.md,.text,.fb2,.html,.htm,.xml" onChange={onFile} hidden />
        </label>
      </div>
      <details className="paste">
        <summary>Загрузить папку целиком (только на компьютере)</summary>
        <fieldset className="row modes">
          <legend className="lbl">Папка — это</legend>
          <label className="chk"><input type="radio" name="fmode" checked={mode === 'series'} onChange={() => setMode('series')} /> цикл: каждый файл или подпапка — отдельная часть</label>
          <label className="chk"><input type="radio" name="fmode" checked={mode === 'book'} onChange={() => setMode('book')} /> одна книга: файлы — главы по порядку</label>
        </fieldset>
        <label className="ghost file">{busy ? 'Загружаю…' : '📁 Выбрать папку'}
          <input type="file" webkitdirectory="" directory="" multiple onChange={onFolder} hidden />
        </label>
        <p className="muted small">На телефонах выбор папки не поддерживается: создайте цикл и добавьте части файлами.</p>
      </details>
      <div className="row">
        <input type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="Ссылка на главу или книгу" aria-label="Ссылка на книгу" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onLink() } }} />
        <button type="button" className="ghost" disabled={!link.trim() || busy} onClick={onLink}>Добавить ссылку</button>
      </div>
      <p className="muted small">Страницы Автор Тудей с закрытой частью по ссылке не прочитаются: надёжнее файл .txt или .fb2.</p>
      <details className="paste">
        <summary>Вставить текст вручную</summary>
        <form onSubmit={onPaste}>
          <input value={pname} onChange={(e) => setPname(e.target.value)} placeholder="Название (например: Цена вершины, глава 12)" aria-label="Название текста" />
          <textarea rows={6} value={ptext} onChange={(e) => setPtext(e.target.value)} placeholder="Текст главы или книги…" aria-label="Текст" />
          {names.length > 0 && <select value={pcycle} onChange={(e) => setPcycle(e.target.value)} aria-label="В какой цикл"><option value="">Отдельная книга</option>{names.map((n) => <option key={n} value={n}>Часть цикла «{n}»</option>)}</select>}
          <button className="go" disabled={ptext.trim().length < 200 || busy}>Сохранить в библиотеку</button>
        </form>
      </details>
      <label className="fld"><span className="lbl">О моих книгах (видят все помощники): жанр, аудитория, правила мира</span>
        <textarea rows={5} value={app.notes} onChange={(e) => app.setNotes(e.target.value)} placeholder="Альтернативная история и попаданцы, герои, ограничения…" />
      </label>
      <details className="paste">
        <summary>Чему научились помощники</summary>
        <p className="muted small">Правила вкуса выводятся сами из ваших выборов (каждые 10 выборов), уроки — из ваших правок принятых черновиков. Всё это попадает в каждый запрос. Можно править и дописывать.</p>
        <label className="fld"><span className="lbl">Правила вкуса</span>
          <textarea rows={6} value={taste.rules || ''} onChange={(e) => app.setRules(e.target.value)} placeholder="Появятся после 10 выборов идей…" />
        </label>
        <label className="fld"><span className="lbl">Уроки из правок (по одному в строке)</span>
          <textarea rows={6} value={(taste.lessons || []).join('\n')} onChange={(e) => app.setLessons(e.target.value.split('\n'))} onBlur={(e) => app.setLessons(e.target.value.split('\n').map((l) => l.trim()).filter(Boolean))} placeholder="Появятся, когда вы примете отредактированный черновик…" />
        </label>
      </details>
    </div>
  )
}
