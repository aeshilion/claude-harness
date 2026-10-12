# MCP servers

<table width="100%" border="1" cellpadding="10" cellspacing="0">
<tr>
<td align="left"><a href="configure-tools.md">← Back to Configure Tools</a></td>
<td align="center"></td>
<td align="right"><a href="mcp-toggles.md">→ Next: MCP switches</a></td>
</tr>
</table>

The MCP Servers section lists the servers in the global harness and in each repo. Each server shows its source, its address and its status. Use [MCP switches](mcp-toggles.md) to turn a server on or off.

| Section | Description |
| --- | --- |
| [Where the servers come from](#where-the-servers-come-from) | The five sources and the list they appear in |
| [Sort the list](#sort-the-list) | Sort by name, source or status |
| [Server details](#server-details) | The facts and config shown for a server |
| [Live tools](#live-tools) | Tools read from servers reachable over HTTP |
| [Add a connector](#add-a-connector) | The button that opens claude.ai connectors |

## Where the servers come from

| Source | Read from | Shown in |
| --- | --- | --- |
| Your config | `mcpServers` in `~/.claude.json` | Global |
| Local to this repo | The repo's entry in `~/.claude.json` | That repo |
| Repo `.mcp.json` | `mcpServers` in the repo's `.mcp.json` | That repo |
| claude.ai connector | `claude mcp list`, for names that start with `claude.ai ` | Global |
| Plugin | `claude mcp list`, for names that start with `plugin:` | Global |

The global list also includes servers that `claude mcp list` reports but that are not in `~/.claude.json`. Their source follows the name: a `claude.ai ` prefix means connector, a `plugin:` prefix means plugin, and any other name counts as your config.

The status comes from `claude mcp list`. Claude Harness runs that command when it starts and when you click **Refresh**.

## Sort the list

The sort control appears in the MCP Servers header when the section has more than one server. Claude Harness remembers your choice.

| Option | Order |
| --- | --- |
| Sort: name | Alphabetical. The `claude.ai ` prefix and the `plugin:` prefix are not counted. |
| Sort: source | Your config, Local to this repo, Repo `.mcp.json`, claude.ai connector, then Plugin. Each group is sorted by name. |
| Sort: status | Connected first, then servers that need sign-in, then other statuses, then servers that are not configured, then servers that are off. Each group is sorted by name. |

## Server details

Click a server to open its detail view. It shows:

- Its source, its plugin when it comes from one, its name in Claude, its address and its status.
- The plugin's description, for plugin servers.
- The switch for the server. See [MCP switches](mcp-toggles.md).
- A **Config** excerpt of the server's entry, for servers defined in a config file.

## Live tools

For a server with an `http://` or `https://` address, the detail view connects to the address, reads the server name and version, and lists its tools with their descriptions. Headers from the server's config entry are sent with these requests. Opening the detail view therefore makes a request to that address.

| Message | Meaning |
| --- | --- |
| Asking the server for its tools... | The request is running |
| The server did not answer within 10 seconds. | The address did not answer in time |
| Needs sign-in, so only Claude can read its tools. | The server answered with 401 or 403 |
| Runs as a local command, so its tools are known only once Claude starts it. | The server is a local command. Claude Harness does not start it. |

## Add a connector

The global MCP Servers header has a link icon with the tooltip **Add a connector on claude.ai**. Click it to open the connectors page on claude.ai in your browser.

---

<table width="100%" border="1" cellpadding="10" cellspacing="0">
<tr>
<td align="left"><a href="configure-tools.md">← Back to Configure Tools</a></td>
<td align="center"><a href="#mcp-servers">↑ Back to top</a></td>
<td align="right"><a href="mcp-toggles.md">→ Next: MCP switches</a></td>
</tr>
</table>
