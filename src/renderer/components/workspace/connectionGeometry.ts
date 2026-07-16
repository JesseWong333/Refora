import type { WorkspaceConnectionAnchor } from '../../../shared/ipc-types'

export interface ConnectionPoint {
  x: number
  y: number
}

export interface ConnectionCardBounds extends ConnectionPoint {
  width: number
  height: number
}

export interface ConnectionCurve {
  path: string
  midpoint: ConnectionPoint
}

const DIRECTIONS: Record<WorkspaceConnectionAnchor, ConnectionPoint> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 }
}

export function cardAnchorPoint(
  bounds: ConnectionCardBounds,
  anchor: WorkspaceConnectionAnchor
): ConnectionPoint {
  if (anchor === 'top') return { x: bounds.x + bounds.width / 2, y: bounds.y }
  if (anchor === 'right') return { x: bounds.x + bounds.width, y: bounds.y + bounds.height / 2 }
  if (anchor === 'bottom') return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height }
  return { x: bounds.x, y: bounds.y + bounds.height / 2 }
}

export function closestCardAnchor(
  point: ConnectionPoint,
  bounds: ConnectionCardBounds
): WorkspaceConnectionAnchor {
  const distances: Array<[WorkspaceConnectionAnchor, number]> = [
    ['top', Math.abs(point.y - bounds.y)],
    ['right', Math.abs(point.x - (bounds.x + bounds.width))],
    ['bottom', Math.abs(point.y - (bounds.y + bounds.height))],
    ['left', Math.abs(point.x - bounds.x)]
  ]
  distances.sort((a, b) => a[1] - b[1])
  return distances[0][0]
}

export function targetAnchorForPreview(
  source: ConnectionPoint,
  target: ConnectionPoint
): WorkspaceConnectionAnchor {
  const deltaX = target.x - source.x
  const deltaY = target.y - source.y
  if (Math.abs(deltaX) >= Math.abs(deltaY)) return deltaX >= 0 ? 'left' : 'right'
  return deltaY >= 0 ? 'top' : 'bottom'
}

export function connectionCurve(
  source: ConnectionPoint,
  target: ConnectionPoint,
  sourceAnchor: WorkspaceConnectionAnchor,
  targetAnchor: WorkspaceConnectionAnchor
): ConnectionCurve {
  const distance = Math.hypot(target.x - source.x, target.y - source.y)
  const handleLength = Math.max(56, Math.min(280, distance * 0.48))
  const sourceDirection = DIRECTIONS[sourceAnchor]
  const targetDirection = DIRECTIONS[targetAnchor]
  const control1 = {
    x: source.x + sourceDirection.x * handleLength,
    y: source.y + sourceDirection.y * handleLength
  }
  const control2 = {
    x: target.x + targetDirection.x * handleLength,
    y: target.y + targetDirection.y * handleLength
  }
  const midpoint = {
    x: (source.x + 3 * control1.x + 3 * control2.x + target.x) / 8,
    y: (source.y + 3 * control1.y + 3 * control2.y + target.y) / 8
  }
  return {
    path: `M ${source.x} ${source.y} C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${target.x} ${target.y}`,
    midpoint
  }
}
