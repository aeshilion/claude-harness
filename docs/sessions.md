# Sessions

<table width="100%" border="1" cellpadding="10" cellspacing="0">
<tr>
<td align="left"><a href="repositories.md">← Back to Repositories</a></td>
<td align="center"></td>
<td align="right"><a href="../README.md#features">↑ Back to Features</a></td>
</tr>
</table>

Claude Harness lists the Claude Code sessions that ran in each repo. A session page shows what the run cost, which agents it started and how the work was delegated. Open a session from the activity bar, the main window or a repo page.

| Section | Description |
| --- | --- |
| [Sessions in the tree](#sessions-in-the-tree) | The session rows under each repo in the activity bar |
| [Sessions page](#sessions-page) | The search box, its suggestions, filters and chips |
| [Session page](#session-page) | The header, the cost, the four KPIs and the agent details |
| [Delegation views](#delegation-views) | The six views of how the work was delegated |
| [Hover cards](#hover-cards) | The cards for agents, the main thread and repos |

## Sessions in the tree

Each repo in the activity bar expands to its sessions, newest first. A session row shows its first prompt, its date, its duration, its agent count and whether it is running now. Headless `claude -p` runs started from a session's scratchpad folder appear under that session.

Click a session row to open its session page. The **Open Session** command runs from these rows. See [Commands](commands.md).

## Sessions page

An open repo in the main window shows a **Sessions** node first, above **Memory**, with its count. Click the label or the search icon to open the Sessions page. The chevron expands the 10 newest sessions inline, with **Show all**. A repo page has the same 10 newest sessions in its own **Sessions** section. See [Main window](main-window.md#sidebar) and [Repositories](repositories.md#repository-page).

The Sessions page has one search box. Suggestions appear when you focus it, and they narrow as you type:

| Suggestion | Narrows to |
| --- | --- |
| Running now | Sessions that are running |
| Started today | Sessions that started today |
| With agents | Sessions that started at least one agent |
| With headless runs | Sessions that have headless `claude -p` runs |
| `Agent: <type>` | Sessions with an agent of that type |
| `Branch: <name>` | Sessions on that branch |
| Matching sessions | Sessions whose text matches what you typed. Choose one to open it. |

A chosen filter becomes a chip. Press Backspace in an empty box to remove the last chip. Press Esc to clear the text and all chips. Matches are highlighted in the results.

![Sessions page with the search box and its suggestions](images/sessions-search.png)

## Session page

The header shows the repo, the start and end, the duration, the branch and the model. Below it, the cost row shows an estimated cost at Anthropic API list prices. A Claude subscription bills differently. Two bars split the cost by **Who spent it** (the main thread and each agent type) and by **Spent on** (cache reads, cache writes, output and input).

Four KPIs follow the cost row:

| KPI | Shows |
| --- | --- |
| Agents | The agent count, with the count of failed or without-report agents |
| Peak parallel | The most agents that ran at the same time |
| Delegated | The share of the cost that ran in agents |
| Cache hits | The share of input tokens read from cache |

![Session page with the cost row, the four KPIs and the Timeline view](images/session-overview.png)

Below the KPIs, the **Delegation** section shows how the work was split. Then come the agent details, the findings and, when there are any, the headless runs. Click a lane or a node in the delegation views to see that agent's brief, report, tools and tokens.

## Delegation views

The Delegation section has six views behind one toggle bar. Each toggle shows a short hover. A legend under the diagram explains its marks.

| View | Shows |
| --- | --- |
| Timeline | A lane per agent, next to your prompts. A red circle with a white x marks a stopped agent. |
| Delegation map | Who started which agent. Teams are boxed, and message counts show in the node. |
| Decisions | What happened after each prompt: delegated, worked itself, followed up an agent, or answered. The width of each line is the number of prompts. |
| Concurrency | The agents that ran at the same time, with the peak marked. |
| Token flow | The tokens from the session, through the main thread and each agent type, to the outcome. |
| Scatter | Each agent by run time and tokens. Dot size is the tool use count. Dashed lines are medians. Both scales are logarithmic. |

Lane colors come from the agent definition's own color field, or from the color a teammate was given. Other agents use a palette.

### Delegation map

The map shows who started each agent. Use it to follow a chain of agents back to the main thread.

![Delegation map view](images/session-map.png)

### Decisions

The Decisions view shows what the main thread did after each of your prompts.

![Decisions view](images/session-decisions.png)

### Token flow

The Token flow view traces the tokens from the session to the outcome.

![Token flow view](images/session-flow.png)

## Hover cards

Hover an agent lane to see its card. It shows the agent type and teammate name, the status, the description, the model, the run time, the tool uses, the tokens in and out, and the cache reads with a bar. It also shows 3 lines of the prompt and 6 lines of what it did, which is the agent's report. A fork lane adds a note on what a fork is.

The card on the **Main thread** lane shows the model, the run time, the prompt count, the tool uses, the file edits, the agents started, the tokens, the top tools and the estimated cost.

![Hover card on an agent lane](images/session-agent-hover.png)

Hovering a repo row in the main window sidebar shows a card with the repo path, its check status (with a harness standard provider), its harness item counts, its session and agent totals, and the first prompt of its latest session.

---

<table width="100%" border="1" cellpadding="10" cellspacing="0">
<tr>
<td align="left"><a href="repositories.md">← Back to Repositories</a></td>
<td align="center"><a href="#sessions">↑ Back to top</a></td>
<td align="right"><a href="../README.md#features">↑ Back to Features</a></td>
</tr>
</table>
