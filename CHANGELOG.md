# Changelog

All notable changes to Claude Harness are listed here, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions with no version change in the package.json history (0.1.3, 0.1.5 to 0.1.18, 0.1.20 to 0.1.24, 0.1.27, 0.2.1 and 0.2.3 to 0.2.11) have no entry.

## [0.2.12] - 2026-10-21

### Added

- Delegation map has two modes above the diagram, Sum and Full timeline. Sum adds up the agents by type under whoever started them, and a click on a type drills down to its runs. Full timeline reads your prompts from top to bottom, with each delegation branching into the agents it started. Each mode button has a hover tip. See [Sessions](docs/sessions.md#delegation-views).
- Every row of the Delegation map shows the model, run time, tools and messages in the same columns. A type row shows its run count in the model column, with the summed run time, tools and messages of its runs.
- Repositories in the main window sidebar sort by last used, the default, or A-Z, with two buttons in the section header. Repos open in this window come first. See [Main window](docs/main-window.md#sidebar).
- Agents of enabled plugins appear in the global Agents list as read-only copies. See [Plugins](docs/plugins.md).

### Changed

- Lane colors on the session page: a type without its own color takes a palette hue that no named type uses, while one is left. Types that share a hue get a lighter and a deeper shade. See [Sessions](docs/sessions.md#delegation-views).
- The Fleet overview button in the activity bar uses the dashboard icon and sits before Open Claude. See [Fleet overview](docs/fleet-overview.md).
- The Concurrency view draws one bar per agent run, in its agent type's color. See [Sessions](docs/sessions.md#delegation-views).
- The Scatter view sizes each dot by the agent's cost instead of its tool uses. The costliest agent is drawn first, so the smaller dots stay on top. See [Sessions](docs/sessions.md#delegation-views).

## [0.2.2] - 2026-10-20

### Added

- Decisions view on the session page has two modes, Sum and Full timeline, each with a hover tip. Sum lists your prompts summed up: what the main thread did, which agent or team it launched and how it ended. Full timeline lists every prompt in order, with the agent or team each one launched. See [Sessions](docs/sessions.md#decisions).
- Decisions nodes drill down. Click a node with children to open or fold it. Sum opens three levels by default, and Full timeline opens every level.

## [0.2.0] - 2026-10-20

### Added

- Align CLAUDE.md, for a harness standard provider that declares an align prompt. It runs the bulk-edit guard for the repo, then opens a terminal in the repo that runs the prompt.
- Sessions under each repo in the activity bar: every Claude Code session that ran in the repo, newest first, with its first prompt, date, duration, agent count and whether it is running now. Headless `claude -p` runs started from a session's scratchpad folder appear under that session.
- Sessions section on each repo page: the 10 newest sessions, with Show all.
- Session page with a delegation timeline. The main thread lane marks your prompts and when results came back. Each subagent is a bar from start to end, coloured by agent type, with a line from the thread that launched it. Agents launched together are marked ×N. Messages, stops and failures show on the bar. Headless runs are dashed bars. Long idle stretches are shortened to a shaded band. Clicking a lane shows the agent's brief, report, tools, turns and tokens.
- Session page tiles count prompts, agents, peak parallel agents, main-thread tool calls and output tokens.
- Session page findings list failed launches, agents that never reported back, general-purpose agents, messages sent after an agent reported, repeated launches and the main thread's own file edits.
- Open Session command, used by the session rows in the tree.
- Sessions page with one search box. Suggestions show on focus and narrow as you type: Running now, Started today, With agents, With headless runs, Agent: type, Branch: name, and matching sessions. A chosen filter becomes a chip. Backspace on an empty box removes the last chip, and Esc clears the text and all chips. Matches are highlighted in the results. See [Sessions](docs/sessions.md#sessions-page).
- Sessions node in the main window sidebar, above Memory, with its count for an open repo. The chevron expands the 10 newest sessions, with Show all.
- Cost row on the session page, estimated at Anthropic API list prices, with bars for who spent it and what it was spent on. Four KPIs: Agents, Peak parallel, Delegated and Cache hits. See [Sessions](docs/sessions.md#session-page).
- Six delegation views on the session page behind one toggle bar: Timeline, Delegation map, Decisions, Concurrency, Token flow and Scatter. Each toggle has a short hover, and each view has a legend. See [Sessions](docs/sessions.md#delegation-views).
- Hover cards for agent lanes and the main thread lane on the session page, with the agent's type, status, run time, tokens, prompt and report.
- Hover card on a repo row in the main window sidebar, with its path, check status, harness counts, session and agent totals, and the first prompt of its latest session. See [Sessions](docs/sessions.md#hover-cards).

### Changed

- Provider features appear only when a harness standard provider plugin is installed. Without one, the harness standard check, its badges, the restated-rule and boilerplate lenses, the Layout, Standard, Em dashes and Review columns, Fix Settings and Hooks, Scaffold Repo Harness and the owner agent check stay hidden.
- Init Product Repo is renamed Scaffold Repo Harness. Check Harness Standard is renamed Check Harness.
- The Fleet overview's Restated column is now Review, and it comes from the provider.
- Retire is offered in every repo, with its backup and confirmation. A harness standard provider can mark repos that keep their copies.
- Repo rows in the activity bar expand to list their sessions.
- Marketplace health shows the marketplace's source type (GitHub, git, directory, file, URL) as an icon next to Source.
- Lane colors on the session page come from the agent definition's own color field, or from the color a teammate was given. Other agents use a palette.
- Repo rows in the activity bar keep their badges and counts in one column.

### Fixed

- A directory marketplace source of a provider is preferred over an older installed copy.

## [0.1.30] - 2026-10-20

### Added

- Harness standard check for each repo, when a harness standard provider is installed. FAIL and REVIEW lines show in the Problems panel on the file and line they concern.
- Repositories node in the activity bar, with a check badge for each repo when a provider is installed. See [Repositories](docs/repositories.md#activity-bar-node).
- CodeLens and quick fixes on `CLAUDE.md` and `.claude/rules/*.md` for dead pointers. With a provider, they also cover restated house rules and boilerplate headings. See [CLAUDE.md lenses](docs/claude-md-lenses.md).
- Effective harness section on each repo page, listing the memory, rules, plugins and hooks that a session loads. See [Effective harness](docs/effective-harness.md).
- Duplicate finder covers hook scripts, and marks a copy as nearly identical when only whitespace or version lines differ. See [Duplicates](docs/duplicates.md).
- Retire Copy and Retire Clean Copies back up a repo copy that matches a global or plugin copy, then delete it. See [Duplicates](docs/duplicates.md#retire-a-copy).
- Fleet overview: one table of every repo. See [Fleet overview](docs/fleet-overview.md).
- Fix Settings and Hooks previews the settings and hook fixes of a repo, shows diffs, and applies after a confirmation, when a provider is installed.
- Init Product Repo form with a preview, when a provider is installed. It creates only missing files.
- Rules editor shows the files each rule path matches, and checks the owner agent on disk when a provider is installed. See [Rules editor](docs/rules-editor.md).
- Marketplace health page, and Rename Marketplace for directory marketplaces. See [Marketplace health](docs/marketplace-health.md).
- Bulk-edit guard: a pick list before a bulk change, such as Retire Clean Copies and Rename Marketplace. It unticks repos with uncommitted harness files, a busy Claude session or stale worktree copies. See [Bulk-edit guard](docs/bulk-edits.md).
- Hook Scripts kind, for the files in the `hooks` folder. There are now twelve kinds. See [Harness kinds](docs/harness-kinds.md).
- Commands: Fleet Overview, Marketplace Health, Retire Clean Copies, Rename Marketplace, Retire Copy, Open Repo, Remove Line and Repoint, and, with a provider, the harness standard check, fixing settings and hooks and scaffolding a repo. See [Commands](docs/commands.md).

### Changed

- The main window sidebar header has two new buttons: Fleet overview and Marketplace health. See [Main window](docs/main-window.md#sidebar).
- Repo pages show the Effective harness section. With a provider, they also show the Harness standard section and buttons to check, fix settings and scaffold a repo.
- Copy labels read identical, nearly identical or differs.

## [0.1.29] - 2026-10-13

### Added

- Compare with Copy command opens the diff editor for an item and its copy in another scope.
- The frontmatter version shows next to the name.

### Changed

- Same-name assets across scopes are marked identical or differs. The check uses SHA-256 and ignores line ending differences.

## [0.1.28] - 2026-10-13

### Added

- Search box on the overview page.
- Animated demo of the main window in the README.

### Changed

- The README shows the demo in place of the footer logo.

## [0.1.26] - 2026-10-12

### Changed

- Version bump. The commit has no other change.

## [0.1.25] - 2026-10-12

### Changed

- Documentation for MCP servers and plugins is updated.

## [0.1.19] - 2026-10-12

### Changed

- The repo adopts conventional commit messages. The commit has no change to the extension.

## [0.1.4] - 2026-10-12

### Changed

- The Claude orange mark shows on the panel tab, the sidebar head and the overview header.
- The status bar entry reads Claude Harness.
- The `.time` ledger is left out of the package.

## [0.1.2] - 2026-10-12

### Fixed

- Workspace folders are listed even when they live under the temp folder.
- The editor header title stays on one line.

## [0.1.1] - 2026-10-12

### Added

- Repo harnesses in the main window, below the global harness.
- Create, rename, duplicate and plugin toggle work per scope.

### Changed

- Sections are collapsed by default.

## [0.1.0] - 2026-10-12

### Added

- First release: a VS Code extension to visualize and edit the global Claude Code harness and the repo harnesses below it. It has an activity bar tree and an editor panel.
