import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	createBashTool,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadTool,
	createWriteTool,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { ZERO, wrapWithBox } from "./uiUtils";
import { Config } from "./config";
import { formatCallLine } from "./renderUtils";

// ── Tool cache ──
const toolCache = new Map<string, ReturnType<typeof createBuiltInTools>>();

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

export function registerCustomTools(pi: ExtensionAPI) {
	const orig = getTools(process.cwd());

	// Bash
	pi.registerTool({
		name: "bash",
		label: "bash",
		description: "Execute a bash command.",
		parameters: orig.bash.parameters,
		renderShell: "self",
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return getTools(ctx.cwd).bash.execute(toolCallId, params, signal, onUpdate);
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
	pi.registerTool({
		name: "read",
		label: "read",
		description: "Read a file.",
		parameters: orig.read.parameters,
		renderShell: "self",
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return getTools(ctx.cwd).read.execute(toolCallId, params, signal, onUpdate);
		},
		renderCall() { return ZERO; },
		renderResult() { return ZERO; },
	});

	// Write
	pi.registerTool({
		name: "write",
		label: "write",
		description: "Write content to a file.",
		parameters: orig.write.parameters,
		renderShell: "self",
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return getTools(ctx.cwd).write.execute(toolCallId, params, signal, onUpdate);
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
	pi.registerTool({
		name: "edit",
		label: "edit",
		description: "Edit a file by replacing exact text.",
		parameters: orig.edit.parameters,
		renderShell: "self",
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return getTools(ctx.cwd).edit.execute(toolCallId, params, signal, onUpdate);
		},
		renderCall(args, theme, context) { return wrapWithBox(new Text(formatCallLine("edit", args), 0, 0), theme, context); },
		renderResult(_result, { expanded, isPartial }, theme, context) {
			if (isPartial) return ZERO;
			const text = (_result.content.find((c: any) => c.type === "text") as any)?.text ?? "";
			if (context?.isError) {
				if (!expanded) {
					return wrapWithBox(new Text(theme.fg("error", "error"), 0, 0), theme, context);
				}
				return wrapWithBox(new Text(theme.fg("error", text), 0, 0), theme, context);
			}
			if (!expanded) return ZERO;
			const details = _result.details as { diff?: string } | undefined;
			if (details?.diff) {
				// 展開時は全文を表示する (ハードコードされた上限は持たない)
				const lines = details.diff.split("\n");
				const out = lines.map(l => {
					if (l.startsWith("+") && !l.startsWith("+++")) return theme.fg("success", l);
					if (l.startsWith("-") && !l.startsWith("---")) return theme.fg("error", l);
					return theme.fg("dim", l);
				}).join("\n");
				return wrapWithBox(new Text(out, 0, 0), theme, context);
			}
			return ZERO;
		},
	});

	// Ls
	pi.registerTool({
		name: "ls",
		label: "ls",
		description: "List directory contents.",
		parameters: orig.ls.parameters,
		renderShell: "self",
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return getTools(ctx.cwd).ls.execute(toolCallId, params, signal, onUpdate);
		},
		renderCall() { return ZERO; },
		renderResult() { return ZERO; },
	});

	// Find
	pi.registerTool({
		name: "find",
		label: "find",
		description: "Find files by name pattern.",
		parameters: orig.find.parameters,
		renderShell: "self",
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return getTools(ctx.cwd).find.execute(toolCallId, params, signal, onUpdate);
		},
		renderCall() { return ZERO; },
		renderResult() { return ZERO; },
	});

	// Grep
	pi.registerTool({
		name: "grep",
		label: "grep",
		description: "Search file contents by regex pattern.",
		parameters: orig.grep.parameters,
		renderShell: "self",
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return getTools(ctx.cwd).grep.execute(toolCallId, params, signal, onUpdate);
		},
		renderCall() { return ZERO; },
		renderResult() { return ZERO; },
	});
}
