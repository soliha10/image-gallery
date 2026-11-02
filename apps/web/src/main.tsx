import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './index.css'
import { initTelegram } from './lib/telegram'

initTelegram()

const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined
if (dsn) void import('@sentry/react').then((Sentry) => Sentry.init({ dsn }))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
