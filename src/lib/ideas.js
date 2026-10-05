// Сборка главы по блокам: варианты ходов от помощников → план → черновик.
import { HELPERS } from './agents'
import { parseJSON, cut } from './text'
import { uid } from './store'

export const BLOCKS = [
  { k: 'open', n: 'Завязка', q: 'как глава начинается: время, место, ситуация и первая сцена' },
  { k: 'clash', n: 'Конфликт', q: 'в чём главное препятствие, столкновение или выбор героя' },
  { k: 'turn', n: 'Поворот', q: 'неожиданный, но логичный поворот посреди главы' },
  { k: 'end', n: 'Финал и крючок', q: 'чем глава заканчивается и что заставит читателя открыть следующую' },
]

export const chosenText = (c) => BLOCKS.filter((b) => c.blocks[b.k]?.chosen).map((b) => `${b.n}: ${c.blocks[b.k].chosen.text}`).join('\n')
const head = (c) => `[Новая глава] ${c.title}. Пожелания автора: ${c.brief || 'нет'}`

export async function genOptions({ block, ctx, chapter, seen, run }) {
  const prompt = `Помоги автору выбрать ход для новой главы. Нужен блок «${block.n}»: ${block.q}.
Дай ровно 5 разных вариантов, по одному от каждого помощника:
${HELPERS.map((h) => `- ${h.id}: ${h.n}. ${h.p}`).join('\n')}
Каждый вариант это конкретная идея в 1-2 предложениях, до 35 слов, вытекающая из канона книги. Не критикуй, а предлагай. Варианты должны заметно отличаться направлением.
Верни ТОЛЬКО JSON-массив: [{"by":"plot","text":"..."}] (by это id помощника).

${ctx}

${head(chapter)}
[Уже выбрано для этой главы]
${chosenText(chapter) || 'пока ничего'}
[Уже предлагали, не повторяй]
${seen.slice(-10).map((s) => `- ${cut(s, 100)}`).join('\n') || 'нет'}`
  const raw = await run(prompt)
  const j = parseJSON(raw)
  let items = Array.isArray(j) ? j : Array.isArray(j?.options) ? j.options : []
  items = items.filter((x) => x && typeof x.text === 'string' && x.text.trim())
  if (items.length < 2) {
    items = raw.split('\n').map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter((l) => l.length > 25).slice(0, 5).map((text) => ({ text }))
  }
  if (!items.length) throw new Error('Помощники не смогли предложить варианты. Нажмите ещё раз или выберите другую модель.')
  const ids = HELPERS.map((h) => h.id)
  return items.slice(0, 6).map((x, i) => ({ id: uid(), by: ids.includes(x.by) ? x.by : ids[i % ids.length], text: x.text.trim() }))
}

export const planPrompt = (ctx, c) => `Составь план новой главы из 6-8 пунктов: нумерованный список, по одному предложению. Ходы, выбранные автором, обязательны, остальное дострой логично и по канону книги. Только план, без вступлений.

${ctx}

${head(c)}
[Выбранные автором ходы]
${chosenText(c)}`

const WRITE = 'Ты пишешь черновик главы голосом автора. Следуй плану, держись канона книги и стиля автора (см. [Стиль автора] и образец). Пиши по-русски, живо, сценами и диалогами. Никаких пояснений, списков и заголовков вне текста. Не завершай историю всей книги.'
export const draftPrompt = (ctx, c) => `${WRITE} Объём около ${c.words} слов.

${ctx}

${head(c)}
[План главы]
${c.plan || chosenText(c)}

Текст главы:`
export const contPrompt = (ctx, c) => `${WRITE} Продолжи черновик ровно с того места, где он оборвался, не повторяя написанное. Объём продолжения около ${Math.round(c.words / 2)} слов; если по плану глава заканчивается, доведи её до финала.

${ctx}

${head(c)}
[План главы]
${c.plan || chosenText(c)}
[Конец уже написанного]
${c.draft.slice(-2500)}

Продолжение:`
