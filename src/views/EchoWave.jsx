// Эхо — «говорящая линия»: несколько звуковых волн, которые дышат в покое и раскачиваются, когда идёт речь.
// level: 0 — тишина, 1 — говорят помощники, 2 — говорит сам Эхо.
const W = 400, H = 100

// Синусоида на два периода: при сдвиге на половину ширины анимация замыкается без шва.
function wave(periods, amp, phase = 0) {
  let d = ''
  for (let x = 0; x <= W * 2; x += 4) {
    const y = H / 2 + Math.sin((x / W) * periods * Math.PI * 2 + phase) * amp
    d += `${x ? 'L' : 'M'}${x} ${y.toFixed(1)}`
  }
  return d
}
const LINES = [
  { d: wave(2, 26), w: 2.6, o: 1, t: '3.2s' },
  { d: wave(3, 18, 1.3), w: 1.6, o: 0.7, t: '2.3s' },
  { d: wave(5, 10, 2.1), w: 1.1, o: 0.5, t: '1.6s' },
]

export default function EchoWave({ level = 0, mini = false, label }) {
  const cls = `echo-wave l${level}${mini ? ' mini' : ''}`
  return (
    <span className={cls} aria-hidden={label ? undefined : 'true'} role={label ? 'img' : undefined} aria-label={label}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="echo-g" x1="0" x2="1">
            <stop offset="0" stopColor="var(--teal)" />
            <stop offset=".5" stopColor="#f5e6a8" />
            <stop offset="1" stopColor="var(--blue)" />
          </linearGradient>
        </defs>
        {LINES.map((l, i) => (
          <g key={i} className="amp" style={{ animationDuration: l.t }}>
            <path className="run" d={l.d} fill="none" stroke="url(#echo-g)" strokeWidth={l.w} strokeOpacity={l.o} strokeLinecap="round" vectorEffect="non-scaling-stroke" style={{ animationDuration: `calc(${l.t} * 1.7)` }} />
          </g>
        ))}
      </svg>
    </span>
  )
}
