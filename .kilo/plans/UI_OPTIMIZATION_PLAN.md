# UI Optimization Plan — macOS Native Visual Style

## Overview
Transform ScholarNote into a modern macOS-native app with light/dark themes, SF Symbols-style icons, refined layout, and proper typography hierarchy.

---

## Phase 1: Theme System (Light/Dark Mode)

### 1.1 Install lucide-react
- **File**: `package.json`
- **Action**: `npm install lucide-react`
- **Impact**: Adds icon library; tree-shaken per-icon imports keep bundle small

### 1.2 CSS: Add light-mode design tokens
- **File**: `src/renderer/styles/index.css`
- **Action**: Add `:root[data-theme="light"]` (and `[data-theme="dark"]` as explicit fallback) with macOS light-mode color palette:
  - background: `#f5f5f5` (macOS window background)
  - foreground: `#1d1d1f`
  - muted: `#6e6e73`
  - panel: `#ffffff`
  - panel-2: `#f0f0f0`
  - border: `#d2d2d7`
  - accent: `#007aff` (systemBlue)
  - accent-hover: `#0062cc`
  - warning: `#ff9f0a` (systemOrange)
  - error: `#ff3b30` (systemRed)
  - hover: `rgba(0,0,0,0.05)`
  - active: `rgba(0,0,0,0.08)`
- **Impact**: Core infrastructure for theme switching

### 1.3 CSS: Smooth theme transitions
- **File**: `src/renderer/styles/index.css`
- **Action**: Add `transition: background-color 0.2s ease, color 0.2s ease, border-color 0.2s ease` to `body` and key elements
- **Impact**: Smooth transitions when switching themes

### 1.4 Tailwind: Update border-radius defaults
- **File**: `tailwind.config.ts`
- **Action**: Extend `borderRadius` to use larger values (8-12px for cards)
- **Impact**: More rounded macOS appearance

### 1.5 Tailwind: Update shadow values
- **File**: `tailwind.config.ts`
- **Action**: Add macOS-style layered shadows (soft, spread)
- **Impact**: Replace hard borders with shadows

### 1.6 Theme hook & state management
- **File**: New `src/renderer/hooks/useTheme.ts`
- **Action**: Create hook that reads/writes `data-theme` attribute on `<html>`, persists to IPC settings, reads system preference on first load
- **Impact**: Centralized theme logic

### 1.7 App.tsx: Apply theme on startup
- **File**: `src/renderer/App.tsx`
- **Action**: Import and use `useTheme` hook to set initial theme from persisted/sys pref
- **Impact**: Theme applies at app startup

### 1.8 SettingsModal: Replace static "Dark" with toggle
- **File**: `src/renderer/components/SettingsModal.tsx`
- **Action**: Replace `themeDark` static display with a `<select>` or segmented control (Dark / Light / System)
- **Impact**: User can switch themes from settings
- **i18n**: Add `settings.themeLight`, `settings.themeSystem` keys

### 1.9 System preference detection
- **File**: `src/renderer/hooks/useTheme.ts`
- **Action**: Listen for `matchMedia('(prefers-color-scheme: dark)')` changes
- **Impact**: Auto-switch when system theme changes

---

## Phase 2: Icon System

### 2.1 TopBar: Replace Unicode with icons
- **File**: `src/renderer/components/TopBar.tsx`
- **Actions**:
  - Sidebar toggle: `PanelLeft` / `PanelRight` (or `ChevronLeft`/`ChevronRight`)
  - Add File: `FilePlus`
  - Add Folder: `FolderPlus`
  - Watch Folder: `FolderSync`
  - Settings: `Settings`
  - Export JSON: `FileJson`
  - Export BibTeX: `FileText`
  - Search: `Search` (inside search input or as prefix)
- **Impact**: Professional toolbar appearance

### 2.2 Sidebar: Replace emoji folder with icons
- **File**: `src/renderer/components/Sidebar.tsx`
- **Actions**:
  - Smart items: `Files`, `Clock`, `Plus`, `Star` per category
  - Folder groups: `Folder` instead of 📁 emoji
- **Impact**: Consistent icon style

### 2.3 DocumentList: Replace Unicode with icons
- **File**: `src/renderer/components/DocumentList.tsx`
- **Actions**:
  - Sort arrows: `ChevronUp` / `ChevronDown`
  - Star: `Star` (filled/outline)
  - Warning: `AlertTriangle`
  - Error: `Zap`
  - Checkmark: `Check`
  - PDF button: `FileText` or `ExternalLink`
- **Impact**: Consistent icons, better visual clarity

### 2.4 DetailPanel: Replace Unicode with icons
- **File**: `src/renderer/components/DetailPanel.tsx`
- **Actions**:
  - Apply remote: `ArrowLeftRight` or `RefreshCw`
  - Remove chip: `X`
  - Refresh: `RefreshCw`
  - Delete: `Trash2`
- **Impact**: Consistent icon style

