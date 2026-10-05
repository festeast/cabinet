// Запросы к OpenRouter: бесплатные модели по очереди, учёт лимитов, запасной платный вариант.
import { ls } from './store'

export const API = 'https://openrouter.ai/api/v1'
const subs = new Set()
export const subscribe = (f) => { subs.add(f); return () => subs.delete(f) }
const emit = () => subs.forEach((f) => f())

const day = () => new Date().toISOString().slice(0, 10)
export const used = () => { const u = ls.get('cab_used', {}); return u.d === day() ? u.n : 0 }
function bump() { const u = ls.get('cab_used', {}); ls.set('cab_used', { d: day(), n: (u.d === day() ? u.n : 0) + 1 }); emit() }
function hit(id, raw) {
  const daily = /day|daily|сут/i.test(raw || '')
  const h = ls.get('cab_hit', {})
  h[id] = { until: daily ? Date.parse(day()) + 864e5 : Date.now() + 60000, daily }
  ls.set('cab_hit', h); emit()
}
export const hits = () => Object.entries(ls.get('cab_hit', {})).filter(([, v]) => v.until > Date.now()).map(([id, v]) => ({ id, daily: v.daily }))
// Модели, не подходящие для обычного чата (400/403/404 или «только для агентов»), отключаются на 7 дней.
const markBad = (id) => { const b = ls.get('cab_bad', {}); b[id] = Date.now() + 6048e5; ls.set('cab_bad', b); emit() }
export const isBad = (id) => (ls.get('cab_bad', {})[id] || 0) > Date.now()
const alive = (ids) => { const h = hits().map((x) => x.id), ok = ids.filter((i) => !isBad(i)), a = ok.filter((i) => !h.includes(i)); return a.length ? a : ok }
export const short = (id) => id.split('/').pop().replace(':free', '') + (id.endsWith(':free') ? '' : ' 💳')
const stat = () => ls.get('cab_stats', {})
function note(id, ok, ms) {
  const st = stat(), r = st[id] || { t: 6000 }
  r.t = ok ? Math.round(r.t * 0.6 + ms * 0.4) : r.t + 5000
  st[id] = r; ls.set('cab_stats', st)
}

export async function loadModels() {
  const c = ls.get('cab_models', null)
  if (c && Date.now() - c.t < 6 * 3600e3) return c
  try {
    const j = await (await fetch(`${API}/models`)).json()
    const data = j.data || []
    const free = data.filter((m) => m.id.endsWith(':free')).sort((a, b) => (b.context_length || 0) - (a.context_length || 0)).map((m) => ({ id: m.id, name: m.name || m.id }))
    const paid = data.filter((m) => !m.id.endsWith(':free') && +m.pricing?.prompt > 0 && +m.pricing?.completion > 0 && (m.context_length || 0) >= 16000)
      .map((m) => ({ id: m.id, name: m.name || m.id, c: (+m.pricing.prompt + +m.pricing.completion) * 1e6 })).sort((a, b) => a.c - b.c).slice(0, 15)
    const v = { t: Date.now(), free, paid }
    ls.set('cab_models', v)
    return v
  } catch (e) { if (c) return c; throw e }
}

export async function loadCap(key) {
  try {
    const j = await (await fetch(`${API}/key`, { headers: { Authorization: `Bearer ${key}` } })).json()
    return j.data ? (j.data.is_free_tier === false ? 1000 : 50) : 50
  } catch { return 50 }
}

async function streamRaw(key, model, prompt, onText, signal) {
  const res = await fetch(`${API}/chat/completions`, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, 'HTTP-Referer': location.origin },
    body: JSON.stringify({ model, stream: true, messages: [{ role: 'user', content: prompt }] }),
  })
  if (!res.ok) {
    const j = await res.json().catch(() => ({}))
    throw Object.assign(new Error(res.status === 401 ? 'Ключ не принят. Выйдите и введите заново.' : res.status === 429 ? 'Лимит бесплатной модели исчерпан. Выберите другую модель или подождите.' : res.status === 402 ? 'Не хватает баланса на OpenRouter. Пополните его или выключите платные запросы.' : j.error?.message || `Ошибка ${res.status}`), { status: res.status, raw: JSON.stringify(j.error || {}) })
  }
  const reader = res.body.getReader(), dec = new TextDecoder()
  let buf = '', acc = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n'); buf = lines.pop()
    for (const ln of lines) {
      if (!ln.startsWith('data: ') || ln.includes('[DONE]')) continue
      let j
      try { j = JSON.parse(ln.slice(6)) } catch { continue }
      if (j.error) throw new Error(j.error.message || 'Ошибка модели')
      const d = j.choices?.[0]?.delta?.content
      if (d) { acc += d; onText(acc) }
    }
  }
  return acc
}

async function stream(key, model, prompt, onText, signal, ttf = 0) {
  if (model.endsWith(':free')) bump()
  else { ls.set('cab_paidn', ls.get('cab_paidn', 0) + 1); emit() }
  const ac = new AbortController()
  const fwd = () => ac.abort()
  signal?.addEventListener('abort', fwd)
  const timer = ttf ? setTimeout(() => ac.abort(), ttf) : 0
  try { return await streamRaw(key, model, prompt, (x) => { clearTimeout(timer); onText(x) }, ac.signal) }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', fwd) }
}

let rot = 0
// «Авто»: 4 самые быстрые модели из истории; если модель молчит дольше 15 секунд или сбоит, идём к следующей.
export async function complete(key, prompt, o = {}) {
  const { models = [], model = 'auto', paid, cap = 50, onText = () => {}, signal, onModel = () => {} } = o
  const auto = model === 'auto'
  const st = stat()
  const paidOn = paid?.on && paid.id
  const goPaid = () => { onModel(paid.id); return stream(key, paid.id, prompt, onText, signal, 0) }
  if (paidOn && used() >= cap) return goPaid()
  const list = auto ? alive(models.map((m) => m.id)).sort((a, b) => (st[a]?.t ?? 6000) - (st[b]?.t ?? 6000)).slice(0, 4) : [model]
  if (!list.length && paidOn) return goPaid()
  if (!list.length) throw new Error('Нет доступных бесплатных моделей: список не загрузился или все отключены.')
  const from = auto ? rot++ : 0
  let last, lim = false
  for (let k = 0; k < list.length; k++) {
    const id = list[(from + k) % list.length], t0 = Date.now()
    try {
      onModel(id)
      const t = await stream(key, id, prompt, onText, signal, auto ? 15000 : 0)
      if (!t.trim()) throw new Error('Модель ничего не ответила.')
      note(id, true, Date.now() - t0)
      return t
    } catch (e) {
      if (signal?.aborted || e.status === 401) throw e
      note(id, false)
      if (e.status === 429) { hit(id, e.raw); lim = true }
      const unfit = [400, 403, 404, 422].includes(e.status) || /harness|agentic|no endpoints|unsupported/i.test(`${e.raw || ''} ${e.message}`)
      if (unfit) markBad(id)
      last = unfit ? new Error(`Модель ${short(id)} не подходит для обычного чата, я её отключил.`) : e.name === 'AbortError' ? new Error('Модель слишком долго молчит.') : e
    }
  }
  if (paidOn && lim) return goPaid()
  throw last
}
