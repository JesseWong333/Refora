import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CaretDown,
  CheckCircle,
  Circle,
  ListChecks
} from '@phosphor-icons/react'
import type { AgentTraceStep } from '../../../shared/ipc-types'

type AgentTodoStatus = 'pending' | 'in_progress' | 'completed'

interface AgentTodoItem {
  content: string
  status: AgentTodoStatus
}

function parseTodoValue(value: string | null): AgentTodoItem[] | null {
  if (!value) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
    if (typeof parsed === 'string') parsed = JSON.parse(parsed)
  } catch {
    return null
  }
  const todos = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object'
      ? (parsed as { todos?: unknown }).todos
      : null
  if (!Array.isArray(todos)) return null
  const items = todos.flatMap((todo): AgentTodoItem[] => {
    if (!todo || typeof todo !== 'object') return []
    const content = (todo as { content?: unknown }).content
    const status = (todo as { status?: unknown }).status
    if (
      typeof content !== 'string' ||
      !content.trim() ||
      (status !== 'pending' && status !== 'in_progress' && status !== 'completed')
    ) {
      return []
    }
    return [{ content: content.trim(), status }]
  })
  return items.length > 0 ? items.slice(0, 100) : null
}

function todoItems(step: AgentTraceStep): AgentTodoItem[] | null {
  return parseTodoValue(step.input) ?? parseTodoValue(step.output)
}

function latestTodoStep(
  steps: AgentTraceStep[],
  activeRunId: string | null
): { step: AgentTraceStep; items: AgentTodoItem[] } | null {
  const candidates = steps
    .filter((step) =>
      step.kind === 'todo' &&
      (!activeRunId || step.runId === activeRunId)
    )
    .sort((left, right) => right.startedAt - left.startedAt || right.seq - left.seq)
  for (const step of candidates) {
    const items = todoItems(step)
    if (items) return { step, items }
  }
  return null
}

export default function AgentTodoList({
  steps,
  activeRunId
}: {
  steps: AgentTraceStep[]
  activeRunId: string | null
}) {
  const { t } = useTranslation()
  const current = useMemo(
    () => latestTodoStep(steps, activeRunId),
    [activeRunId, steps]
  )
  const completed = current?.items.filter((item) => item.status === 'completed').length ?? 0
  const allCompleted = !!current && completed === current.items.length
  const [open, setOpen] = useState(!allCompleted)
  const currentRunId = current?.step.runId ?? null
  const previousRunIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!currentRunId) return
    if (previousRunIdRef.current !== currentRunId) {
      previousRunIdRef.current = currentRunId
      setOpen(!allCompleted)
    } else if (allCompleted) {
      setOpen(false)
    }
  }, [allCompleted, currentRunId])

  if (!current) return null

  const toggleLabel = open
    ? t('workspace.chat.todoCollapse', 'Collapse plan')
    : t('workspace.chat.todoExpand', 'Expand plan')

  return (
    <section
      className="overflow-hidden rounded-xl border border-border bg-panel/95 shadow-lg backdrop-blur"
      aria-label={t('workspace.chat.todoTitle', 'Task plan')}
      data-testid="agent-todo-list"
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors duration-150 hover:bg-hover"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={toggleLabel}
        title={toggleLabel}
      >
        <ListChecks className="h-4 w-4 shrink-0 text-accent" />
        <span className="min-w-0 flex-1 text-xs font-semibold text-foreground">
          {t('workspace.chat.todoTitle', 'Task plan')}
        </span>
        <span className="rounded-full bg-panel-2 px-1.5 py-0.5 text-caption tabular-nums text-muted">
          {completed}/{current.items.length}
        </span>
        <CaretDown
          className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform ${open ? '' : '-rotate-90'}`}
        />
      </button>
      {open && (
        <ol className="space-y-1 border-t border-border/70 px-3 py-2">
          {current.items.map((item, index) => {
            const done = item.status === 'completed'
            const ItemIcon = done ? CheckCircle : Circle
            return (
              <li
                key={`${index}-${item.content}`}
                className="flex items-start gap-2 text-xs leading-5"
                data-todo-status={item.status}
              >
                <ItemIcon
                  className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                    done
                      ? 'text-muted'
                      : item.status === 'in_progress'
                        ? 'text-accent'
                        : 'text-muted'
                  }`}
                />
                <span className={done ? 'text-muted line-through' : 'text-foreground'}>
                  {item.content}
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
