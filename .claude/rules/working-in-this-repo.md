---
paths:
  - "media/**"
  - "src/**"
---

# Working on the extension

- Load the global `vscode-extension` skill before the first edit of `media/` or `src/`. Bump and install is its `scripts/sideload.ps1 -Repo <repo>`; a look at a webview change is its `references/design-preview.md`; chart shapes the owner settled are in its `references/webview-charts.md`.
- Edit source with the Edit tool. Never edit through a Bash heredoc (`python - <<'EOF'`, `sed` with escapes): it rewrites `\n` and fails on CRLF files.
- Give Node Windows paths with forward slashes, from a script file, not `node -e` with escaped backslashes.
- The owner's history of corrections is in `tasks/lessons.md`; read the entries for the view you are about to change.
