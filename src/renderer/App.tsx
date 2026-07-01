import { useState, useEffect } from 'react'
import TopBar from './components/TopBar'
import Sidebar from './components/Sidebar'
import DocumentList from './components/DocumentList'
import DetailPanel from './components/DetailPanel'
import ConfirmDialog from './components/ConfirmDialog'
import FirstRunWizard from './components/FirstRunWizard'
import { useAppShortcuts } from './hooks/useAppShortcuts'
import { useDocumentStore } from './store/documentStore'
import { api } from './ipc'
import type { ListColumnState } from '../shared/ipc-types'

interface AppProps {
  listColumnState: ListColumnState | null
  sidebarCollapsed: boolean
  firstRun: boolean
}

export default function App({ listColumnState, sidebarCollapsed: initialSidebarCollapsed, firstRun }: AppProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(initialSidebarCollapsed)
  const [showWizard, setShowWizard] = useState(firstRun)
  useAppShortcuts()

  useEffect(() => {
    const store = useDocumentStore.getState()
    store.init(listColumnState)
    return () => {
      store.destroy()
    }
  }, [])

  const handleToggleSidebar = () => {
    setSidebarCollapsed((v) => {
      const next = !v
      void api.settings.set('sidebarCollapsed', next ? '1' : '0')
      return next
    })
  }

  return (
    <div className="flex h-screen w-screen flex-col bg-background text-foreground">
      {showWizard && <FirstRunWizard onDone={() => setShowWizard(false)} />}
      <TopBar
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={handleToggleSidebar}
      />
      <div className="flex min-h-0 flex-1">
        <Sidebar collapsed={sidebarCollapsed} />
        <DocumentList />
        <DetailPanel />
        <ConfirmDialog />
      </div>
    </div>
  )
}
