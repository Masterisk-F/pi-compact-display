# pi-compact-display

An extension for the Pi Assistant that allows you to finely customize the terminal (TUI) output for various tools (e.g., bash, read, ls, edit) on a per-tool basis.

Keep the screen compact without dropping tool results from the model's input: limit output lines, hide routine calls behind counts, or fold an entire turn's intermediate process while keeping the final answer visible.

> **Source-branch features:** Renderer-only compatibility is proposed in [PR #9](https://github.com/Masterisk-F/pi-compact-display/pull/9); whole-turn folding and chronological grouping are proposed in [PR #10](https://github.com/Masterisk-F/pi-compact-display/pull/10). These changes are not yet released on npm. Use this source branch to try them; the npm installation below installs the published package.

![screenshot](https://raw.githubusercontent.com/Masterisk-F/pi-compact-display/master/screenshot1.png)

## Features

- **Whole-turn Process Folding (Opt-in)**: Fold intermediate progress and tool rows into one process card per user message. The latest progress remains visible while running; the final answer remains fully visible when finished.
- **Per-Tool Configuration**: Set different display modes for each tool.
- **Summary Display**: Hide routine tool text behind counts. With turn folding off, `count_only` calls add a summary such as `⚡ read(1) ls(2)` to the final response; with it on in the TUI, the process card provides the counts instead.
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

### From npm (Published Version)

You can install the extension directly from npm:

```bash
pi install npm:pi-compact-display
```

### From Source (Local Development)

```bash
# Preview PR #10 in a separate source checkout
git clone --branch feat/local-turn-folding https://github.com/lozybean/pi-compact-display.git
cd pi-compact-display

# Install dependencies
npm install

# Build the TypeScript code
npm run build

# Install the extension using the Pi CLI
pi install .
```

Load only **one copy** of this extension: do not keep both the npm package and a local checkout enabled. For source-code changes, run `npm run build` before restarting Pi or using `/reload`; for configuration-only changes, `/reload` is enough. The extension loads `dist/index.js`, not `src/index.ts`.

---

## Configuration

Create a configuration file named `config.json` at the following location:

**File Path:**
`~/.pi/agent/extensions/pi-compact-display/config.json`

### Configuration Structure

The same JSON object holds global switches (`turnFolding`, `turnPreviewRows`, `grouping`, `hideThinking`), special padding settings (`user`, `skill`), and per-tool settings. Tool keys can be built-in names, extension names, or gateway sub-tool names.

```json
{
  "tool_name": {
    "mode": "lines",
    "outputLines": 4,
    "noPadding": true
  }
}
```

### Global Settings

| Key | Default | Controls |
| --- | --- | --- |
| `turnFolding` | `false` | Outer process cards; TUI only. Requires Pi >=1.1.0. |
| `turnPreviewRows` | `3` | How many of the most recent rows (progress text and tool rows) a collapsed process card keeps visible. Only effective with `turnFolding`. |
| `grouping` | `false` | Inner aggregation of consecutive `lines` calls; independent of turn folding. |
| `hideThinking` | `false` | Hide thinking content and its indicator; does not remove it from model input. |
| `default` | `{ "mode": "default" }` | Fallback **tool configuration** for names without an explicit match. Does not set the global switches, `turnPreviewRows`, or `user`/`skill`. |

After any config change, restart Pi or use `/reload`. Keep the file valid JSON (no comments or trailing commas); a missing or unparsable file is treated as empty configuration.

### Per-Tool Properties

| Property | Type | Description |
| --- | --- | --- |
| **`mode`** | `string` | The display mode for the tool. Must be `"count_only"`, `"lines"`, or `"default"`. (Required) |
| **`outputLines`** | `number` | Maximum unexpanded result-text lines in `"lines"` mode; omitted means no line limit. Grouped calls initially show counts only, and expanding tool details bypasses this limit. (Optional) |
| **`noPadding`** | `boolean` | Whether to remove all blank result-text lines, including internal blank lines. Set to `true` to omit them. Only effective when `mode` is `"lines"`. When grouped, the overall padding of the group card follows the `noPadding` setting of the leader (the first tool in the group). (Optional) |
| **`grouping`** | `boolean` | Whether to include this tool in the group card when the global `grouping` setting is enabled. Set to `false` to exclude it from grouping and display it as a separate card. Default is `true`. (Optional) |

### Display Modes (`mode`)

1. **`"count_only"`**
   - **Behavior**: Hides the call title and result text, including error text. With turn folding off, counts are summarized in the final assistant response (e.g., `⚡ read(1)`); with it on in the TUI, counts appear on the process card instead. Image results remain handled by Pi's image renderer.
   - **Errors**: Failures mark the count summary or increment the process card's tool-failure count, but expanding a process or pressing `Ctrl+O` does not reveal `count_only` text. Use `lines` or `default` for tools whose diagnostics you need to inspect.
   - **Use Case**: Best for tools like `read`, `ls`, `find`, or `grep`, where the LLM gathers information autonomously and humans do not need to read the raw output.

2. **`"lines"`**
   - **Behavior**: Without grouping (globally disabled, or `grouping: false` for that tool), displays the call and up to `outputLines` result-text lines. With grouping enabled, shows a count header until the **tool group itself** is expanded; expanded details include full result text.
   - **Use Case**: Ideal for tools like `bash`, `edit`, or `write`, where humans want to quickly check the executed command and whether it resulted in an error.

3. **`"default"`**
   - **Behavior**: Bypasses this extension's rendering overrides and falls back to Pi's default rendering logic (or logic defined by other extensions).
   - **Note**: An unspecified tool inherits the `default` **configuration key**, if present. Without that key, or with no config file, it uses `mode: "default"`. This fallback applies to newly added extension tools too.

---

### Example Configuration

```json
{
  "turnFolding": false,
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

Set `turnFolding` to `true` in `~/.pi/agent/extensions/pi-compact-display/config.json`, then restart Pi or use `/reload`. It is **disabled by default**. It controls only the outer process card; `grouping` and `hideThinking` remain independent.

### Quick-start configuration

This example folds routine reads into counts, aggregates consecutive tool calls, keeps unlisted tools compact, and preserves an image tool's own renderer. Change tool names to match the extensions you actually use.

```json
{
  "turnFolding": true,
  "turnPreviewRows": 3,
  "grouping": true,
  "read": { "mode": "count_only" },
  "bash": { "mode": "lines", "outputLines": 4, "noPadding": true },
  "agent": { "mode": "lines", "outputLines": 8, "noPadding": true, "grouping": false },
  "codex_generate_image": { "mode": "default" },
  "default": { "mode": "lines", "outputLines": 4, "noPadding": true }
}
```

### Running, opened, and finished

- **Running:** Intermediate assistant text and tool rows are folded by default. The card shows progress/tool counts plus the **three most recent rows** (`turnPreviewRows`), rendered at their normal transcript positions: assistant progress text in full and wrapped to the terminal width, tool rows through their own renderer, so `grouping`, `count_only` and `outputLines` still decide how folded they look. It is not a model-generated summary.
- **Preview count:** Set `turnPreviewRows` to keep a different number of rows (for example `1` for the old latest-only behaviour, or `5`). Values that are not integers of at least 1 fall back to the default of `3`. Rows that render nothing, such as `count_only` calls or the non-leader members of a tool group, do not use up a slot; image results and the final answer always stay visible and never consume one either. Only the newest progress row carries the `当前：` label.
- **Manually opened:** Click that turn's header in **fullscreen TUI mode**. New progress and tool results do not close it. Click again to fold that turn.
- **Finished:** When the agent actually settles, the process automatically folds and the final response stays fully visible below it. Completion of a single tool or model response is not the auto-collapse boundary.
- **Errors and cancellation:** The card labels cancellation, response errors, or truncation and counts tool failures. Opening it still respects each tool's display mode; `count_only` error text stays hidden.
- **Images:** Image-result tool rows are not hidden by the process card and are excluded from aggregation. Image display still depends on Pi's image settings and terminal support.

The progress count measures intermediate assistant messages with non-empty text. The tool total counts all tool rows, including `count_only` calls; an inner group header counts only the calls belonging to that group.

### Outer process visibility ≠ inner tool expansion

Opening the process reveals its rows **at their original transcript positions**. It does not force tools open, reset their state, or change their configuration:

| Inner tool setting | After opening the outer process |
| --- | --- |
| `count_only` | Call/result text stays hidden. |
| `lines` + grouping | Consecutive calls retain folded count headers unless the tool group was independently expanded. |
| `lines` + `grouping: false` | Standalone call/result preview retains `outputLines` until that tool is expanded. |
| `default` | The tool's owning renderer remains in control. |

Opening, closing, settling, or disabling the outer process never changes a tool's independent expansion state. Use the tool's own expansion control or native **Ctrl+O** for tool details. Conversely, **Ctrl+O never opens process cards**; there is no expand-all process command.

With grouping enabled, opened processes preserve the visible sequence below. The current process header uses the Chinese labels shown here; the indents illustrate the layout, not literal output padding.

```text
▼ 执行过程 · 已完成 · 2 条进度 · 3 次工具调用
  Inspecting the current implementation…
  ⚡ bash ×2
  Applying the targeted fix…
  ⚡ edit ×1
Final answer (always visible)
```

A **folded** card (`▶`) instead shows the same header plus only the last `turnPreviewRows` rows, with the newest progress text labelled `当前：`. Earlier rows stay folded, and tool rows still follow their own display mode, so a grouped `lines` call contributes only its `⚡ bash ×N` header:

```text
▶ 执行过程 · 已完成 · 2 条进度 · 3 次工具调用
  ⚡ bash ×2
  Applying the targeted fix…
  当前：Verifying the change against the tests
Final answer (always visible)
```

### Disable and compatibility

Set `turnFolding` to `false` (or remove it) and use `/reload` to remove process cards and restore the existing per-tool display. Other options such as `grouping` stay in effect. Saved sessions reconstruct their process cards when replayed; no history is deleted.

Turn folding is **TUI-only and display-only**: it does not change session messages, tool execution, model input, or HTML/RPC/JSON/print output, and it makes no extra model calls. In regular terminal mode, mouse interaction belongs to the terminal; use fullscreen mode to open an individual process card.

Enabled turn folding requires **Pi >=1.1.0**, because `agent_settled.aborted` was introduced in Pi 1.1.0 (2026-10-07). Older hosts receive an upgrade/disable message before UI mutation. With the switch off, per-tool rendering requires only Pi >=1.0.1. Verified with **Pi 1.2.0**. Unlike `registerToolRenderer`, Pi has no public whole-turn renderer API: this feature uses the existing Container mirror and instance-level row-rendering wrappers. Revalidate it when changing Pi versions.

## Usage & Shortcuts

| Action | Effect |
| --- | --- |
| Click a process header in fullscreen TUI | Open/close only that process, including while running. Requires `turnFolding: true`. |
| **Ctrl+Alt+O** from the editor | Collapse all opened processes, including running ones. Repeated presses never expand them or reset inner tools. |
| Native **Ctrl+O** / tool expansion | Control tool details independently; never open the outer process. |
| `/reload` | Apply configuration changes. Build first if source code changed. |

Without TUI turn folding, `count_only` summaries such as `⚡ read(1)` are stripped from model-facing context. With TUI turn folding, counts are rendered directly in the process card instead of being prepended to the final response. Raw tool results remain available to the model in either case.

## Troubleshooting

- **No process card:** Confirm this source branch is installed and built, `turnFolding` is `true`, Pi is >=1.1.0, and the session is TUI. A turn with no intermediate progress or tools need not show a card. Reload after editing the config.
- **Clicking does nothing:** Process-header clicks require fullscreen TUI mode. Regular terminal mouse selection does not toggle cards; `Ctrl+O` is only for tool details.
- **No four-line preview after opening a process:** A grouped `lines` call shows a count header until you expand the inner group. To see an unexpanded result preview, set that tool's `grouping` to `false` (or disable global grouping).
- **An unlisted tool is hidden or grouped:** Check the `default` configuration key. To preserve a specific extension's renderer, give its tool an explicit `{ "mode": "default" }`.
- **Startup reports a conflicting tool:** Do not load both npm and source copies. The renderer-only implementation in this branch does not replace the existing `bash` executor or RTK behavior.
- **`/reload` errors with `... is not a function` after you rebuilt:** See the maintainer note below; it means a new export was added to a module Pi keeps cached across reloads.

## Maintainer note: adding exports safely (reload staleness)

Pi loads extensions through jiti with the `@earendil-works/*` packages aliased to native files. After a rebuild plus `/reload`, measured behaviour is:

| Module kind | On `/reload` |
| --- | --- |
| Imports an aliased package (e.g. `@earendil-works/pi-tui`) | Re-evaluated, sees the new file. |
| Imports only Node builtins (e.g. `fs`) | Served from the native ESM cache, keeps its **old** exports. |
| `src/index.ts` (entry) | Always re-evaluated. |

So a **new** export added to a builtin-only module and imported by the entry is `undefined` after `/reload`, which is exactly how `resolveTurnPreviewRows` in `config.ts` crashed with `(@earendil-works, _config.resolveTurnPreviewRows) is not a function`. `tests/reloadSafety.test.ts` pins the rule:

- Put new entry-facing exports in `turn.ts` (aliased, always re-evaluated), not in `config.ts`/`state.ts`/`contextUtils.ts`/`componentUtils.ts` (builtin-only, cached).
- Read values from builtin-only modules as **data** rather than by importing a new function; that is why the resolver takes `config.turnPreviewRows` instead of the config object.
- Never rely on an old `dist/` file being replaced to fix a reload error: rebuild first, then `/reload`.
