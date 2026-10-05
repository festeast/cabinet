import { useEffect, useState } from 'react'
import { config } from './config'

function useRepos(username) {
  const [state, setState] = useState({ status: 'loading', repos: [] })
  useEffect(() => {
    fetch(`https://api.github.com/users/${username}/repos?sort=updated&per_page=12`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((all) => setState({ status: 'ok', repos: all.filter((r) => !r.fork) }))
      .catch(() => setState({ status: 'error', repos: [] }))
  }, [username])
  return state
}

export default function App() {
  const { status, repos } = useRepos(config.username)
  return (
    <>
      <div className="aurora" aria-hidden="true"><i /><i /><i /></div>
      <main>
        <header className="hero">
          <h1>{config.name}</h1>
          <p className="tagline">{config.tagline}</p>
          <a className="btn" href="#projects">Смотреть проекты</a>
        </header>

        <section id="about">
          <h2>Обо мне</h2>
          {config.about.map((t) => <p key={t}>{t}</p>)}
        </section>

        <section id="books">
          <h2>Книги</h2>
          <p>Пишу под именем {config.penName}: альтернативная история и попаданцы. Все книги — на <a href={config.authorPage}>Автор Тудей</a>.</p>
          {config.series.map((s) => (
            <div className="series" key={s.title}>
              <h3><a href={s.href}>{s.title}</a></h3>
              <ul>
                {s.books.map((b) => (
                  <li key={b.title}>
                    <a href={b.href}>{b.title}</a>
                    {b.status && <small> ({b.status})</small>}
                    <span>{b.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        <section id="projects">
          <h2>Проекты</h2>
          {status === 'loading' && <p className="muted">Загружаю репозитории…</p>}
          {status === 'error' && <p className="muted">Не удалось загрузить проекты. Они всегда доступны на <a href={config.links[0].href}>GitHub</a>.</p>}
          {status === 'ok' && repos.length === 0 && (
            <div className="empty">
              <p>Здесь будут проекты.</p>
              <p className="muted">Скоро здесь появятся первые проекты.</p>
            </div>
          )}
          <ul className="repos">
            {repos.map((r) => (
              <li key={r.id}>
                <a href={r.html_url}>
                  <strong>{r.name}</strong>
                  <span>{r.description || 'Без описания'}</span>
                  <small>{[r.language, r.stargazers_count > 0 && `${r.stargazers_count} звёзд`].filter(Boolean).join(', ')}</small>
                </a>
              </li>
            ))}
          </ul>
        </section>

        <section id="contacts">
          <h2>Контакты</h2>
          <ul className="links">
            {config.links.map((l) => <li key={l.label}><a href={l.href}>{l.label}</a></li>)}
          </ul>
        </section>
      </main>
    </>
  )
}
