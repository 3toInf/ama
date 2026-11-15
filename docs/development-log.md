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
