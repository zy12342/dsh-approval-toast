# Security

## What this plugin touches

- **Registry (current user only):** registers the `dshnotify://` URL protocol and an `AppUserModelId` (`DSH.Notify`) under `HKCU\Software\Classes`. No administrator rights, no machine-wide changes.
- **Local HTTP:** a small server bound to `127.0.0.1` on a random port. It only serves `/decision`; every request must carry a one-time token and matching request id generated for one pending approval.
- **Processes:** starts Windows PowerShell 5.1 to display and remove toast notifications (`toast.ps1`), and when a notification button is clicked the registered protocol handler runs `decision.ps1`.
- **No** outbound network requests, no telemetry, no dependencies, no install scripts.

## Trust boundaries

- Notification contents come from the approval request (session title, tool name, reason). They are XML-escaped before being placed in the toast.
- A notification button points at `dshnotify://decision?...&token=...`; the token is random (32 hex chars), the request id is 16 hex chars, and the token is removed from memory on first use.
- `decision.ps1` treats its URI as untrusted input: it requires the `dshnotify` scheme, a port in 1-65535, a 16-hex request id, a 32-hex token and a decision word of `allow` / `deny`. Anything else exits before any request is made.
- The local endpoint answers only for a matching pending approval; unknown or reused tokens get HTTP 410.
- Token values only exist in the notification payload on the same user's desktop.

## Uninstall

Remove the plugin, then run `uninstall.ps1` from the plugin directory to delete the `dshnotify` protocol and the `DSH.Notify` AppUserModelId.

## Reporting a problem

Open an issue on the repository's issue tracker with the plugin version, Windows version and what happened. Do not include tokens, local paths or other personal data.
