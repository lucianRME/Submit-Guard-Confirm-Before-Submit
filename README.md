# Submit Guard — Confirm Before Submit

Submit Guard is a Manifest V3 Chrome extension that helps prevent accidental form submissions by
showing a confirmation dialog before submit on sites the user explicitly enables.

## Current Scope

- Off by default, enabled per site from the popup
- Standard guard for native form submits
- Advanced Click Guard for submit-like JS clicks, off by default per site
- Per-site mode:
  - `always_confirm`
  - `risky_phrases_only`
- Global risky phrase list managed from the options page
- Local-only counters for confirmation dialogs shown
- “Don’t ask again for this site” directly from the modal
- No backend, accounts, analytics, or broad host permissions
- Minimal shipped MV3 permissions: `storage`, `scripting`, `activeTab`

## Load Unpacked

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `extension/` directory

## Automated Testing

1. Run `npm install`
2. Run `npx playwright install chromium`
3. Run `npm test`

`npm run test:a11y` runs the modal accessibility check directly.

## Notes

- Protection is enabled by hostname, not globally.
- The content script is injected only after the user enables the current site.
- Standard mode targets native form submits.
- Advanced Click Guard targets submit-like clicks used by JS-driven apps and may not work on every
  app or workflow.
- If the extension cannot show its confirmation UI, it fails open and does not intentionally block
  submission.
- The committed production manifest does not add host permissions.
- The Playwright harness loads a temporary localhost-only extension copy for CI reliability while
  keeping the shipped manifest minimal.
