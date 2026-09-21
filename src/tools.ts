import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	createBashTool,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadTool,
	createWriteTool,
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { ZERO, wrapWithBox } from "./uiUtils";
import { Config, resolveToolConfig } from "./config";
import { formatCallLine } from "./renderUtils";

// ── Tool cache ──
const toolCache = new Map<string, ReturnType<typeof createBuiltInTools>>();

const BUILTIN_DEFS: Record<string, (cwd: string) => any> = {
	read: createReadToolDefinition,
	ls: createLsToolDefinition,
	find: createFindToolDefinition,
	grep: createGrepToolDefinition,
	bash: createBashToolDefinition,
	edit: createEditToolDefinition,
	write: createWriteToolDefinition,
};

function createBuiltInTools(cwd: string) {
	return {
		read: createReadTool(cwd),
		bash: createBashTool(cwd),
		edit: createEditTool(cwd),
		write: createWriteTool(cwd),
		find: createFindTool(cwd),
		grep: createGrepTool(cwd),
		ls: createLsTool(cwd),
	};
}

export function getTools(cwd: string) {
	let t = toolCache.get(cwd);
	if (!t) {
		t = createBuiltInTools(cwd);
		toolCache.set(cwd, t);
	}
	return t;
}

export function registerCustomTools(pi: ExtensionAPI, config: Config) {
	const orig = getTools(process.cwd());

	const reg = (name: string, def: Parameters<ExtensionAPI["registerTool"]>[0]) => {
		if (resolveToolConfig(name, undefined, config).mode === "default") return;

		const builtin = BUILTIN_DEFS[name](process.cwd());
		pi.registerTool({
			...def,
			description: builtin.description,
			promptSnippet: builtin.promptSnippet,
			promptGuidelines: builtin.promptGuidelines,
			prepareArguments: builtin.prepareArguments,
			executionMode: builtin.executionMode,
		});
	};

	// Bash
	reg("bash", {
		name: "bash",
		label: "bash",
		description: "Execute a bash command.",
		parameters: orig.bash.parameters,
		renderShell: "self",
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return getTools(ctx.cwd).bash.execute(toolCallId, params as any, signal, onUpdate);
		},
		renderCall(args, theme, context) {
			return wrapWithBox(new Text(formatCallLine("bash", args), 0, 0), theme, context);
		},
		renderResult(_result, { expanded, isPartial }, theme, context) {
			if (isPartial) return ZERO;
			if (!expanded) return ZERO;
			const text = (_result.content.find((c: any) => c.type === "text") as any)?.text ?? "";
			// 展開時は全文を表示する (grouping 時と上限を揃えるため、ハードコードされた上限は持たない)
			const out = text.split("\n").map((l: string) => theme.fg("toolOutput", l)).join("\n");
			return wrapWithBox(new Text(out, 0, 0), theme, context);
		},
	});

	// Read
	reg("read", {
		name: "read",
		label: "read",
		description: "Read a file.",
		parameters: orig.read.parameters,
		renderShell: "self",
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return getTools(ctx.cwd).read.execute(toolCallId, params as any, signal, onUpdate);
		},
	});

	// Write
	reg("write", {
		name: "write",
		label: "write",
		description: "Write content to a file.",
		parameters: orig.write.parameters,
		renderShell: "self",
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return getTools(ctx.cwd).write.execute(toolCallId, params as any, signal, onUpdate);
		},
		renderCall(args, theme, context) {
			return wrapWithBox(new Text(formatCallLine("write", args), 0, 0), theme, context);
		},
		renderResult(_result, { expanded, isPartial }, theme, context) {
			if (isPartial) return ZERO;
			if (!context?.isError) return ZERO; // Hide on success
			const text = (_result.content.find((c: any) => c.type === "text") as any)?.text ?? "";
			if (!expanded) {
				return wrapWithBox(new Text(theme.fg("error", "error"), 0, 0), theme, context);
			}
			return wrapWithBox(new Text(theme.fg("error", text), 0, 0), theme, context);
		},
	});

	// Edit
	reg("edit", {
		name: "edit",
		label: "edit",
		description: "Edit a file by replacing exact text.",
		parameters: orig.edit.parameters,
		renderShell: "self",
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return getTools(ctx.cwd).edit.execute(toolCallId, params as any, signal, onUpdate);
		},
		renderCall(args, theme, context) { return wrapWithBox(new Text(formatCallLine("edit", args), 0, 0), theme, context); },
		renderResult(_result, { expanded, isPartial }, theme, context) {
			if (isPartial) return ZERO;
			if (!context?.isError) return ZERO; // 成功時の diff 表示は系統 A が担う
			const text = (_result.content.find((c: any) => c.type === "text") as any)?.text ?? "";
			if (!expanded) {
				return wrapWithBox(new Text(theme.fg("error", "error"), 0, 0), theme, context);
			}
			return wrapWithBox(new Text(theme.fg("error", text), 0, 0), theme, context);
		},
	});

	// Ls
	reg("ls", {
		name: "ls",
		label: "ls",
		description: "List directory contents.",
		parameters: orig.ls.parameters,
		renderShell: "self",
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return getTools(ctx.cwd).ls.execute(toolCallId, params as any, signal, onUpdate);
		},
	});

	// Find
	reg("find", {
		name: "find",
		label: "find",
		description: "Find files by name pattern.",
		parameters: orig.find.parameters,
		renderShell: "self",
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return getTools(ctx.cwd).find.execute(toolCallId, params as any, signal, onUpdate);
		},
	});

	// Grep
	reg("grep", {
		name: "grep",
		label: "grep",
		description: "Search file contents by regex pattern.",
		parameters: orig.grep.parameters,
		renderShell: "self",
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return getTools(ctx.cwd).grep.execute(toolCallId, params as any, signal, onUpdate);
		},
	});
}
