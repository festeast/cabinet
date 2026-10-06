import EchoWave from './EchoWave'

export default function Av({ w, size = '', level = 0 }) {
  if (w.id === 'core') return <span className={`av echo ${size}`} style={{ '--c': w.c }} aria-hidden="true"><EchoWave mini level={level || 1} /></span>
  return <span className={`av ${size}`} style={{ '--c': w.c }} aria-hidden="true">{w.img ? <img src={w.img} alt="" /> : w.icon}</span>
}
