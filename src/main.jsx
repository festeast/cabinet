import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import Cabinet from './Cabinet.jsx'
import './App.css'

// Сайт открывается сразу кабинетом. Старая визитка осталась по адресу /#site.
function Root() {
  const [hash, setHash] = useState(location.hash)
  useEffect(() => {
    const on = () => setHash(location.hash)
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  return hash === '#site' ? <App /> : <><div className="aurora" aria-hidden="true"><i /><i /><i /></div><Cabinet /></>
}

createRoot(document.getElementById('root')).render(<Root />)
