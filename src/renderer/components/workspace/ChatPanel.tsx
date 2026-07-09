import { useTranslation } from 'react-i18next'

export default function ChatPanel() {
  const { t } = useTranslation()
  return (
    <div className="flex h-full w-full items-center justify-center p-6 text-center">
      <p className="text-sm text-muted">{t('workspace.chatPlaceholder')}</p>
    </div>
  )
}
