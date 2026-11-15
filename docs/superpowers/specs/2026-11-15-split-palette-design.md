# Native split view and command palette

User requests tab drag-to-split in the extension and an Arc-style palette with Cmd+T or another shortcut. Continue implementation in the existing native-JavaScript MV3 project; the user has already authorized development and delivery to origin.

## Behavior

- Drag a live tab row onto another AMA tab row to create a native two-tab split. Pair only unpinned, non-incognito tabs in the same window and group. Move the dragged tab beside its target before calling tabs.createSplit. Existing splits must be separated first; repeated requests for the same pair are harmless. Provide a button alternative and an Unsplit action. Detect API support at runtime; retain Chrome 121 compatibility for other features.
- Automatically archived tabs exclude all split members, because an inactive split member may still be visible. Manual archive remains explicit. Snapshots continue to store URLs, not split layouts.
- Add Cmd+Shift+K on Mac / Ctrl+Shift+K elsewhere to open a compact centered extension popup window. Preserve Alt/Option+Shift+K for the sidebar. Cmd+T remains Chrome's native New Tab shortcut. A popup works on protected Chrome pages without new website access permissions; it is not an injected in-page overlay.
- Palette supports current-window tabs, saved links, workspaces, opening HTTP(S) URLs or bare domains, searches with Chrome's configured search engine, and named commands. Arrow keys select, Enter runs, Escape dismisses. `>` filters commands. Render all titles as text. Close after successful execution and retain visible errors on failure.
- Add only the `search` permission, for the browser's configured provider. Preserve existing local data schema and backup behavior. No all-sites injection, new-tab override, arbitrary JavaScript URLs, or destructive command defaults.

## Architecture and checks

Controller owns serialized split/unsplit and navigation effects. A small split module owns eligibility and native API calls. Palette model derives searchable entries and input intent; its DOM renderer is separate. Worker opens/reuses a palette for the originating window. DOM tests exercise drag, keyboard selection and error behavior; native extension integration should be attempted through a temporary Chrome profile and official CDP extension loading.

Alternatives considered: injected overlay requires website access and cannot run on protected pages; a sidebar-only palette is narrower than the requested quick launcher. The extension popup window is the implementation choice for this version.
