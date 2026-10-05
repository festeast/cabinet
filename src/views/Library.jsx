import { useState } from 'react'
import { doneCount } from '../lib/bible'
import { readFileDoc, readLink, textDoc } from '../lib/books'
import { splitUnits } from '../lib/text'
import { docGet } from '../lib/store'

const FIELDS = [['brief', 'О чём книга'], ['characters', 'Герои'], ['world', 'Мир и правила'], ['threads', 'Незакрытые линии'], ['style', 'Стиль автора (правьте под себя)']]

export default function Library({ app }) {
  const { lib, bibles, job } = app
  const [open, setOpen] = useState('')
  const [link, setLink] = useState('')
  const [pname, setPname] = useState('')
  const [ptext, setPtext] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function onFile(e) {
    const fs = [...(e.target.files || [])]
    e.target.value = ''
    setBusy(true); setErr('')
    for (const f of fs) {
      try { const { meta, text } = await readFileDoc(f); await app.addDoc(meta, text) } catch (x) { setErr(x.message || `Не удалось сохранить файл ${f.name}`) }
    }
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
    try { const { meta, text } = textDoc(pname.trim() || 'Вставленный текст', ptext); await app.addDoc(meta, text); setPname(''); setPtext('') } catch { setErr('Не удалось сохранить текст.') }
    setBusy(false)
  }
  async function study(d) {
    const text = await docGet(d.id).catch(() => null)
    const n = text ? splitUnits(text).length : 0
    const left = n - doneCount(bibles[d.id])
    if (!confirm(`Нужно примерно ${left + 2} запросов к ИИ (глав: ${left}). Бесплатный лимит около ${app.capEff} в день; прогресс сохраняется, продолжить можно в любой момент. Начать?`)) return
    app.study(d)
  }

  return (
    <div className="page">
      <h2>Библиотека</h2>
      <p className="muted">Книги остаются здесь и доступны помощникам всегда. После загрузки нажмите «Изучить»: я составлю «библию» книги (главы, герои, мир, стиль), и помощники будут опираться на неё.</p>
      <div className="lib">
        {lib.length === 0 && <p className="empty-note">Пока пусто. Добавьте файл ниже.</p>}
        {lib.map((d) => {
          const b = bibles[d.id], n = b ? b.chapters.length : 0, k = doneCount(b), mine = job?.id === d.id
          return (
            <div key={d.id} className="doc col">
              <div className="row top">
                <label className="chk"><input type="checkbox" checked={d.on !== false} onChange={() => app.toggleDoc(d.id)} aria-label={`Книга «${d.name}» доступна помощникам`} /></label>
                <span className="grow"><b>{d.name}</b><small>{d.kind === 'link' ? 'ссылка' : d.kind === 'draft' ? 'ваш черновик' : 'файл'}, {Math.round(d.size / 1000)} тыс. знаков, {b ? `изучено ${k} из ${n}` : 'не изучена'}</small></span>
                {mine
                  ? <button className="ghost" onClick={app.stopStudy}>Остановить</button>
                  : <button className="ghost" disabled={!!job} onClick={() => study(d)}>{b && k === n && b.brief ? 'Изучить заново недостающее' : k ? 'Продолжить изучение' : 'Изучить'}</button>}
                <button className="ghost" disabled={mine} onClick={() => app.removeDoc(d.id)}>Убрать</button>
              </div>
              {b && n > 0 && <span className="bar" aria-hidden="true"><i style={{ width: `${Math.round((k / n) * 100)}%` }} /></span>}
              {b && (
                <>
                  <button type="button" className="ghost sm" aria-expanded={open === d.id} onClick={() => setOpen(open === d.id ? '' : d.id)}>{open === d.id ? 'Скрыть библию' : 'Показать библию'}</button>
                  {open === d.id && FIELDS.map(([f, t]) => (
                    <label key={f} className="fld"><span className="lbl">{t}</span>
                      <textarea rows={f === 'style' ? 6 : 4} value={b[f] || ''} onChange={(e) => app.saveBible(d.id, { ...b, [f]: e.target.value })} />
                    </label>
                  ))}
                </>
              )}
            </div>
          )
        })}
      </div>
      {app.studyErr && <p className="err" role="alert">{app.studyErr}</p>}
      {err && <p className="err" role="alert">{err}</p>}
      <div className="row">
        <label className="ghost file">{busy ? 'Загружаю…' : 'Добавить файлы (.txt .md .fb2 .html)'}
          <input type="file" multiple accept=".txt,.md,.text,.fb2,.html,.htm,.xml" onChange={onFile} hidden />
        </label>
      </div>
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
          <button className="go" disabled={ptext.trim().length < 200 || busy}>Сохранить в библиотеку</button>
        </form>
      </details>
      <label className="fld"><span className="lbl">О моих книгах (видят все помощники): жанр, аудитория, правила мира</span>
        <textarea rows={5} value={app.notes} onChange={(e) => app.setNotes(e.target.value)} placeholder="Альтернативная история и попаданцы, герои, ограничения…" />
      </label>
    </div>
  )
}
