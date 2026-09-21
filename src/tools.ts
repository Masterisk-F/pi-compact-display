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
import { formatCallLine, resolveResultText } from "./renderUtils";

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

	// name / label / description は呼び出し側で書かず、Pi 組み込み定義から与える
	// (上書き登録では Pi が組み込みメタデータを継承しないため。plans/empty-config-tool-registration.md 参照)
	const reg = (
		name: string,
		def: Omit<Parameters<ExtensionAPI["registerTool"]>[0], "name" | "label" | "description">,
	) => {
		if (resolveToolConfig(name, undefined, config).mode === "default") return;

		const builtin = BUILTIN_DEFS[name](process.cwd());
		pi.registerTool({
			...def,
			name,
			label: builtin.label,
			description: builtin.description,
			promptSnippet: builtin.promptSnippet,
			promptGuidelines: builtin.promptGuidelines,
			prepareArguments: builtin.prepareArguments,
			executionMode: builtin.executionMode,
		});
	};

	// Bash
	reg("bash", {
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
			const text = resolveResultText("bash", context?.args, _result);
			// 展開時は全文を表示する (grouping 時と上限を揃えるため、ハードコードされた上限は持たない)
			const out = text.split("\n").map((l: string) => theme.fg("toolOutput", l)).join("\n");
			return wrapWithBox(new Text(out, 0, 0), theme, context);
		},
	});

	// Read
	reg("read", {
		parameters: orig.read.parameters,
		renderShell: "self",
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return getTools(ctx.cwd).read.execute(toolCallId, params as any, signal, onUpdate);
		},
	});

	// Write
	reg("write", {
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
			const text = resolveResultText("write", context?.args, { ..._result, isError: context?.isError });
			if (!expanded) {
				return wrapWithBox(new Text(theme.fg("error", "error"), 0, 0), theme, context);
			}
			return wrapWithBox(new Text(theme.fg("error", text), 0, 0), theme, context);
		},
	});

	// Edit
	reg("edit", {
		parameters: orig.edit.parameters,
		renderShell: "self",
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return getTools(ctx.cwd).edit.execute(toolCallId, params as any, signal, onUpdate);
		},
		renderCall(args, theme, context) { return wrapWithBox(new Text(formatCallLine("edit", args), 0, 0), theme, context); },
		renderResult(_result, { expanded, isPartial }, theme, context) {
			if (isPartial) return ZERO;
			if (!context?.isError) return ZERO; // 成功時の diff 表示は系統 A が担う
			const text = resolveResultText("edit", context?.args, { ..._result, isError: context?.isError });
			if (!expanded) {
				return wrapWithBox(new Text(theme.fg("error", "error"), 0, 0), theme, context);
			}
			return wrapWithBox(new Text(theme.fg("error", text), 0, 0), theme, context);
		},
	});

	// Ls
	reg("ls", {
		parameters: orig.ls.parameters,
		renderShell: "self",
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return getTools(ctx.cwd).ls.execute(toolCallId, params as any, signal, onUpdate);
		},
	});

	// Find
	reg("find", {
		parameters: orig.find.parameters,
		renderShell: "self",
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return getTools(ctx.cwd).find.execute(toolCallId, params as any, signal, onUpdate);
		},
	});

	// Grep
	reg("grep", {
		parameters: orig.grep.parameters,
		renderShell: "self",
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return getTools(ctx.cwd).grep.execute(toolCallId, params as any, signal, onUpdate);
		},
	});
}
