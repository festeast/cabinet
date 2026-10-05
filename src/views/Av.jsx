export default function Av({ w, size = '' }) {
  return <span className={`av ${size}`} style={{ '--c': w.c }} aria-hidden="true">{w.img ? <img src={w.img} alt="" /> : w.icon}</span>
}
