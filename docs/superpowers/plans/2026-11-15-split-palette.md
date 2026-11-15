# Split view and command palette implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement task by task, with a final independent review.

**Goal:** Deliver tab-on-tab drag to native split view and a keyboard command palette.

**Architecture:** Extend the existing serialized controller, isolate split operations and palette model, add a popup extension page and worker launcher. Keep Chrome-specific effects behind the existing API adapter.

**Tech Stack:** JavaScript ESM, Chrome MV3, native HTML/CSS, node:test, Chrome CDP.

**Spec:** docs/superpowers/specs/2026-11-15-split-palette-design.md

## Global constraints

- Native split requires Chrome 155 API support; other features retain minimum 121.
- Pair only distinct unpinned, non-private tabs in the same window and group; never close pages to split.
- Use Cmd+Shift+K / Ctrl+Shift+K for palette, retain Alt/Option+Shift+K sidebar shortcut.
- Palette is a centered extension popup window, not a page injection or Cmd+T override.
- Only add search permission; render untrusted input as text and allow HTTP(S) navigation only.

## Review focus

- Stale/deleted tabs or cross-group drops must fail without moving unrelated tabs (task 1).
- Inactive split members remain visible and must not be auto-archived (task 1).
- Unsupported APIs must have a visible fallback and no fake split success (task 1).
- Palette must act in the originating window, not its own popup window (task 2).
- Unsafe URLs, empty queries, IME composition and keyboard bounds must behave predictably (tasks 2–3).

## Task 1: Native split controller and sidebar

Files: extension/split.js, core.js, controller.js, panel.js/html/css; tests/split.test.mjs; tests/helpers/fake-chrome.mjs; scripts/browser-smoke.mjs.

Interfaces: splitTabs(api, sourceId, targetId, windowId); unsplitTab(api, tabId, windowId); READ.capabilities.splitView; TABS_SPLIT and TAB_UNSPLIT controller messages.

- [x] Add failing tests: adjacency from either direction, same-pair idempotency, unsupported APIs, protected/cross-window/cross-group/missing tabs, unsplit without closure, split archive protection.
- [x] Implement operations and fake API semantics; verify npm test.
- [x] Add failing browser drag/unsplit checks, implement highlighted drop targets plus button alternative and support hint; verify browser smoke.

## Task 2: Palette model, actions and launcher

Files: extension/palette-model.js, palette-window.js, controller.js, background.js, manifest.json; tests/palette.test.mjs, controller.test.mjs, background.test.mjs.

Interfaces: inputIntent(query) -> {kind,url|text}; paletteItems(data, query, workspaceId) -> {id,title,detail,action}[]; openPalette(api, parentWindowId); OPEN_INPUT, NEW_TAB controller actions.

- [x] Add failing tests for URL/search classification, command filtering, originating-window actions, default-provider search, popup positioning/reuse; verify actual extension page launching in native smoke.
- [x] Implement model, controller effects, launcher and shortcut; run full node tests.

## Task 3: Palette UI and delivery

Files: extension/palette.html/js/css, panel.html/js; scripts/browser-smoke.mjs, scripts/native-smoke.mjs; README.md, package.json, docs/development-log.md.

- [x] Add failing DOM checks for Arrow/Enter/Escape, IME handling, text safety and failures staying visible; implement the palette and sidebar launcher.
- [x] Attempt real unpacked extension loading and split/unsplit through CDP in a temporary profile. Native Chrome 155 passed both reorder directions, split/unsplit and palette execution. Mac OS shortcuts and physical drag remain manual checks.
- [x] Run tests, static checks, browser checks; independent review and necessary fixes. Final results: 55 unit tests, 15 UI checks, native extension smoke; 21 JavaScript files parse successfully.
- [x] Prepare v0.2.0 docs and package for commit and delivery to origin.
