import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { showContextMenu } from '@lobehub/ui'
import type { ContextMenuItem } from '@lobehub/ui'
import {
  ArrowSquareOut,
  CircleNotch,
  File,
  FolderOpen,
  Image as ImageIcon,
  MusicNote,
  Trash,
  VideoCamera,
  WarningCircle
} from '@phosphor-icons/react'
import ReactMarkdown from 'react-markdown'
import type { WorkspaceAsset, WorkspaceAssetTextPreview } from '../../../shared/ipc-types'
import { api } from '../../ipc'
import { createMarkdownComponents, REHYPE_PLUGINS, REMARK_PLUGINS } from '../../utils/markdown'
import { cardClassName } from '../ui'

interface AssetCardProps {
  asset: WorkspaceAsset
  onOpen: () => void
  onReveal: () => void
  onDelete: () => void
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function formatTextPreview(asset: WorkspaceAsset, preview: WorkspaceAssetTextPreview): string {
  if (asset.mimeType !== 'application/json') return preview.content
  try {
    return JSON.stringify(JSON.parse(preview.content), null, 2)
  } catch {
    return preview.content
  }
}

function PreviewIcon({ kind }: { kind: WorkspaceAsset['previewKind'] }) {
  if (kind === 'image') return <ImageIcon className="h-8 w-8" />
  if (kind === 'audio') return <MusicNote className="h-8 w-8" />
  if (kind === 'video') return <VideoCamera className="h-8 w-8" />
  return <File className="h-8 w-8" />
}

export default function AssetCard({ asset, onOpen, onReveal, onDelete }: AssetCardProps) {
  const { t } = useTranslation()
  const [textPreview, setTextPreview] = useState<WorkspaceAssetTextPreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const previewUrl = useMemo(() => api.workspaceAssets.previewUrl(asset.id), [asset.id])

  useEffect(() => {
    if (asset.previewKind !== 'text' || asset.fileMissing) {
      setTextPreview(null)
      setPreviewError(null)
      return
    }
    let cancelled = false
    setTextPreview(null)
    setPreviewError(null)
    void api.workspaceAssets.textPreview(asset.id).then((preview) => {
      if (!cancelled) setTextPreview(preview)
    }).catch((error) => {
      if (!cancelled) setPreviewError(error instanceof Error ? error.message : String(error))
    })
    return () => {
      cancelled = true
    }
  }, [asset.fileMissing, asset.id, asset.previewKind])

  const handleContextMenu = (event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    const menuItems: ContextMenuItem[] = [
      {
        key: 'open',
        label: t('workspace.assetOpen'),
        icon: <ArrowSquareOut className="h-3.5 w-3.5" />,
        onClick: onOpen
      },
      {
        key: 'reveal',
        label: t('workspace.assetReveal'),
        icon: <FolderOpen className="h-3.5 w-3.5" />,
        onClick: onReveal
      },
      { type: 'divider', key: 'divider' },
      {
        key: 'delete',
        label: t('workspace.assetDelete'),
        icon: <Trash className="h-3.5 w-3.5" />,
        onClick: onDelete,
        danger: true
      }
    ]
    showContextMenu(menuItems)
  }

  const textContent = textPreview ? formatTextPreview(asset, textPreview) : ''
  const isMarkdown = asset.mimeType === 'text/markdown'

  return (
    <div
      data-card-kind="asset"
      className={cardClassName('default', false, 'workspace-content-card workspace-content-card--asset group/card flex h-full w-full cursor-pointer flex-col gap-2 overflow-hidden p-3')}
      onDoubleClick={onOpen}
      onContextMenu={handleContextMenu}
    >
      <div className="flex shrink-0 items-start gap-2">
        <div className="workspace-card-heading min-w-0 flex-1">
          <span className="workspace-card-type-label">{t('workspace.cardTypeAsset')}</span>
          <h3 className="workspace-card-title truncate text-sm font-semibold text-foreground" title={asset.fileName}>
            {asset.fileName}
          </h3>
          <p className="mt-0.5 truncate text-xs text-muted">
            {formatFileSize(asset.fileSize)} · {asset.mimeType}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/card:opacity-100">
          <button
            type="button"
            className="rounded p-1 text-muted transition-colors duration-150 hover:text-accent"
            onClick={(event) => { event.stopPropagation(); onOpen() }}
            title={t('workspace.assetOpen')}
            aria-label={t('workspace.assetOpen')}
          >
            <ArrowSquareOut className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="rounded p-1 text-muted transition-colors duration-150 hover:text-accent"
            onClick={(event) => { event.stopPropagation(); onReveal() }}
            title={t('workspace.assetReveal')}
            aria-label={t('workspace.assetReveal')}
          >
            <FolderOpen className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="rounded p-1 text-muted transition-colors duration-150 hover:text-error"
            onClick={(event) => { event.stopPropagation(); onDelete() }}
            title={t('workspace.assetDelete')}
            aria-label={t('workspace.assetDelete')}
          >
            <Trash className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div
        data-card-scroll
        className="workspace-card-scroll min-h-0 flex-1 overflow-auto overscroll-contain rounded-lg bg-surface/60 text-xs"
        onWheel={(event) => event.stopPropagation()}
      >
        {asset.fileMissing ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-error">
            <WarningCircle className="h-8 w-8" />
            <span>{t('workspace.assetMissing')}</span>
          </div>
        ) : asset.previewKind === 'image' ? (
          <img className="h-full w-full object-contain" src={previewUrl} alt={asset.fileName} />
        ) : asset.previewKind === 'audio' ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-4 text-muted">
            <MusicNote className="h-10 w-10" />
            <audio className="w-full" src={previewUrl} controls preload="metadata" />
          </div>
        ) : asset.previewKind === 'video' ? (
          <video className="h-full w-full bg-black object-contain" src={previewUrl} controls preload="metadata" />
        ) : asset.previewKind === 'text' ? (
          previewError ? (
            <div className="flex h-full items-center justify-center p-4 text-center text-error">{previewError}</div>
          ) : !textPreview ? (
            <div className="flex h-full items-center justify-center text-muted">
              <CircleNotch className="h-5 w-5 animate-spin" />
            </div>
          ) : isMarkdown ? (
            <div className="markdown-body select-text p-3 text-xs text-foreground">
              <ReactMarkdown
                remarkPlugins={REMARK_PLUGINS}
                rehypePlugins={REHYPE_PLUGINS}
                components={createMarkdownComponents()}
              >
                {textContent}
              </ReactMarkdown>
              {textPreview.truncated && <p className="mt-2 text-muted">{t('workspace.assetPreviewTruncated')}</p>}
            </div>
          ) : (
            <pre className="select-text whitespace-pre-wrap break-words p-3 font-mono text-xs text-foreground">
              {textContent}
              {textPreview.truncated ? `\n\n${t('workspace.assetPreviewTruncated')}` : ''}
            </pre>
          )
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-muted">
            <PreviewIcon kind={asset.previewKind} />
            <span>{t('workspace.assetPreviewUnavailable')}</span>
          </div>
        )}
      </div>
    </div>
  )
}
