# Task 01 — Design Tokens for Floating Panel Layout

## Objective
Add CSS custom properties and Tailwind utility classes needed to support the LobeHub-style floating/inset panel effect across the app shell.

## Files to Modify
- `src/renderer/styles/index.css`
- `tailwind.config.ts`

## Specific Changes

### 1. Add CSS custom properties to `index.css`
In `:root` and `[data-theme='dark']` blocks, add:
- `--floating-inset`: the inset padding around the floating container (target: `8px`, matching LobeHub)
- `--floating-radius`: border-radius for the floating container (target: `12px`, matching LobeHub's macOS >= 25 value)
- `--floating-border-color`: subtle border color for the floating container outline
- `--floating-shadow`: soft shadow for the elevated container

Suggested values:
```css
--floating-inset: 8px;
--floating-radius: 12px;
--floating-border-color: var(--color-border);
--floating-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
```

In light theme, adjust shadow to be lighter:
```css
--floating-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
```

### 2. Add Tailwind utility classes in `tailwind.config.ts`
Extend the theme to add:
- `borderRadius`: add a `floating` key mapped to `var(--floating-radius)`
- Add custom utilities or use Tailwind's arbitrary values to reference `var(--floating-inset)` and `var(--floating-shadow)`

Also consider adding `boxShadow` extensions referencing the CSS vars:
```js
boxShadow: {
  'floating': 'var(--floating-shadow)',
}
```

### 3. Verify tokens are reactive to theme changes
Ensure `--floating-border-color` and `--floating-shadow` change appropriately between dark and light themes (defined in both `[data-theme='dark']` and `[data-theme='light']` blocks).

## Acceptance Criteria
- `--floating-inset`, `--floating-radius`, `--floating-border-color`, `--floating-shadow` exist in both dark and light themes in `index.css`
- Tailwind config maps them to utility classes (`rounded-floating`, `shadow-floating`)
- Running `npm run typecheck` and `npm run lint` passes
- Visual inspection: tokens do not break existing styling (no visual changes yet, this is token-only)

## Dependencies
- None (first task, no upstream dependencies)
