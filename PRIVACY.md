# Privacy Policy — Dify Helper

_Last updated: 2026-04-23_

Dify Helper ("the extension") is a browser extension that displays workspace, account, subscription, and application information for users of [cloud.dify.ai](https://cloud.dify.ai). This policy describes what data the extension reads, how it is used, and what is (and is not) transmitted.

## 1. Data the extension reads

When you visit `cloud.dify.ai` while signed in, the extension calls the following public Dify console API endpoints, reusing the session cookie that your browser already holds for that site:

- `GET  /console/api/setup` — presence check
- `GET  /console/api/account/profile` — your email, account ID, and display name
- `POST /console/api/workspaces/current` — the active workspace's ID, name, plan, and your role
- `GET  /console/api/features` — subscription plan, quotas (apps / members / vector storage / document uploads), and feature flags
- `GET  /console/api/apps?page=1&limit=1` — total app count
- `GET  /console/api/datasets?page=1&limit=1` — total knowledge-base count
- `GET  /console/api/workspaces/current/members` — total member count
- `GET  /console/api/apps/{id}` — (only when you are on `/app/{id}/...`) app name, mode, description, created_by
- `GET  /console/api/apps/{id}/workflows/draft` — workflow graph (nodes, edges)
- `GET  /console/api/apps/{id}/workflows/publish` — last-publish metadata

The extension performs **exactly the same requests** that the Dify web application performs on these pages. It does not add any new endpoints or capabilities beyond what the signed-in session already has.

## 2. Data storage

- The only value stored locally by the extension is a single flag under `localStorage` key `dify-helper-ui-state` — whether the floating panel is minimized or expanded. No personal data is written to storage.
- Nothing is written to `chrome.storage`, IndexedDB, cookies, or any other persistence mechanism.

## 3. Data transmission

- **All network requests go to `cloud.dify.ai` and only `cloud.dify.ai`.**
- **No data is sent to the extension's author, to any analytics service, to any third-party server, or to any "cloud" backend operated by the extension.**
- The extension does not include telemetry, tracking pixels, beacons, error-reporting SDKs, or ad networks.
- The extension does not load remote code.

## 4. Data processing

All data returned from the Dify API is read in your browser, rendered into the floating panel's DOM (inside a Shadow DOM for isolation), and discarded when the page is closed. No post-processing, aggregation, or profiling is performed.

## 5. Copy to clipboard

When you click the "Copy all" button, a Markdown summary of the visible panel is written to your operating system clipboard using the standard `navigator.clipboard.writeText` API. The content never leaves your device.

## 6. Permissions rationale

| Permission in manifest | Why it is needed |
| --- | --- |
| `host_permissions: https://cloud.dify.ai/*` | Required to run the content script on `cloud.dify.ai` and make authenticated API calls on your behalf, using the session cookie your browser already holds. |

That is the **entire** permission footprint. The extension declares no other permissions, no `tabs`, no `storage`, no `scripting`, no `<all_urls>`, no background service worker.

## 7. Children

The extension is not directed at children under the age of 13 and does not knowingly collect data from them.

## 8. Changes to this policy

If this policy changes, the updated version will be committed to the extension's public Git repository with an updated `Last updated` date at the top of this file.

## 9. Contact

For questions or concerns, open an issue at [https://github.com/MRZHUH/dify-helper-extension/issues](https://github.com/MRZHUH/dify-helper-extension/issues).
