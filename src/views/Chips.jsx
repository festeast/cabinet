import { HELPERS } from '../lib/agents'
import Av from './Av'

export default function Chips({ pick, setPick, disabled }) {
  const all = pick.length === HELPERS.length
  const toggle = (id) => setPick((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  return (
    <div className="chips" role="group" aria-label="Кто отвечает">
      <button type="button" disabled={disabled} aria-pressed={all} onClick={() => setPick(all ? [] : HELPERS.map((a) => a.id))}>Все</button>
      {HELPERS.map((a) => (
        <button key={a.id} type="button" disabled={disabled} aria-pressed={pick.includes(a.id)} style={{ '--c': a.c }} onClick={() => toggle(a.id)}>
          <Av w={a} size="sm" />{a.n}
        </button>
      ))}
    </div>
  )
}
