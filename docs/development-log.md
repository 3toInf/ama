# Development log

Plan: docs/superpowers/plans/2026-11-15-ama.md

- User requested starting development in this empty workspace; execute inline without another approval round.
- Git: `git init -b main` failed with `.git/info/: Read-only file system`. No alternate Git directory or worktree is used to bypass the restriction.
- Baseline: no source files, no repository and no tests. Node 24.18.0, npm 11.16.0, Chrome 155.0.8059.84 available.
- Pre-flight: core state functions feed controller; controller message responses feed panel. UI and worker use the same schema version 1.
- Ruling: use Chrome groups for live workspaces, avoiding close/reopen on every switch; Arc's complete hidden-tab experience remains outside extension control.
- Task 1: pure model and validation implemented. First test run failed because implementation was absent; direct execution verified 13 named cases passing.
- Task 2: controller and worker implemented. First controller test run failed because implementation was absent; full suite now 26 named cases passing.
- Task 3: side panel, browser smoke harness, static checks and packaging added. Browser verification is blocked by the sandbox: local listen EPERM, then Chrome Crashpad setsockopt EPERM using a no-server pipe transport. No visual or live-extension pass is claimed.
- Ruling: use `node --test --test-isolation=none` to expose individual test results consistently in this runtime; the failure sentinel confirmed assertion failures return nonzero.
- Final review: independent reviewer inspected the extension, tests and packaging without modifying files. No critical findings; two important backup findings and three minor UI findings.
- Important finding 1 fixed: pretty JSON exports and unchecked accumulated storage could exceed the import limit. Export compact JSON and enforce the same 2 MB serialized backup limit before every persistent write. Added actual-byte round-trip and atomic capacity-rejection regressions.
- Important finding 2 fixed: importing a nonempty snapshot into another nonempty snapshot discarded incoming URLs. Merge by URL, retain existing titles and newest timestamp; reject combined snapshots above 500 pages atomically. Added merge and overflow regressions.
- Regression evidence: all four added tests failed for their intended assertions before fixes (26/30 passing), then all 30 passed after the changes.
- Deferred minor: the first shortcut-open can deliver FOCUS_SEARCH before the new panel registers its listener; the panel opens but search may need a click.
- Deferred minor: an already open panel does not immediately render a newly recorded background amaError; reopening displays it.
- Deferred minor: resource folder expansion resets when the list refreshes.
- Review boundaries: browser focus/event timing, visual layout, real extension loading and native tab-group behavior still require browser validation. The CDP pipe smoke harness was revised during review and was not included in the independent reviewer’s coverage.
- Delivery ruling: retain all source in the user-selected directory. Git initialization remains blocked by read-only metadata; no commit, merge or remote push is claimed. No Git branch exists to integrate or clean up.

## Permission update and verification — 2026-11-15

- The user changed the environment to unrestricted filesystem access. `git init -b main` now succeeds; the earlier Git limitation is resolved.
- Fresh verification: all 30 logic/controller tests pass, Manifest/assets and 10 JavaScript files pass static checks, and the Chrome DOM smoke test exits 0.
- Browser smoke coverage: workspace creation, saved link, moving a tab, snapshot, search, settings, malicious titles rendered as text, and 360px layout. Inspected `/tmp/ama-panel-smoke.png` visually. Chrome APIs still use the test adapter; real extension installation and native API behavior are not claimed as verified.
- No production code changes in this follow-up; documentation updated to reflect current evidence. The three minor UI findings and features outside the v0.1 scope remain open.

## UI fixes — v0.1.1 — 2026-11-15

- User requested fixing the three UI findings, and supplied `git@github.com:3toInf/ama.git` as the repository. Configured origin; authenticated remote branch lookup succeeded with no branches present.
- Reproduced all three reported behaviors before fixes: cold search focus failed, live error banner did not update, collapsed folders reopened. Additional checks caught cross-window focus and folder state loss on workspace switching.
- Shortcut fix: call sidePanel.open synchronously in the user gesture, send a window-targeted focus message after opening, and focus search when a fresh sidebar finishes loading. The options page does not consume sidebar focus requests.
- Error fix: render session storage error changes immediately. Independent review found no critical or important issues, but identified repeated identical errors not generating a change event. Reproduced this with a second failing worker test; each stored error now has a unique occurrence ID, and the UI accepts both new records and legacy strings.
- Folder fix: capture current DOM expansion states before rerendering, keyed by workspace ID and folder name. State survives refreshes and workspace switches while that sidebar remains open.
- Final verification: all 32 unit tests, all 6 browser UI regressions, existing browser smoke flows, Manifest/assets and 12 JavaScript syntax checks pass. Each new regression was observed failing before its corresponding production fix. Browser DOM is real Chrome; extension APIs still use the adapter, so native shortcut/side-panel integration remains a separate validation boundary.
- Scope: split-view drag-and-drop and a Cmd+T-style command palette remain unimplemented. Current shortcut remains Alt/Option+Shift+K. Package version incremented to 0.1.1.

