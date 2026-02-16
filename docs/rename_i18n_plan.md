# AI Chat Branch Rename + UI i18n Plan

## Summary
- Rename user-facing branding from `AI Conversation Tree` to `AI Chat Branch`.
- Add bilingual UI (`en` and `zh`) with a dedicated Language item in settings.
- Default language rule:
  - Browser language starts with `zh` -> Chinese
  - Any other browser language -> English

## Scope
- Included:
  - Extension display name and visible UI copy.
  - Side panel, settings, context menu, alerts, and snapshot fallback text.
- Excluded:
  - Internal storage/database renaming or data migration.

## Storage Keys
- Added `uiLanguage` in `chrome.storage.local`.
- Value: `en` or `zh`.

## Implementation Notes
- `manifest.json`:
  - Update `name`, `description`, `action.default_title`.
- `sidepanel/sidepanel.html`:
  - Update visible product title.
  - Add a separate Language settings page from the main settings menu.
  - Normalize static text to single-language display.
- `sidepanel/sidepanel.js`:
  - Add i18n dictionary and `t()` helper.
  - Add default language resolver based on `chrome.i18n.getUILanguage()`.
  - Apply i18n to static and dynamic strings.
  - Persist and apply `uiLanguage` via Language settings.

## Verification Checklist
- First run with no `uiLanguage`:
  - `zh-*` browser language -> Chinese UI.
  - Any other browser language -> English UI.
- Language switch in settings:
  - Updates UI immediately.
  - Persists after panel reopen.
- Regression checks:
  - Track Tab, tree rendering, snapshot view, context menu, settings save, test connection.
