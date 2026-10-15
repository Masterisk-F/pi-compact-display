import type { ExtensionAPI, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Config, resolveToolConfig, getEffectiveToolName } from "./config";
import { formatCallLine, formatOutput, resolveResultText, colorizeResult } from "./renderUtils";
import { GroupContent, getGroupOwner, groupOf } from "./group";
import { ZERO, wrapWithBox } from "./uiUtils";

export function registerToolRenderers(pi: ExtensionAPI, config: Config) {
	pi.registerToolRenderer((toolName, next) => {
		const original = next();
		const baseConfig = resolveToolConfig(toolName, undefined, config);
		const hasOverrides = Object.keys(config).some(key => key.startsWith(`${toolName}:`));
		if (baseConfig.mode === "default" && !hasOverrides) return original;

		const renderers: ToolRenderers = {
			renderShell: baseConfig.mode === "default" ? original?.renderShell : "self",
			renderCall(args, theme, context) {
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
								if (groupOf(owner, config).length) {
									group ??= new GroupContent(owner, config, theme);
									return group.render(width);
								}
								// Image results leave aggregation and retain a standalone call/result row.
								return wrapWithBox(new Text(theme.fg("toolTitle", formatCallLine(toolName, args)), 0, 0), theme, context, toolConfig).render(width);
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
				const toolConfig = resolveToolConfig(toolName, context.args, config);
				if (toolConfig.mode === "default") return original?.renderResult?.(result, options, theme, context) ?? new Text(resolveResultText(toolName, context.args, result), 0, 0);
				if (toolConfig.mode === "count_only" || options.isPartial) return ZERO;
				const raw = resolveResultText(toolName, context.args, { ...result, isError: context.isError });
				const formatted = formatOutput(raw, toolConfig, options.expanded);
				const output = formatted ? wrapWithBox(new Text(colorizeResult(toolName, formatted, theme), 0, 0), theme, context, toolConfig) : ZERO;
				if (config.grouping === true && toolConfig.grouping !== false) {
					// Results can arrive before the row is attached. Resolve its live group
					// at render time, just like the call renderer, including image exclusions.
					return {
						invalidate() { output.invalidate(); },
						render(width) {
							const owner = getGroupOwner(context.state);
							if (owner ? groupOf(owner, config).length > 0 : !options.expanded) return [];
							return output.render(width);
						},
					};
				}
				return output;
			},
		};
		return renderers;
	});
}
