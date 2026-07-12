import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Files, Clock, Plus, Star } from 'lucide-react'
import { useDocumentStore } from '../store/documentStore'
import type { ListMode } from '../../shared/ipc-types'
import { SidebarItem } from './sidebarShared'

const SMART_ITEMS: { key: string; mode: ListMode; icon: ReactNode }[] = [
  { key: 'allFiles', mode: 'all', icon: <Files className="h-4 w-4" /> },
  { key: 'recentlyRead', mode: 'recentlyRead', icon: <Clock className="h-4 w-4" /> },
  { key: 'recentlyAdded', mode: 'recentlyAdded', icon: <Plus className="h-4 w-4" /> },
  { key: 'starred', mode: 'starred', icon: <Star className="h-4 w-4" /> }
]

export default function SidebarSmartItems() {
  const { t } = useTranslation()
  const listMode = useDocumentStore((s) => s.listMode)
  const setListMode = useDocumentStore((s) => s.setListMode)

  return (
    <div className="mb-4 px-1">
      {SMART_ITEMS.map((item) => (
        <SidebarItem
          key={item.key}
          icon={item.icon}
          label={t(`sidebar.${item.key}`)}
          active={listMode.mode === item.mode}
          onClick={() => setListMode({ mode: item.mode })}
        />
      ))}
    </div>
  )
}
