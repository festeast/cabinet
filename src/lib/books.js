import { splitUnits } from './text'
import { uid } from './store'

export const ALLOWED = /\.(txt|md|text|fb2|html?|xml)$/i

export function plain(name, raw) {
  if (!/\.(fb2|html?|xml)$/i.test(name)) return raw
  const d = new DOMParser().parseFromString(raw, /\.(fb2|xml)$/i.test(name) ? 'application/xml' : 'text/html')
  const ps = [...d.querySelectorAll('p,h1,h2,h3')].map((e) => e.textContent.trim()).filter(Boolean)
  return ps.length ? ps.join('\n') : d.documentElement.textContent
}

const mk = (name, kind, text, extra = {}) => ({ meta: { id: uid(), name, kind, size: text.length, chapters: splitUnits(text).length, on: true, ...extra }, text })

export async function readFileDoc(f) {
  if (!ALLOWED.test(f.name)) throw new Error('Поддерживаются .txt, .md, .fb2, .html. Word сохраните как .txt или вставьте текст в поле.')
  const buf = await f.arrayBuffer()
  let raw
  try { raw = new TextDecoder('utf-8', { fatal: true }).decode(buf) } catch { raw = new TextDecoder('windows-1251').decode(buf) }
  return mk(f.name, 'file', plain(f.name, raw))
}

export async function readLink(u) {
  if (!/^https?:\/\//i.test(u)) throw new Error('Ссылка должна начинаться с http:// или https://')
  const r = await fetch(`https://r.jina.ai/${u}`)
  if (!r.ok) throw new Error('bad')
  const text = (await r.text()).trim()
  if (text.length < 200) throw new Error('short')
  return mk(u.replace(/^https?:\/\//, '').slice(0, 60), 'link', text, { url: u })
}

export const textDoc = (name, text, kind = 'text') => mk(name, kind, text)
