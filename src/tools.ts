import type { ExtensionAPI, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Config, resolveToolConfig, getEffectiveToolName } from "./config";
import { formatCallLine, formatOutput, resolveResultText, colorizeResult } from "./renderUtils";
import { GroupContent, getGroupOwner } from "./group";
import { ZERO, wrapWithBox } from "./uiUtils";
import { isTurnDetailExpanded } from "./turn";

export function registerToolRenderers(pi: ExtensionAPI, config: Config) {
	pi.registerToolRenderer((toolName, next) => {
		const original = next();
		const baseConfig = resolveToolConfig(toolName, undefined, config);
		const hasOverrides = Object.keys(config).some(key => key.startsWith(`${toolName}:`));
		if (baseConfig.mode === "default" && !hasOverrides) return original;

		const renderers: ToolRenderers = {
			renderShell: baseConfig.mode === "default" ? original?.renderShell : "self",
			renderCall(args, theme, context) {
				if (isTurnDetailExpanded(context.state)) {
					return wrapWithBox(new Text(theme.fg("toolTitle", formatCallLine(toolName, args)), 0, 0), theme, context, { mode: "lines", noPadding: true });
				}
				const toolConfig = resolveToolConfig(toolName, args, config);
				if (toolConfig.mode === "default") return original?.renderCall?.(args, theme, context) ?? new Text(formatCallLine(toolName, args), 0, 0);
				if (toolConfig.mode === "count_only") return ZERO;
				if (config.grouping === true && toolConfig.grouping !== false) {
					let group: GroupContent | undefined;
					return {
						invalidate() { group?.invalidate(); },
						render(width) {
							const owner = getGroupOwner(context.state);
							if (owner) {
								group ??= new GroupContent(owner, config, theme);
								return group.render(width);
							}
							const header = theme.fg("toolTitle", `⚡ ${getEffectiveToolName(toolName, args)} ×1`);
							const text = context.expanded ? `${header}\n${formatCallLine(toolName, args)}` : header;
							return wrapWithBox(new Text(text, 0, 0), theme, context, toolConfig).render(width);
						},
					};
				}
				return wrapWithBox(new Text(theme.fg("toolTitle", theme.bold(formatCallLine(toolName, args))), 0, 0), theme, context, toolConfig);
			},
			renderResult(result, options, theme, context) {
				if (isTurnDetailExpanded(context.state)) {
					const raw = resolveResultText(toolName, context.args, { ...result, isError: context.isError });
					const text = formatOutput(raw, { mode: "lines" }, true);
					return text ? wrapWithBox(new Text(colorizeResult(toolName, text, theme), 0, 0), theme, context, { mode: "lines", noPadding: true }) : ZERO;
				}
				const toolConfig = resolveToolConfig(toolName, context.args, config);
				if (toolConfig.mode === "default") return original?.renderResult?.(result, options, theme, context) ?? new Text(resolveResultText(toolName, context.args, result), 0, 0);
				if (toolConfig.mode === "count_only" || options.isPartial) return ZERO;
				if (config.grouping === true && toolConfig.grouping !== false && (getGroupOwner(context.state) || !options.expanded)) return ZERO;
				const raw = resolveResultText(toolName, context.args, { ...result, isError: context.isError });
				const formatted = formatOutput(raw, toolConfig, options.expanded);
				return formatted ? wrapWithBox(new Text(colorizeResult(toolName, formatted, theme), 0, 0), theme, context, toolConfig) : ZERO;
			},
		};
		return renderers;
	});
}
