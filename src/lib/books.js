import { splitUnits, chaptersOf } from './text'
import { uid } from './store'

export const ALLOWED = /\.(txt|md|text|fb2|html?|xml)$/i

export function plain(name, raw) {
  if (!/\.(fb2|html?|xml)$/i.test(name)) return raw
  const d = new DOMParser().parseFromString(raw, /\.(fb2|xml)$/i.test(name) ? 'application/xml' : 'text/html')
  const ps = [...d.querySelectorAll('p,h1,h2,h3')].map((e) => e.textContent.trim()).filter(Boolean)
  return ps.length ? ps.join('\n') : d.documentElement.textContent
}

const mk = (name, kind, text, extra = {}) => ({ meta: { id: uid(), name, kind, size: text.length, chapters: splitUnits(text).length, on: true, ...extra }, text })

async function fileText(f) {
  const buf = await f.arrayBuffer()
  let raw
  try { raw = new TextDecoder('utf-8', { fatal: true }).decode(buf) } catch { raw = new TextDecoder('windows-1251').decode(buf) }
  return plain(f.name, raw)
}

export async function readFileDoc(f) {
  if (!ALLOWED.test(f.name)) throw new Error('Поддерживаются .txt, .md, .fb2, .html. Word сохраните как .txt или вставьте текст в поле.')
  return mk(f.name, 'file', await fileText(f))
}

// «Том 2» идёт после «Том 1», а «Глава 10» после «Главы 9».
const natural = (a, b) => a.localeCompare(b, 'ru', { numeric: true, sensitivity: 'base' })
const bare = (n) => n.replace(/\.[^.]+$/, '')

// Склеиваем файлы-главы в одну книгу. Если в файле нет своего заголовка «Глава…», ставим его по имени файла,
// чтобы разбор шёл ровно по главам, а не по кускам.
async function joinFiles(fs) {
  const out = []
  for (const [i, f] of fs.entries()) {
    const t = (await fileText(f)).trim()
    if (!t) continue
    out.push(chaptersOf(t).length || /^[ \t]*(?:глава|chapter|пролог|эпилог)/i.test(t) ? t : `Глава ${i + 1}. ${bare(f.name)}\n${t}`)
  }
  return out.join('\n\n')
}

// Папка целиком. mode 'series': папка это цикл, каждый файл или подпапка в ней — отдельная книга цикла.
// mode 'book': вся папка — одна книга, файлы в ней — главы по порядку имён.
export async function readFolder(list, mode = 'series') {
  const fs = list.filter((f) => ALLOWED.test(f.name) && !/(^|\/)\./.test(f.webkitRelativePath || f.name)).sort((a, b) => natural(a.webkitRelativePath || a.name, b.webkitRelativePath || b.name))
  const skipped = list.length - fs.length
  if (!fs.length) throw new Error('В папке нет файлов .txt, .md, .fb2 или .html.')
  const root = (fs[0].webkitRelativePath || '').split('/')[0] || 'Папка'
  if (mode === 'book') {
    const text = await joinFiles(fs)
    return { series: '', docs: text ? [mk(root, 'folder', text, { files: fs.length })] : [], skipped }
  }
  const groups = new Map()
  for (const f of fs) {
    const parts = (f.webkitRelativePath || f.name).split('/')
    const key = parts.length > 2 ? parts[1] : bare(parts[parts.length - 1])
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(f)
  }
  const docs = []
  let order = 0
  for (const [name, g] of [...groups].sort((a, b) => natural(a[0], b[0]))) {
    const text = g.length > 1 ? await joinFiles(g) : await fileText(g[0])
    if (text.trim()) docs.push(mk(name, g.length > 1 ? 'folder' : 'file', text, { series: root, order: order++, files: g.length }))
  }
  return { series: root, docs, skipped }
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
