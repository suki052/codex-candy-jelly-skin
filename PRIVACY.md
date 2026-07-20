# Privacy and local data

The skin contains no analytics, advertising, telemetry, remote asset requests, account tokens, chat history, or personal contact data.

At runtime it uses a Chrome DevTools Protocol endpoint bound to `127.0.0.1` to inject CSS and UI helpers into the locally running Codex desktop window. Runtime state and logs are stored under the current user's local application-data directory and are not included in release archives.

Before publishing a modified build, run the release checklist and confirm that no backups, screenshots, shortcuts, logs, or personal assets were added.
