import { useEffect, useState } from 'react'
import { WRITERS, CORE } from '../lib/agents'
import { doneCount } from '../lib/bible'
import { config } from '../config'
import Av from './Av'
import EchoWave from './EchoWave'

function useTyped(text) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setN(text.length); return undefined }
    setN(0)
    const t = setInterval(() => setN((v) => { if (v >= text.length) { clearInterval(t); return v } return v + 1 }), 20)
    return () => clearInterval(t)
  }, [text])
  return text.slice(0, n)
}

const PHASE = { chapters: 'читаю главы', memory: 'обновляю память сюжета', summary: 'собираю героев и сюжет', check: 'проверяю несостыковки', style: 'изучаю ваш стиль', essence: 'понимаю суть книги', series: 'собираю библию цикла', seriesCheck: 'проверяю цикл', done: 'готово' }

export default function Home({ app, go }) {
  const { lib, bibles, job } = app
  const h = new Date().getHours()
  const hello = h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер'
  const studied = lib.filter((d) => bibles[d.id])
  const chapters = studied.reduce((n, d) => n + bibles[d.id].chapters.length, 0)
  const read = studied.reduce((n, d) => n + doneCount(bibles[d.id]), 0)
  const text = lib.length === 0
    ? `${hello}, ${config.penName}. Библиотека пуста: загрузите книги, и я их изучу.`
    : `${hello}, ${config.penName}. Книг в библиотеке: ${lib.length}, изучено глав: ${read} из ${chapters || '…'}. Что пишем сегодня?`
  const typed = useTyped(text)

  return (
    <div className="hub">
      <p className="greet" aria-label={text}><span aria-hidden="true">{typed}<i className="cur" /></span></p>
      <div className="orbit">
        <i className="ring c" aria-hidden="true" />
        <button className="core" onClick={() => go('table')} aria-label="Эхо: круглый стол писарей">
          <EchoWave level={job ? 1 : 0} /><span>{CORE.n}</span>
        </button>
        {WRITERS.map((x, i) => (
          <button key={x.id} className="node" style={{ '--a': `${i * (360 / WRITERS.length)}deg`, '--c': x.c }} onClick={() => go('table')} title={`Круглый стол: ${x.n}`}>
            <Av w={x} /><b>{x.n}</b>
          </button>
        ))}
      </div>
      <div className="acts">
        <button className={lib.length ? 'go' : 'ghost'} onClick={() => go('chapter')}>Новая глава</button>
        <button className="ghost" onClick={() => go('table')}>Круглый стол</button>
        <button className={lib.length ? 'ghost' : 'go'} onClick={() => go('library')}>Библиотека</button>
      </div>
      {job && (
        <p className="job" role="status">
          Изучаю «{job.series || lib.find((d) => d.id === job.book)?.name}»: {PHASE[job.phase] || '…'}{job.phase === 'chapters' ? ` (${job.i + 1} из ${job.n})` : ''}
          <button className="ghost" onClick={app.stopStudy}>Остановить</button>
        </p>
      )}
      {lib.length > 0 && (
        <ul className="hud" aria-label="Состояние библиотеки">
          {lib.map((d) => {
            const b = bibles[d.id], n = b ? b.chapters.length : 0, k = doneCount(b), pct = n ? Math.round((k / n) * 100) : 0
            return (
              <li key={d.id}>
                <span className="nm">{d.name}</span>
                <span className="bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>
                <small>{b ? (k === n && b.brief ? 'изучена' : `изучено ${k} из ${n}`) : 'не изучена'}</small>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
