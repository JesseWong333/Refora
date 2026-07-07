import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { BookOpen } from 'lucide-react'
import { api } from '../ipc'

interface FirstRunWizardProps {
  onDone: () => void
}

export default function FirstRunWizard({ onDone }: FirstRunWizardProps) {
  const { t } = useTranslation()
  const [picking, setPicking] = useState(false)

  const handleChooseLibrary = async () => {
    setPicking(true)
    try {
      const path = await api.dialog.openDirectory()
      if (path) {
        await api.settings.set('libraryFolderPath', path)
      }
    } catch {
      void 0
    }
    setPicking(false)
    onDone()
  }

  const handleSkip = () => {
    onDone()
  }

  return (
    <div className="dialog-overlay">
      <div className="dialog-panel flex w-80 flex-col items-center gap-4">
        <BookOpen className="h-12 w-12 text-accent" />
        <h1 className="text-base font-semibold text-foreground">
          {t('wizard.title', 'Welcome to ScholarNote')}
        </h1>
        <p className="text-center text-xs text-muted leading-relaxed">
          {t('wizard.description', 'Import your first PDF or connect a watch folder to get started.')}
        </p>
        <div className="flex w-full flex-col gap-2">
          <button
            className="w-full rounded-lg bg-accent px-4 py-2.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
            onClick={handleChooseLibrary}
            disabled={picking}
          >
            {t('wizard.chooseLibrary', 'Choose Library Folder')}
          </button>
          <button
            className="w-full rounded-lg bg-panel-2 px-4 py-2.5 text-xs text-foreground hover:bg-hover"
            onClick={handleSkip}
            disabled={picking}
          >
            {t('wizard.skip', 'Skip')}
          </button>
        </div>
      </div>
    </div>
  )
}
