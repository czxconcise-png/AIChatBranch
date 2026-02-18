# AI Chat Branch (Screenshot Draft)

> Draft for preview.  
> This file uses real-product screenshot slots. Replace image files in `docs/images/` and then tune text.

## What It Is

`AI Chat Branch` is a universal tab branching tool.  
For AI chat sites, you can branch from the same conversation URL into multiple tabs, continue each path independently, and keep the parent-child structure visible.

## Why This Over Built-in Branch

Compared with built-in branch flows (for example in ChatGPT):

- Built-in branches usually move into another conversation entry (URL changes)
- History view is mostly linear, and parent-child structure is not directly visible
- `AI Chat Branch` shows a tree, so branch relationships are explicit and manageable

It is not tied to one AI platform; it can also manage non-AI tabs.

## Product Overview

![Sidepanel Overview](docs/images/01-overview-sidepanel.png)

## Core Workflow

### 1) Track Current Tab as Root

![Track Root](docs/images/02-track-root.png)

### 2) Duplicate Tab -> Auto Child Branch (Recommended)

![Duplicate Child Branch](docs/images/03-duplicate-child-branch.png)

### 3) Paste Same Conversation URL -> Auto Infer Position

![Paste URL Auto Infer](docs/images/04-paste-url-auto-infer.png)

Note: this path is still stable in most cases, but `Duplicate Tab` is the recommended flow.

### 4) Auto Naming by Latest Conversation Content

![Auto Naming Live](docs/images/05-auto-naming-live.png)

## Dynamic Demo (GIF)

Drag to reorder/re-parent nodes:

![Drag Reparent GIF](docs/images/08-drag-reparent.gif)

## Settings

![Settings](docs/images/07-settings-language-theme.png)

## Feature Summary

- Branching tree with visible parent-child relationships
- Snapshot-based context retention after tab close
- Auto naming from latest conversation updates
- Drag-and-drop tree restructuring
- Bilingual UI (`English` / `中文`)

## Asset Checklist

Put assets under `docs/images/`:

- `01-overview-sidepanel.png`
- `02-track-root.png`
- `03-duplicate-child-branch.png`
- `04-paste-url-auto-infer.png`
- `05-auto-naming-live.png`
- `07-settings-language-theme.png`
- `08-drag-reparent.gif`
