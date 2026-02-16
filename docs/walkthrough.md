# AI Tab: UI Refinements & Core Logic Enhancements

This walkthrough documents the recent overhaul of the AI Chat Tree extension, focusing on UI cleanliness, robust auto-naming, and reliable tree behavior.

## 🎨 UI Cleanliness

We've decluttered the interface to focus on the conversation tree itself.

- **Action Buttons Removed**: The Rename, Snapshot, and Delete buttons have been removed from the node rows to maximize space for labels.
- **Enhanced Context Menu**: All actions are now consolidated into a clean, English-labeled right-click menu.
  - Grouped actions: Navigation (Switch/Duplicate), Content (View/Auto-Name), Management (Delete Node/Delete with Children).
  - Clearer safety: "Delete with Children" is highlighted in red with a ⚠️ icon to prevent accidental massive deletions.

## 🤖 Smart Auto-Naming

The auto-naming engine is now more intelligent and responsive.

- **Initial AI Naming**: New tracked tabs now get an AI-generated name immediately using page content, instead of simple text truncation.
- **Manual Auto-Name**: Clicking "Auto Name" in the context menu now triggers a **live capture** from the browser tab, ensuring the AI sees your absolute latest messages before renaming.
- **Multiple AI Providers**: Supports Google Gemini (Built-in) and OpenAI-compatible custom APIs with a fallback to local extraction.

## 📷 Snapshot Improvements

The snapshot system now provides a premium "Reader Mode" experience.

- **Visual Tab**: Aggressively strips site sidebars (especially Gemini's chat list), navigation, and ads.
- **Text Tab**: Replaced raw text dump with a formatted reader view featuring:
  - Proper paragraph spacing.
  - Automatic code block detection with syntax-ready styling.
  - Responsive dark/light mode typography.

## 🌲 Robust Tree Logic

Fixed core issues with how nodes are created and connected.

- **Independent Trees**: "Track Tab" now always creates a new independent root node, even if the tab was previously auto-detected as a branch.
- **Reliable Forking**: Child nodes are now only created automatically when a tab is **duplicated** (matching URL), preventing unrelated new tabs from cluttering your trees.
- **Duplicate Protection**: Improved race-condition handling during fast tab duplication.

---
*All changes have been committed and pushed to the main branch.*
