import React from 'react'
import { createRoot } from 'react-dom/client'
import { ConfigProvider } from '@lobehub/ui'
import { motion } from 'motion/react'
import Splash from './components/Splash'
import App from './App'
import { initI18n } from './i18n'
import './styles/index.css'

const IS_MAC = navigator.platform.toLowerCase().includes('mac')
if (IS_MAC) {
  document.documentElement.dataset.platform = 'mac'
}

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element #root not found')
}

const root = createRoot(rootElement)
root.render(<Splash />)

function mountApp(bootstrap: { language: 'zh' | 'en'; listColumnState: unknown; sidebarCollapsed: boolean; firstRun: boolean }) {
  initI18n(bootstrap.language)
  root.render(
    <React.StrictMode>
      <ConfigProvider motion={motion}>
        <App
          listColumnState={bootstrap.listColumnState as never}
          sidebarCollapsed={bootstrap.sidebarCollapsed}
          firstRun={bootstrap.firstRun}
        />
      </ConfigProvider>
    </React.StrictMode>
  )
}

window.api
  .getBootstrap()
  .then((bootstrap) => {
    mountApp(bootstrap)
  })
  .catch(() => {
    mountApp({ language: 'en', listColumnState: null, sidebarCollapsed: false, firstRun: false })
  })
