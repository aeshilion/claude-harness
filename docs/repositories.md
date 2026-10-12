# Repositories

<table width="100%" border="1" cellpadding="10" cellspacing="0">
<tr>
<td align="left"><a href="editing.md">← Back to Editing</a></td>
<td align="center"></td>
<td align="right"><a href="configure-tools.md">→ Next: Configure Tools</a></td>
</tr>
</table>

A repository appears under **Repositories** in the sidebar. Its harness is read from its own `.claude` folder and its `CLAUDE.md` files, with the same kinds as the global harness. Click a repo to open its page.

## Where repos come from

A folder counts as a repo when it has a `.claude` folder or a `CLAUDE.md` file. Claude Harness finds repos in three places:

| Source | Notes |
| --- | --- |
| Projects in `~/.claude.json` | The projects Claude Code knows about. Folders in the temp folder are skipped. Your home folder is never listed. |
| Open workspace folders | Each folder open in the VS Code window that has a `.claude` folder or a `CLAUDE.md` file. |
| Folders added with Add Repo | A repo folder, or a parent folder. A parent folder also checks its direct subfolders, except hidden folders, `node_modules`, `.git`, `__pycache__` and `.venv`. |

A subfolder that you create later under an added parent folder appears after you click **Refresh** or reload the window.

## Repository page

The repo page shows the repo name, its path and its asset count. It has these parts:

- One tile for each section, with its count. Click a tile to open the first item in that section.
- **Recently changed**, with the 12 most recently changed items in the repo.
- **New in** the repo name (plus icon) creates an item in this repo. See [Editing](editing.md#create-rename-duplicate-and-delete).
- The trash button removes this repo from the harness. Nothing is deleted on disk.

## Add a repo

1. Run **Claude Harness: Add Repo...** from the command palette, or click the add button on the **Repositories** header in the sidebar.
2. Select one or more folders. Pick a repo folder, or a parent folder that holds several repos.
3. Claude Harness shows how many repos it added. If none of the folders has a `.claude` folder or a `CLAUDE.md` file, it says so.

Added folders are saved in the `claudeHarness.repoFolders` setting. Adding a repo, or its parent folder, again also shows a repo that you removed before. See [Settings](settings.md).

## Remove a repo

Remove a repo in one of two ways:

- Click the trash button on the repo page.
- Run **Claude Harness: Remove Repo...** from the command palette. The picker has two groups:

| Group | What removing does |
| --- | --- |
| Added folders | Removes the folder from `claudeHarness.repoFolders`. Removing a parent folder also removes all of its repos. |
| Repositories | Hides the repo through `claudeHarness.removedRepos`. This works for repos from `~/.claude.json`, open workspace folders and parent folders. |

Claude Harness reports how many repos it removed. Nothing is deleted on disk.

---

<table width="100%" border="1" cellpadding="10" cellspacing="0">
<tr>
<td align="left"><a href="editing.md">← Back to Editing</a></td>
<td align="center"><a href="#repositories">↑ Back to top</a></td>
<td align="right"><a href="configure-tools.md">→ Next: Configure Tools</a></td>
</tr>
</table>
