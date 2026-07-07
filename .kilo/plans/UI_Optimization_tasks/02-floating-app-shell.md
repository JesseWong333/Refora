# Task 02 — Floating App Shell (LobeHub-Style Inset Container)

## Objective
Transform the flat, flush-to-edges layout in `App.tsx` into a floating/inset container pattern matching LobeHub's `DesktopLayoutContainer`. The main content area should appear as an elevated card with padding from viewport edges, rounded corners, border, and shadow.

## Files to Modify
- `src/renderer/App.tsx`

## Specific Changes

### 1. Restructure the root layout
Current structure:
```
<div class="flex h-screen w-screen flex-col">
  <TopBar />
  <div class="flex min-h-0 flex-1">
    <Sidebar /> | <DocumentList /> | <DetailPanel />
  </div>
  <ConfirmDialog />
</div>
```

New structure:
```
<div class="h-screen w-screen bg-background p-[var(--floating-inset)]">
  <div class="flex h-full flex-col rounded-floating border border-[var(--floating-border-color)] shadow-floating bg-panel overflow-hidden">
    <TopBar />
    <div class="flex min-h-0 flex-1">
      <Sidebar /> | <DocumentList /> | <DetailPanel />
    </div>
  </div>
  <ConfirmDialog />
</div>
```

Key points:
- Outer wrapper gets `p-[8px]` to create the inset gap
- Inner wrapper is the "floating card" with `rounded-floating`, `border`, `shadow-floating`, `bg-panel`, `overflow-hidden`
- The inner wrapper fills the parent: `flex h-full flex-col`
- `ConfirmDialog` stays outside the floating container so its overlay covers the full viewport

### 2. Ensure scroll behavior is correct
- The inner container must not double-scroll
- `overflow-hidden` on the floating container prevents the rounded corners from being broken by inner scrollbars
- Inner content areas (Sidebar, DocumentList) keep their own `overflow-y-auto`

### 3. Background should show through the inset gap
- The outer wrapper must use `bg-background` (the page background color)
- This creates the visual "gap" between the floating card and the window edge

## Acceptance Criteria
- The main app content area is inset 8px from all window edges
- The content area has rounded corners (12px), a subtle border, and a soft shadow
- The background between the floating panel and window edges uses the page background color
- Dark and light themes both look correct with appropriate border/shadow contrast
- Scrolling within the sidebar and document list still works
- `ConfirmDialog` overlay still covers the full viewport
- `npm run typecheck && npm run lint` passes
- Visual smoke test with `npm run dev`

## Dependencies
- **Task 01** — Requires `--floating-inset`, `--floating-radius`, `--floating-border-color`, `--floating-shadow` tokens, and Tailwind `rounded-floating` / `shadow-floating` utilities
