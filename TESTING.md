# Submit Guard Testing

## Automated Tests

1. Run `npm install`
2. Run `npx playwright install chromium`
3. Run `npm test`

Optional:

- Run `npm run test:a11y` to run the modal accessibility check directly.

## What The Playwright Suite Covers

- Loads Chromium with the unpacked extension
- Opens a local form fixture page
- Enables protection for the current site through the popup page
- Verifies the confirmation modal appears
- Verifies `Escape` closes the modal
- Verifies **Cancel** keeps the form unsubmitted
- Verifies **Submit** submits exactly once
- Verifies optional Click Guard intercepts a submit-like JS button
- Verifies risky phrase mode only prompts when phrases match
- Verifies “Don’t ask again for this site” disables protection locally
- Verifies popup toggle-off stays disabled after reload
- Runs `@axe-core/playwright` against the injected modal and fails on serious/critical issues

## Manual Smoke Test Checklist

1. Load the unpacked extension from `extension/` in `chrome://extensions`.
2. Visit a site with a simple form and enable protection from the popup.
3. Submit the form and confirm the modal appears and focus lands on it.
4. Press `Escape` and confirm the modal closes without submitting.
5. Submit again, click **Cancel**, and confirm the form still does not submit.
6. Submit again, click **Submit**, and confirm the form submits once.
7. Open the options page and confirm the local counter increases.
8. Enable **Advanced: guard submit-like clicks** for the site and verify a JS-only button still
   shows the modal before its handler runs.
9. Set the site mode to **Risky phrases only** and verify a harmless message submits without a prompt.
10. Add risky language such as `attached`, `urgent`, or `link below` and confirm the modal appears.
11. Use **Don’t ask again for this site** and confirm future submits on that host are not blocked.
12. Disable protection from the popup, reload, and confirm the modal no longer appears.
13. Repeat the same checks on at least 5 real sites/forms.

## Suggested Real-Site Smoke Coverage

- Google Forms
- Atlassian Jira comment or issue create form
- GitHub issue or discussion compose form
- LinkedIn message composer
- Notion or similar SaaS feedback/contact form
