import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// StrictMode deliberately stays off here. Its development-only double effect
// would start two cross-origin OAuth bootstraps, which is especially confusing
// inside Vault CRM's WKWebView.
createRoot(document.getElementById('root')!).render(<App />)