## Native split view and command palette — v0.2.0 — 2026-11-15

- User requested tab-on-tab drag-to-split in the extension and an Arc-style command palette with Cmd+T or an alternative shortcut.
- Implemented native split/unsplit for distinct unpinned, non-private tabs in the same window/group, with adjacency arrangement, API capability detection, idempotent existing-pair handling and sidebar drag/drop plus button controls. Split members are protected from automatic archiving because inactive panes may still be visible. Split layout is not persisted in snapshots.
- Implemented a centered extension popup palette with Cmd+Shift+K (Mac) / Ctrl+Shift+K (others), retaining the existing sidebar shortcut. It supports tab/resource/workspace/archive selection, safe URL and bare-domain entry, default-provider searches, and new-tab/save-current/settings commands. It is an extension window, not an injected overlay; Cmd+T remains Chrome New Tab.
- Added only the search permission. Input classification rejects executable URLs and credentials while preserving ordinary search operators such as site:. Titles render as text; Enter is ignored during IME composition; failures leave the palette open.
- Workspace integration: regression tests exposed sidebar-local selection on workspace creation and stale sidebar selection after a palette switch. Selection now synchronizes through the existing session state.
- Test-first evidence: 11 split tests failed before operations existed; palette controller/model tests failed before implementation; DOM drag/palette tests failed before UI implementation; workspace-sync and search-operator regressions were observed failing and then fixed.
- Real Chrome test: loaded the unpacked extension in a temporary Chrome 155.0.8059.84 profile via official CDP Extensions.loadUnpacked. Native split IDs matched for the pair and reset to -1 after unsplit; palette shortcut registered, popup opened, Enter created a tab in the parent window and closed the popup. No simulated APIs in this native test. Screenshot inspected at /tmp/ama-palette-native.png.
- Native Mac keyboard accelerators and physical mouse dragging remain manual checks on the user's Chrome 157 arm64; browser DOM event tests and native controller integration provide separate evidence.
- Independent review identified one important dialog-context issue and two minor palette issues. All fixed in one follow-up pass: resource saves and delete confirmations bind to the dialog's original workspace; concurrent palette opens share one pending window; protected URL queries retain matching existing tabs without offering invalid navigation. Added failing regression checks before each fix.
- Native reordering was additionally verified with three same-group tabs, moving the first after the last and the last beside the first; both directions produced real matching split IDs and retained group validity.
- Final checks: 55 unit tests pass; 15 browser UI checks plus existing workflows pass; native Chrome extension smoke passes; Manifest/assets and 21 JavaScript files pass static checks. The reviewer's own native rerun was restricted by its environment; the primary agent's native results above are the executed evidence.

## Arc sidebar visual refresh — v0.3.0 — 2026-11-17

- User requested a closer match to Arc's product UI and recognizable website icons. Implemented on the existing `feat_style` branch. Visual references and mapping are recorded in `docs/superpowers/plans/2026-11-17-arc-ui.md`.
- Replaced the dashboard-like header and cards with a continuous space-colored sidebar: compact search, native pinned-tab icon tiles, workspace title, saved links/folders, divider, New Tab entry, single-line tab rows, raised active state and a bottom workspace dock. Archive/settings remain available at the bottom; snapshot/help controls are grouped under workspace tools. Palette and dialogs share the theme.
- Added the `favicon` permission and extension-local Chrome cache URLs. Sidebar, search, archive and palette show website icons. Unsupported/credential-bearing URLs and failed images use local SVG fallbacks. No external favicon service or persistent icon data. Palette entries preserve their actual page URLs independently of searchable descriptions.
- Browser verification exposed focus loss when background tab changes rebuilt a row. Added stable focus identities and restored focus in the visible view, revealing action groups before focusing an action. Three regression checks were observed failing before fixes: row focus, action focus, and duplicate keys in hidden workspace/search lists.
- Independent code and screenshot review found light-theme contrast issues and the two focus-restoration edge cases. Fixed all findings: stronger muted/accent colors across space hues, high-contrast secondary text/actions in active rows, and the focus handling above. Reviewed light/dark, narrow, focused-action and overflowing-dock screenshots.
- Verification: 58 unit tests, 18 browser UI regressions plus existing workflows, static checks across 24 JavaScript files, native split/palette smoke and the new native UI smoke passed. Native UI smoke inspects a known favicon pixel from a local website through Chrome's real cache, checks error fallback, pinned-tab focus, palette icons, theme switching, keyboard actions, 280/320/360px layouts and a 13-space dock.
- Native tests run in temporary Chrome 155.0.8059.84 profiles. The local-page test waits up to 30 seconds for first navigation and brings the panel target forward before screenshots. Mac-specific rendering and OS keyboard behavior still require the user's Chrome 157 installation.
- Preview images in `dist/previews/` contain local sample website names/icons and are excluded from Git. The packaged extension contains only `extension/` files. Existing stored workspaces, resources and settings remain compatible.
