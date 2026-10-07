import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// StrictMode deliberately stays off here. Its development-only double effect
// would request the Ping SSO token and connect to the broker twice during startup.
createRoot(document.getElementById('root')!).render(<App />)