### 2.5 FirstRunWizard: Replace emoji with icon
- **File**: `src/renderer/components/FirstRunWizard.tsx`
- **Action**: Replace 📚 emoji with `Library` or `BookOpen` icon
- **Impact**: Professional welcome screen

### 2.6 Modals: Add icons to buttons
- **File**: `ConfirmDialog.tsx`, `CategoryDialog.tsx`, `WatchFoldersSettings.tsx`
- **Actions**: Add icons to Create, Delete, Cancel, Add, Remove buttons
- **Impact**: Better button affordance

---

## Phase 3: Layout Optimization

### 3.1 TopBar: Unified toolbar style
- **File**: `src/renderer/components/TopBar.tsx`
- **Actions**:
  - Increase height to `h-10` (40px) or `h-11` (44px) — macOS standard
  - Use `bg-panel` with subtle bottom border, or seamless with content
  - Group related buttons visually
  - Add gap-1.5 between button groups
  - Brand text: larger, better positioned
- **Impact**: macOS unified toolbar feel

### 3.2 Sidebar: Better item spacing
- **File**: `src/renderer/components/Sidebar.tsx`
- **Actions**:
  - SidebarItem: `py-1.5` → `py-2`, `min-h-[36px]` for 44px touch target
  - Section headers: more spacing
  - Context menu: larger border-radius (`rounded-lg`), better padding
  - Collapse button styling
- **Impact**: Better touch targets, cleaner look

### 3.3 DocumentList: Row height & visual improvements
- **File**: `src/renderer/components/DocumentList.tsx`
- **Actions**:
  - ROW_HEIGHT: `28` → `36` (44px touch target not feasible for table, but 36px is a good middle ground)
  - Row hover/active states: use subtle backgrounds
  - Column header bar: `rounded-t-lg` or better style
  - Header label area: better padding
  - Skeleton: use theme-aware shimmer
- **Impact**: Better readability, modern table look

### 3.4 DetailPanel: Better padding & grouping
- **File**: `src/renderer/components/DetailPanel.tsx`
- **Actions**:
  - Panel padding: `px-4 py-3` → `px-5 py-4`
  - Field groups: add subtle separators or spacing
  - Buttons: larger touch targets
  - Category chips: better styling
- **Impact**: Cleaner detail panel

### 3.5 Modals: macOS-style dialogs
- **Files**: `ConfirmDialog.tsx`, `CategoryDialog.tsx`, `SettingsModal.tsx`, `WatchFoldersSettings.tsx`, `FirstRunWizard.tsx`
- **Actions**:
  - Border-radius: `rounded` (4px) → `rounded-xl` (12px)
  - Padding: `p-4` → `p-6`
  - Shadow: replace `shadow-lg` with layered shadow
  - Backdrop: use vibrancy-like effect (subtle blur)
  - Button sizing: larger, more padding
- **Impact**: Modern macOS dialog appearance

### 3.6 Toast: macOS-style notification
- **File**: `src/renderer/components/DetailPanel.tsx` (toast inline)
- **Actions**:
  - Position: bottom-right with slide-up animation
  - Style: larger border-radius, softer shadow, icon prefix
- **Impact**: Professional toast appearance

---

## Phase 4: Typography

### 4.1 Base font size & hierarchy
- **File**: `src/renderer/styles/index.css`
- **Actions**:
  - Base body font size: `13px` → `13px` (keep, macOS standard)
  - Define CSS custom properties for font sizes: `--text-xs`, `--text-sm`, `--text-base`, `--text-lg`, `--text-xl`
  - Line-height: set default `line-height: 1.5` on body
- **Impact**: Consistent typography scale

### 4.2 Component-level font adjustments
- **Files**: All component files
- **Actions**:
  - TopBar brand: `text-sm font-semibold` → `text-[15px] font-semibold`
  - Sidebar section headers: `text-[11px]` + `tracking-wide` — keep but ensure readability
  - DetailPanel labels: ensure sufficient contrast in light mode
  - List header: improve visual weight
- **Impact**: Better typography hierarchy

---

## Phase 5: Shadows

### 5.1 CSS custom shadow tokens
- **File**: `src/renderer/styles/index.css`
- **Actions**: Add shadow tokens for both themes:
  - `--shadow-sm`: subtle card elevation
  - `--shadow-md`: dialog/modal elevation
  - `--shadow-lg`: overlay elevation
- **Impact**: Replacing hard borders with layered shadows

### 5.2 Apply shadows to components
- **Files**: All modal, dropdown, and toasts
- **Actions**: Replace `shadow-lg` + `border-border` combos with shadow-only elevation
- **Impact**: Modern depth hierarchy

---

## Execution Order
1. Phase 1 (Theme) — foundation for all visual changes
2. Phase 2 (Icons) — parallelizable with Phase 3
3. Phase 3 (Layout) — main visual overhaul
4. Phase 4 (Typography) — refinements
5. Verification gate (`npm run typecheck && npm run lint && npm run test`)

Each completed item will be marked ✅; in-progress ⏳.
