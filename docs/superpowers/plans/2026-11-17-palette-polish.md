# Arc command palette polish

The user asked to make the command palette closer to Arc and remove its framed appearance. Continue on `feat_style`.

Visual reference: [Arc command bar screenshot in the WebExtensions proposal](https://github.com/w3c/webextensions/issues/307). Use a single, softly tinted surface, a prominent unboxed query, compact results with website icons, and an action hint on the selected row. Remove the separate colored title bar, input underline, footer rule and permanently visible scrollbar.

- [x] Restyle `palette.html` and `palette.css`; simplify result descriptions and selected-row actions in `palette.js`, preserving full URLs as accessible descriptions/tooltips.
- [x] User selected the in-page overlay with a protected-page popup fallback.
- [x] Add `palette-overlay.js`: temporary `activeTab`/`scripting` injection, a modal host with an extension-origin iframe, readiness timeout and popup fallback. Only expose `palette.html` as a web-accessible resource. Use a per-open random token stored in session storage, bound to the originating tab/window and frame document; reject unauthorized iframe messages. No persistent all-site host permission.
- [x] Route palette iframe reads/actions through the authorized session; closing removes only the overlay, never the browser window. Preserve Escape, outside-click dismissal, focus restoration, IME handling and repeated invocation. Resize the floating card to its content with viewport limits.
- [x] Add unit regressions for authorization, cleanup, injection failure and popup fallback; native iframe checks for rendering, dismissal, command execution and forged-frame rejection. Retain existing popup checks for internal pages.
- [x] Verify existing keyboard/IME/error/favicon flows, inspect light/dark and narrow screenshots, review, document and package.

References: [Chrome windows API](https://developer.chrome.com/docs/extensions/reference/api/windows), [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab). Cmd+Shift+K remains the registered shortcut; Cmd+T is owned by Chrome.

Review follow-up: authenticate top-level fallback popups as well as iframes, measure intrinsic list height for shrink/expand, distinguish early cancellation from load failure, preserve original focus across repeated opens, and allow an owned popup to reload. Native overlay checks use a temporary localhost-only host grant because CDP toolbar actions do not grant activeTab; production permissions remain temporary.
