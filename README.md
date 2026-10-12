# Claude Harness

Claude Harness is a VS Code extension that shows and edits your Claude Code harness in `~/.claude`.

Dschango, you can now see and edit your global harness objects inside VS Code: memory (`CLAUDE.md`), rules, agents, skills, commands, output styles, workflows, hooks, MCP servers, plugins and settings. Below the global harness, the panel also lists the harness of each repository Claude Code knows and each open workspace folder that has a `.claude` folder or a `CLAUDE.md`.

## Install

The extension is not on the Marketplace, so sideload it from source.

Requirements: Node.js and VS Code 1.100 or newer.

```powershell
git clone https://github.com/alexander-kastil/claude-harness.git
cd claude-harness
npm install
npm run package
code --install-extension claude-harness-0.1.0.vsix --force
```

You can also install the file from the UI: open the Extensions view, choose the "..." menu, then "Install from VSIX...", and select `claude-harness-0.1.0.vsix`.

After installing, run "Developer: Reload Window" from the command palette.

To update, pull the latest changes, run `npm run package` again, and install the new VSIX with `--force`.

## Use

Click "Global Harness" in the status bar (bottom bar) or the Claude Harness icon in the activity bar. The status bar entry and the activity bar view both open the main window.

| Area | What you can do |
| --- | --- |
| Sidebar (main window) | Browse every kind by section, search, and create new items with the "+" button on creatable sections. |
| Detail view | Edit frontmatter fields and instructions, then save with Ctrl+S or the Save button. Revert discards changes. |
| Rename, duplicate | Available for agents, skills, commands, output styles, rules and workflows. |
| Delete | Moves the item to the trash after a confirmation. |
| Plugins | Toggle enabled or disabled from the tree or the detail view. |
| Files | Open a file in the editor or reveal it in File Explorer. Skill folders list their files. |

Hooks, MCP servers and settings are shown read-only, with their JSON excerpt in the detail view. Use "Open in editor" to change them.

The activity bar view is a tree with the same kinds. Right-click an item for open, reveal, rename, duplicate and delete.

The root folder is set with `claudeHarness.root`. The default is `~/.claude`.

## Develop

```powershell
npm test
npm run watch
```

`npm test` compiles the sources and runs the unit tests in `out/test/unit`. `npm run watch` recompiles on every change.

The code lives in [src/extension.ts](src/extension.ts) (commands and wiring), [src/harness.ts](src/harness.ts) (scanning and file writes), [src/panel.ts](src/panel.ts) (main window host), [src/tree.ts](src/tree.ts) (activity bar tree) and [media/panel.js](media/panel.js) (main window UI).
