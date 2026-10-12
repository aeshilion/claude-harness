# MCP switches

<table width="100%" border="1" cellpadding="10" cellspacing="0">
<tr>
<td align="left"><a href="mcp-servers.md">← Back to MCP servers</a></td>
<td align="center"></td>
<td align="right"><a href="plugins.md">→ Next: Plugins</a></td>
</tr>
</table>

Each MCP server has a switch in its detail view. The switch turns the server on or off for a folder. It changes only the lists in `~/.claude.json`, and it applies at once. There is no Save step.

## Switch a server in one repo

Servers in a repo's list are the ones defined in that repo's `.mcp.json` or local to that repo. A global server does not appear in a repo's list, so switch it in every folder instead.

1. Open the repo in the sidebar, expand its **MCP Servers** section, and click the server.
2. Turn the **Enabled in** switch on or off. The label names the repo.

## Switch a server in every folder

Open a global server. Its switch reads **Enabled in every folder**.

- Turning the switch off turns the server off in every project that `~/.claude.json` lists.
- Turning it on turns the server on in all of those projects.
- When the server is off in some projects, the detail view shows **Off in N of M folders**, where M is the number of projects in `~/.claude.json`. Switch it on to enable it everywhere.

Folders that `~/.claude.json` does not list are not changed.

## What the switches write

| Switch | Key in `~/.claude.json` | Effect |
| --- | --- | --- |
| Global server, in every folder | `disabledMcpServers` of each project | Adds the server name when off and removes it when on |
| Repo server from `~/.claude.json` | `disabledMcpServers` of that repo | Adds the server name when off and removes it when on |
| Repo server from `.mcp.json` | `disabledMcpjsonServers` of that repo | Adds the server name when off and removes it when on |
| Repo server from `.mcp.json`, turned on | `enabledMcpjsonServers` of that repo | Adds the server name |

Claude Harness does not edit `.mcp.json` or the server's own entry. If the repo has no entry in `~/.claude.json` yet, Claude Harness adds one for it.

---

<table width="100%" border="1" cellpadding="10" cellspacing="0">
<tr>
<td align="left"><a href="mcp-servers.md">← Back to MCP servers</a></td>
<td align="center"><a href="#mcp-switches">↑ Back to top</a></td>
<td align="right"><a href="plugins.md">→ Next: Plugins</a></td>
</tr>
</table>
