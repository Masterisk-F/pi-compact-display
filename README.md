# pi-compact-display

An extension for the Pi Assistant that allows you to finely customize the terminal (TUI) output for various tools (e.g., bash, read, ls, edit) on a per-tool basis.

It helps keep your context and screen clean by limiting overly long tool outputs or hiding unnecessary tool calls, summarizing them instead.

![screenshot](https://raw.githubusercontent.com/Masterisk-F/pi-compact-display/master/screenshot1.png)

## Features

- **Per-Tool Configuration**: Set different display modes for each tool.
- **Summary Display**: Hide execution details and output only a summary like `⚡ read(1) ls(2)` at the top of the assistant's response.
- **Line Limit & Padding Removal**: Limit the number of output lines and automatically strip empty padding lines.
- **Grouped Tool Results**: With `grouping` enabled, consecutive `lines`-mode calls form compact aggregation lines (e.g. `⚡ bash ×3`), without crossing progress messages or other visible transcript content.
- **Suppress Thinking Indicator**: With `hideThinking` enabled, the "Thinking..." indicator (and full thinking blocks) shown for thinking models are hidden from the assistant messages.
- **Support for External Tools**: Override the display settings not only for Pi's built-in tools but also for any custom tools added by other extensions.
- **Expandable Details**: Fully supports Pi's native expand feature (e.g., pressing `Ctrl+O` in the TUI), overriding the limits to show the full output.

---

## Installation & Build

### Compatibility

Requires **Pi 1.0.1 or newer**. The public `pi.registerToolRenderer()` API was introduced in [Pi 1.0.1 (2026-10-03)](https://github.com/earendil-works/pi/releases/tag/v1.0.1), in [commit 1144973](https://github.com/earendil-works/pi/commit/11449730c8a733953ce1bcce70e066bccaa778a5). Older hosts fail with an explicit upgrade message; there is no legacy tool-registration fallback.

This extension registers **renderers only**, never replacement tool executors. It can therefore fold `bash` while another extension such as `pi-code-intel` owns the tool, preserving its RTK rewriting, schema, prompts, argument preparation, and execution behavior. `mode: "default"` delegates to the existing renderer via `next()`. Grouping still tracks TUI rows, so UI lifecycle compatibility should be tested when upgrading Pi.

### From npm (Recommended)

You can install the extension directly from npm:

```bash
pi install npm:pi-compact-display
```

### From Source (Local Development)

```bash
# Clone or navigate to the repository
cd pi-compact-display

# Install dependencies
npm install

# Build the TypeScript code
npm run build

# Install the extension using the Pi CLI
pi install .
```

---

## Configuration

Create a configuration file named `config.json` at the following location:

**File Path:**
`~/.pi/agent/extensions/pi-compact-display/config.json`

### Configuration Structure

The configuration is in JSON format, where the key is the "tool name" and the value is its "display settings (options)".

```json
{
  "tool_name": {
    "mode": "display_mode",
    "outputLines": number,
    "noPadding": true or false
  }
}
```

### Available Properties

| Property | Type | Description |
| --- | --- | --- |
| **`mode`** | `string` | The display mode for the tool. Must be `"count_only"`, `"lines"`, or `"default"`. (Required) |
| **`outputLines`** | `number` | The maximum number of lines to display. Only effective when `mode` is `"lines"`. (Optional) |
| **`noPadding`** | `boolean` | Whether to remove leading, trailing, and consecutive empty lines from the output. Set to `true` to omit empty lines. Only effective when `mode` is `"lines"`. When grouped, the overall padding of the group card follows the `noPadding` setting of the leader (the first tool in the group). (Optional) |
| **`grouping`** | `boolean` | Whether to include this tool in the group card when the global `grouping` setting is enabled. Set to `false` to exclude it from grouping and display it as a separate card. Default is `true`. (Optional) |

### Display Modes (`mode`)

1. **`"count_only"`**
   - **Behavior**: The tool execution and its output are completely hidden from the screen. Instead, the number of executions is summarized at the top of the assistant's message (e.g., `⚡ read(1)`).
   - **Use Case**: Best for tools like `read`, `ls`, `find`, or `grep`, where the LLM gathers information autonomously and humans do not need to read the raw output.

2. **`"lines"`**
   - **Behavior**: Displays the tool execution command and a truncated portion of its result. It limits the output to the specified `outputLines`.
   - **Use Case**: Ideal for tools like `bash`, `edit`, or `write`, where humans want to quickly check the executed command and whether it resulted in an error.

3. **`"default"`**
   - **Behavior**: Bypasses this extension's rendering overrides and falls back to Pi's default rendering logic (or logic defined by other extensions).
   - **Note**: Any tool not specified in the configuration file, or if `config.json` is missing entirely, will automatically default to `default`.

---

### Example Configuration

```json
{
  "grouping": true,
  "hideThinking": true,
  "user": {
    "noPadding": true
  },
  "skill": {
    "noPadding": true
  },
  "read": { "mode": "count_only" },
  "ls": { "mode": "count_only" },
  "find": { "mode": "count_only" },
  "grep": { "mode": "count_only" },
  
  "bash": { 
    "mode": "lines", 
    "outputLines": 3, 
    "noPadding": true 
  },
  "write": { 
    "mode": "lines", 
    "outputLines": 1, 
    "noPadding": true 
  },
  
  "mcp:tavily_tavily_search": { "mode": "count_only" },
  "mcp__tavily:tavily_search": { "mode": "lines", "outputLines": 5 },
  "mcp": { "mode": "lines", "outputLines": 10 },
  "default": { "mode": "count_only" },

  "my_custom_tool": {
    "mode": "count_only"
  }
}
```

*Note: You can specify any tool name, including custom tools added by other extensions like `my_custom_tool`.*

### Sub-tool and Action-Specific Configuration (Gateway Tools like MCP)

For "gateway tools" that call other tools or actions internally (such as the `mcp` tool), you can configure them specifically based on their arguments.

The configuration priority is evaluated in a cascading fallback:
**Specific Sub-tool Configuration > General Tool Configuration > `default` Key Configuration > System Default**.
This mechanism applies to all tools, not just MCP.

**How the sub-tool name is derived (the same rule for every tool):**
- If the argument `tool` is a string → `<tool_name>:<value>` (e.g. `mcp:tavily_search` when called with `{ "tool": "tavily_search" }`)
- If the argument `action` is a string → `<tool_name>:<value>` (e.g. `mcp:install`)
- **No tool-specific argument names are evaluated.** `mcp` has no special case: a call that only carries its own argument names (e.g. `{ "server": "..." }`, `{ "connect": "..." }`) falls back to the general `mcp` key.

**Server proxy names (namespace proxies):**
Depending on how your MCP servers are exposed, the tool name itself may already be namespaced. Those names are also usable as configuration keys:
- `mcp__<server_name>` (e.g. `mcp__tavily`, or `mcp__playwright_mcp_chrome` for a server named `playwright-mcp-chrome`)
- `mcp__<server_name>:<tool_name>` (e.g. `mcp__tavily:tavily_search`)

The `count_only` summary line displays exactly this name, so you can copy it straight into the configuration as a key.
In `lines` mode, the call line displays the invocation as `<effective_name> { <arguments> }` (e.g. `mcp__tavily:tavily_search { query: "Node.js 22" }`), matching the effective name used for configuration.

*Note: The same priority (`specific setting > "default" setting`) applies to built-in tools like `read` and `bash` as well.*

### User Prompt Padding Configuration

If you want to remove the vertical empty lines (vertical padding) that appear above and below the prompt messages you enter, you can configure them specifically using the `"user"` key. This configuration is not affected by other configurations like `"default"` and is only applied if explicitly defined.

**Configuration Example:**
```json
{
  "user": {
    "noPadding": true
  }
}
```

- **`noPadding`** (`boolean`): Set to `true` to remove the empty lines (padding) inserted above and below your prompt input, making the UI extremely compact.

### Skill Invocation Padding Configuration

If you want to remove the vertical empty lines (vertical padding) that appear above and below the `[skill]` display (rendered when you invoke a skill via `/skill:...` or a `<skill>` block), you can configure them specifically using the `"skill"` key. Like `"user"`, this configuration is not affected by other configurations such as `"default"` and is only applied if explicitly defined.

**Configuration Example:**
```json
{
  "skill": {
    "noPadding": true
  }
}
```

- **`noPadding`** (`boolean`): Set to `true` to remove the empty lines (padding) inserted above and below the `[skill]` block, making the UI extremely compact.

### Global Setting: Grouping Tool Results (`grouping`)

`lines`-mode tools normally render one tool card per call. With grouping enabled, **only consecutive tool calls are combined** into a card that shows the aggregation header. Visible assistant progress or thinking, warnings, custom messages, image-result tools, and standalone/default-mode tools end a group. This preserves the displayed sequence: progress → tool group → next progress → next tool group, instead of moving later calls into the first group.

**Configuration Example:**
```json
{
  "grouping": true,
  "bash": { "mode": "lines", "outputLines": 3, "grouping": false },
  "write": { "mode": "lines", "outputLines": 1 }
}
```

- **`grouping`** (`boolean`): Set to `true` to combine each consecutive run of `lines`-mode calls (regardless of tool name) into a compact card. The card shows only the count header such as `⚡ bash ×3 edit ×1` (even a single call is shown as `⚡ bash ×1`). Like `"user"`, this setting is not affected by other configurations such as `"default"` and is only applied if explicitly defined. You can exclude specific tools from the group by setting `"grouping": false` in their individual tool configuration.
- Command lines and outputs are hidden by default; press `Ctrl+O` (expand) to show every call's command line and full, untruncated output for all tools in the group.
- Groups never cross a user message or visible assistant text/thinking. Empty assistant placeholders, spacers, suppressed thinking (`hideThinking: true`), and invisible `count_only` tools may be skipped. Image results remain standalone. Streaming placeholders split a group as soon as they gain visible content. Grouping is presentation-only and follows transcript call order; it does not imply a sequential execution order for parallel tools.

### Global Setting: Suppress Thinking Indicator (`hideThinking`)

Thinking-capable models may emit `thinking` content blocks, which Pi renders as a `"Thinking..."` label (or as the full thinking text when thinking display is toggled on). When this setting is enabled, those thinking blocks are filtered out of the assistant message entirely, so no `"Thinking..."` indicator (and no thinking content) appears on screen.

**Configuration Example:**
```json
{
  "hideThinking": true
}
```

- **`hideThinking`** (`boolean`): Set to `true` to suppress the `"Thinking..."` indicator and all thinking content in assistant messages. Like `"user"` and `"grouping"`, this setting is not affected by other configurations such as `"default"` and is only applied if explicitly defined.

---

## Whole-turn process folding

Enable `"turnFolding": true` in `~/.pi/agent/extensions/pi-compact-display/config.json`, then restart Pi or run `/reload`. It is **disabled by default**; omit the key or set it to `false` to retain the existing per-tool display. This switch is independent of `grouping` and `hideThinking`.

```json
{
  "turnFolding": true,
  "grouping": true,
  "default": { "mode": "lines", "outputLines": 4, "noPadding": true }
}
```

In the TUI, each user message starts a separate process card. While the assistant works, only the latest progress preview and progress/tool counts are shown. Intermediate assistant text and tool rows remain stored but are folded. When finished, the final answer remains fully visible below the card. Failures/cancellation are labeled, tool failures are counted, and image-result rows remain visible. No extra model call is used to generate a summary.

Press **Ctrl+Alt+O** from the editor to **collapse all opened process cards**, including running tasks. Repeated presses never expand anything. To expand a single turn, click its process header in **fullscreen TUI mode**; clicking it again folds that turn. This works both during execution and after completion. There is no expand-all command for process cards, and native **Ctrl+O** does not change their open/closed state (it still controls other tool rows). Running turns are folded by default with their latest progress visible, but manual expansion stays open as new progress and tool results arrive. Final settlement automatically folds the process and reveals the full final reply. Single-turn expansion reveals intermediate text and tool rows using their **existing per-tool settings**: `count_only` stays hidden, `lines` keeps its line limit and grouping, and `default` keeps the owning renderer. Opening, closing or settling a process never changes a tool’s independent expansion state. Use the tool’s own expansion or native **Ctrl+O** to inspect its details separately. In regular terminal mode mouse interaction is owned by the terminal, so switch to fullscreen to open an individual process card.

This is a **display-only** feature: session messages, tool execution, model input, and HTML/RPC/JSON/print output are not rewritten by turn folding. It reconstructs cards when Pi replays a saved session. Set `turnFolding` to `false` and reload to restore the previous display.

Requires **Pi >=1.1.0** when enabled: the `aborted` field on `agent_settled` was introduced in Pi 1.1.0 (2026-10-07). Hosts older than that receive an upgrade/disable message before UI mutation; the existing per-tool renderer remains usable on Pi >=1.0.1 when the switch is off. Verified with **Pi 1.2.0**. Unlike `registerToolRenderer`, Pi has no public whole-turn renderer API: this opt-in feature uses the existing Container mirror and instance-level row rendering wrappers. Revalidate it when changing Pi versions.

## Usage & Shortcuts

After setting up the configuration, simply start the Pi assistant.

- **Context Cleanup**: Tools set to `count_only` will display summaries like `⚡ read(1)` on the screen. However, this summary text is automatically stripped from the conversation history (context) sent to the LLM behind the scenes, so it won't pollute the LLM's context window.
- **Full Output (Expanded)**: If the output is truncated in `lines` mode, you can use Pi's native expand shortcut (typically `Ctrl+O`) to bypass the line limits and view the full output.
