# Task 04 — i18n setup

**Phase:** 0 (Scaffold) · **Prerequisites:** 01 · **Master plan:** §2 (i18n), §8 (i18n Translation Keys)

## Goal
Set up react-i18next with full `zh`/`en` resource files and language detection (`settings.language` → system locale). Wrap all UI strings with `t()`. This task creates the i18n infrastructure + translation files; the Settings UI to switch language is Task 21.

## Spec (master plan §2 i18n + §8 keys)
- Libraries: `react-i18next` + `i18next`, JSON resource files `zh.json` / `en.json`.
- Language stored in `settings.language` (`'zh' | 'en'`).
- Detection priority: `settings.language` → system locale (`zh*` → `zh`, else `en`).
- **First run:** when `settings.language` is absent, detect from system locale, write detected value to settings, use it.
- Changing language switches UI immediately without restart (Task 21 wires the dropdown; here ensure `i18next.changeLanguage()` is callable and updates UI live).

## Steps
1. Create `src/renderer/i18n/index.ts`: init i18next with `zh.json` + `en.json` resources. Language resolution: read `settings.language` (via `window.api.settings.get('language')` if available, else system locale via `navigator.language`/`app.getLocale()`). Fall back to `en`.
2. Create `src/renderer/i18n/locales/zh.json` and `en.json` with **all** namespaces and keys from master plan §8 (sidebar, topbar, list, detail, settings, common, dialog). Use the exact key structure shown there.
3. Wrap all hardcoded UI strings in the placeholder components (from Task 02) with `useTranslation` / `t()`.
4. Expose a helper to switch language at runtime (`i18next.changeLanguage(lang)`) — to be called by the Settings dropdown in Task 21.

## Verification
- `npm run typecheck && npm run lint && npm run test` pass.
- Both `zh.json`/`en.json` exist with all namespaces from §8.
- `npm run dev`: calling `i18next.changeLanguage('zh')` (e.g. via devtools) updates all wrapped UI strings live.

## Phase 0 DoD (this task owns)
- [ ] Both `zh.json`/`en.json` exist with all namespaces from §8; switching language updates UI live.
