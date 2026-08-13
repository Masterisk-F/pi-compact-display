import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	ToolExecutionComponent,
	UserMessageComponent,
	AssistantMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { Text, Container } from "@earendil-works/pi-tui";
import { loadConfig, resolveToolConfig, getEffectiveToolName } from "./config";
import { formatCallLine, formatOutput } from "./renderUtils";
import { cleanContextMessages } from "./contextUtils";
import { isSpacer, isUserMessage, isAssistantMessage } from "./componentUtils";
import { ZERO, wrapWithBox } from "./uiUtils";
import { SummaryTracker } from "./state";
import { registerCustomTools } from "./tools";
import { GroupContent, trackChild, untrackChild, resetChildren } from "./group";
import path from "path";
import os from "os";

export default function (pi: ExtensionAPI) {
	const configPath = path.join(os.homedir(), ".pi", "agent", "extensions", "pi-compact-display", "config.json");
	const config = loadConfig(configPath);
	const tracker = new SummaryTracker();

	// @ts-ignore
	const originalRebuild = UserMessageComponent.prototype.rebuild;
	// @ts-ignore
	UserMessageComponent.prototype.rebuild = function () {
		originalRebuild.call(this);
		if (config.user?.noPadding) {
			const box = (this as any).children?.[0];
			if (box) {
				box.paddingY = 0;
				if (typeof box.invalidate === 'function') {
					box.invalidate();
				}
			}
		}
	};

	let lastAddedSpacer: any = null;
	let lastSignificantComponentType: string | null = null;

	// Retrieve Container prototype from AssistantMessageComponent to be loader-agnostic
	const containerProto = Object.getPrototypeOf(AssistantMessageComponent.prototype) || Container.prototype;

	// @ts-ignore
	const originalAddChild = containerProto.addChild;
	// @ts-ignore
	const originalAddChildTui = Container.prototype.addChild;

	const hasProto = (obj: any, proto: any) => {
		let p = Object.getPrototypeOf(obj);
		while (p) {
			if (p === proto) return true;
			p = Object.getPrototypeOf(p);
		}
		return false;
	};

	const customAddChild = function (this: any, comp: any) {
		if (config.user?.noPadding) {
			if (isSpacer(comp)) {
				lastAddedSpacer = comp;
				if (lastSignificantComponentType === "user") {
					comp.lines = 0;
				}
			} else if (isUserMessage(comp)) {
				if (lastAddedSpacer) {
					lastAddedSpacer.lines = 0;
				}
				lastSignificantComponentType = "user";
				lastAddedSpacer = null;
			} else if (isAssistantMessage(comp)) {
				lastSignificantComponentType = "assistant";
				lastAddedSpacer = null;
			}
		}

		// ミラーの二重登録防止: ネストしたパッチ (二重ロード時) では外側だけが trackChild する
		const alreadyTracked = (comp as any).__piCompactTrackedBy === this;
		(comp as any).__piCompactTrackedBy = this;

		// originalAddChild が例外を投げても、トラッキング状態がコンポーネントに残留 (リーク) しないよう
		// try/finally で保護する。trackChild は addChild が成功した場合のみ実行する。
		try {
			if (originalAddChildTui !== originalAddChild) {
				if (hasProto(this, Container.prototype)) {
					originalAddChildTui.call(this, comp);
				} else {
					originalAddChild.call(this, comp);
				}
			} else {
				originalAddChild.call(this, comp);
			}

			if (!alreadyTracked) {
				trackChild(this, comp);
			}
		} finally {
			// ネストしたパッチ (外側が trackChild する) の場合も最終状態は undefined で良い
			// (外側の finally でも同様にクリアされる)。
			(comp as any).__piCompactTrackedBy = undefined;
		}

		if (config.user?.noPadding) {
			if (isAssistantMessage(comp)) {
				lastSignificantComponentType = "assistant";
			}
		}
	};

	// @ts-ignore
	containerProto.addChild = customAddChild;
	if (Container.prototype !== containerProto) {
		// @ts-ignore
		Container.prototype.addChild = customAddChild;
	}

	// 親子ミラー保守: removeChild / clear もパッチする (Box は別クラスなので無関係)
	// @ts-ignore
	const originalRemoveChild = Container.prototype.removeChild;
	// @ts-ignore
	Container.prototype.removeChild = function (this: any, comp: any) {
		originalRemoveChild.call(this, comp);
		untrackChild(this, comp);
	};

	// @ts-ignore
	const originalClear = Container.prototype.clear;
	// @ts-ignore
	Container.prototype.clear = function (this: any) {
		originalClear.call(this);
		resetChildren(this);
	};

	// @ts-ignore
	const originalGetCallRenderer = ToolExecutionComponent.prototype.getCallRenderer;
	// @ts-ignore
	ToolExecutionComponent.prototype.getCallRenderer = function () {
		// @ts-ignore
		const toolConfig = resolveToolConfig((this as any).toolName, (this as any).args, config);

		// Group mode: リーダーがグループ全体を描画する GroupContent を返し、非リーダーは ZERO
		// (ツール個別設定 grouping:false のツールはグループ化から除外して単独表示)
		if (config.grouping === true && toolConfig.mode === 'lines' && toolConfig.grouping !== false) {
			return (args: any, theme: any, context: any) => {
				return new GroupContent(this as any, config, theme);
			};
		}

		if (toolConfig.mode === 'count_only') {
			return () => ZERO;
		} else if (toolConfig.mode === 'lines') {
			return (args: any, theme: any, context: any) => {
				// @ts-ignore
				const effectiveName = getEffectiveToolName((this as any).toolName, args);
				// If it's the mcp gateway tool, render compactly as "mcp call <tool>" with args preview
				// @ts-ignore
				if ((this as any).toolName === 'mcp') {
					const bold = typeof theme.bold === 'function' ? theme.bold : (s: string) => s;
					return wrapWithBox(new Text(theme.fg("toolTitle", bold(formatCallLine("mcp", args))), 0, 0), theme, context, toolConfig);
				}
				// If the original renderer exists, use it (e.g. bash, edit have their own concise renderers)
				const origRenderer = originalGetCallRenderer.call(this);
				if (origRenderer) {
					return origRenderer(args, theme, context);
				}
				// Fallback to a single-line bold title
				const bold = typeof theme.bold === 'function' ? theme.bold : (s: string) => s;
				return wrapWithBox(new Text(theme.fg("toolTitle", bold(effectiveName)), 0, 0), theme, context, toolConfig);
			};
		}
		return originalGetCallRenderer.call(this);
	};

	// @ts-ignore
	const originalGetResultRenderer = ToolExecutionComponent.prototype.getResultRenderer;
	// @ts-ignore
	ToolExecutionComponent.prototype.getResultRenderer = function () {
		const origRenderer = originalGetResultRenderer.call(this);
		// @ts-ignore
		const toolConfig = resolveToolConfig((this as any).toolName, (this as any).args, config);

		// Group mode: 結果は GroupContent (call renderer が返す) が描画するので ZERO
		// (ツール個別設定 grouping:false のツールはグループ化から除外して単独表示)
		if (config.grouping === true && toolConfig.mode === 'lines' && toolConfig.grouping !== false) {
			return () => ZERO;
		}

		if (toolConfig.mode === 'count_only') {
			return () => ZERO;
		} else if (toolConfig.mode === 'lines') {
			return (result: any, options: any, theme: any, context: any) => {
				if (options.isPartial) return ZERO;
				const textItem = result.content?.find((c: any) => c.type === "text");
				const rawText = textItem?.text ?? "";
				const formattedText = formatOutput(rawText, toolConfig, !!options.expanded);
				if (!formattedText) return ZERO;
				const coloredText = formattedText.split("\n").map((l: string) => theme.fg("toolOutput", l)).join("\n");
				return wrapWithBox(new Text(coloredText, 0, 0), theme, context, toolConfig);
			};
		}
		return origRenderer;
	};

	// @ts-ignore
	const originalGetRenderShell = ToolExecutionComponent.prototype.getRenderShell;
	// @ts-ignore
	ToolExecutionComponent.prototype.getRenderShell = function () {
		// @ts-ignore
		const toolConfig = resolveToolConfig((this as any).toolName, (this as any).args, config);
		if (toolConfig.mode === 'count_only') {
			return "self";
		}
		// Use "self" for lines mode to bypass contentBox padding (wrapWithBox handles padding via config)
		// (default モードはフォーマット対象外 — 前回の I2 対応で追加された default+format 分岐は
		// コール行との非対称を生むため取り消し、pi 標準の描画に従わせる)
		if (toolConfig.mode === 'lines') {
			return "self";
		}
		return originalGetRenderShell.call(this);
	};

	// ── Count tool calls for count_only tools ──
	pi.on("tool_call", async (event) => {
		const args = (event as any).input;
		const toolConfig = resolveToolConfig(event.toolName, args, config);
		if (toolConfig.mode === 'count_only') {
			const displayName = getEffectiveToolName(event.toolName, args);
			tracker.countCall(event.toolCallId, displayName);
		}
	});

	// ── Detect errors in count_only tools ──
	pi.on("tool_result", async (event) => {
		const args = (event as any).input;
		const toolConfig = resolveToolConfig(event.toolName, args, config);
		if (toolConfig.mode === 'count_only' && event.isError) {
			tracker.setError();
		}
	});

	// ── Prepend summary to assistant's text response ──
	pi.on("message_end", async (event, ctx) => {
		if (event.message.role !== "assistant") return;
		if (!tracker.hasGrouped()) return;

		// ターン中: ツール要求メッセージ (stopReason "toolUse") では集計を保持する。
		// Pi は1ターン内で複数の message_end を発火する (toolUse → ツール実行 → 最終応答) ため、
		// ここでリセットすると同一ターン内の後続ツールが集計漏れする (a21efc7 の I3 対応)。
		const stopReason = (event.message as any).stopReason;
		if (stopReason === "toolUse") return;

		const content = event.message.content;
		if (!Array.isArray(content)) return;

		const hasText = content.some((b: any) => b.type === "text");

		// 正常系終端 (stopReason "stop" かつテキストあり): サマリーを注入し、注入後にリセットする。
		if (stopReason === "stop" && hasText) {
			const summary = tracker.getSummaryLine();
			const hasErrors = tracker.hasErrors();
			tracker.reset();

			const theme = ctx?.ui?.theme;
			const styledSummary = theme
				? theme.bg(hasErrors ? "toolErrorBg" : "toolSuccessBg", ` ${summary} `)
				: summary;

			const newContent = content.map((b: any) => {
				if (b.type === "text") {
					return { ...b, text: `${styledSummary}\n${b.text}` };
				}
				return b;
			});

			return { message: { ...event.message, content: newContent } };
		}

		// 異常系終端 (stopReason "error" / "aborted" / "length" / undefined) または
		// テキストなし終端: サマリーは注入できないがターンは終了している。
		// 前ターンのカウントとエラーフラグを次ターンへリークさせないため必ずリセットする (I1)。
		tracker.reset();
		return;
	});

	// ── Strip summary before sending to LLM ──
	pi.on("context", async (event) => {
		const cleaned = cleanContextMessages(event.messages);
		return { messages: cleaned };
	});

	// ── Register built-in tools ──
	registerCustomTools(pi);
}
