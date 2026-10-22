import { truncateToWidth, wrapTextWithAnsi, type Component, type TuiMouseEvent, type TuiMouseEventResult } from '@earendil-works/pi-tui';
import { resolveToolConfig, type Config } from './config';
import { isAssistantMessage, isToolComp, isUserMessage } from './componentUtils';
import { sanitizeToolText } from './sanitize';
import { getParentContainer, groupOf } from './group';

// Pi has no assistant/whole-turn renderer resolver. Keep the shim at the existing
// Container tracking boundary: preserve actual rows and wrap only their render method.
// No transcript entries, tool executors, or model-facing messages are changed.
const CONTROLLER_KEY = Symbol.for('pi-compact-display.turn-folding');
const ROOTS_KEY = Symbol.for('pi-compact-display.turn-roots');

// Reload-safety rule (do not move this to a module that only imports Node builtins):
// Pi loads extensions through jiti. A module that imports an aliased package such as
// `@earendil-works/pi-tui` is re-evaluated on every `/reload`, while a module that imports
// only Node builtins stays in the native ESM cache and keeps its OLD exports. `index.ts`
// is always re-evaluated, so anything it imports by name must come from a re-evaluated
// module. This file imports pi-tui and is therefore safe; `config.ts` imports only `fs`
// and is NOT. Adding a new export to `config.ts` and importing it here crashed `/reload`
// with "resolveTurnPreviewRows is not a function" after a rebuild. Keep new entry-facing
// exports in this module, and read plain-module values through data (e.g. a config field).

type Row = Component & {
	lastMessage?: any;
	isStreaming?: boolean;
	toolName?: string;
	args?: any;
	result?: { isError?: boolean; content?: Array<{ type: string; text?: string }> };
	ui?: { requestRender(): void };
};
type Parent = { children: Component[]; invalidate(): void; requestRender?: () => void };

function globals(): Record<symbol, any> { return globalThis as unknown as Record<symbol, any>; }

/** Default number of recent rows a collapsed process card keeps visible. */
export const DEFAULT_TURN_PREVIEW_ROWS = 3;

/**
 * 折りたたみ中に残す行数を解決する。
 * 1 以上の整数だけを受け付け、未指定・0 以下・小数・数値以外は既定値に戻す
 * (直近の作業が消える構成を暗黙に許さない)。
 *
 * 値を受け取る形にしてあるのは reload 安全性のため (上記ルール参照):
 * `config.ts` から関数を import せず、プレーンなデータだけを渡す。
 */
export function resolveTurnPreviewRows(value: unknown): number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : DEFAULT_TURN_PREVIEW_ROWS;
}

export interface TurnFoldingOptions {
	/** Rows a collapsed card keeps visible. Defaults to `DEFAULT_TURN_PREVIEW_ROWS`. */
	previewRows?: number;
	/** Tool configuration, used to know which rows would render anything when folded. */
	config?: Config;
}

export function configureTurnFolding(enabled: boolean, options: TurnFoldingOptions = {}): void {
	globals()[CONTROLLER_KEY]?.dispose();
	const controller = enabled ? new TurnController(options) : undefined;
	globals()[CONTROLLER_KEY] = controller;
	const roots: WeakRef<Parent>[] = globals()[ROOTS_KEY] ?? [];
	globals()[ROOTS_KEY] = roots.filter(ref => {
		const parent = ref.deref();
		if (!parent || !parent.children.some(child => isUserMessage(child))) return false;
		// /reload need not reconstruct the chat. Reattach cards to already-rendered rows.
		if (controller) for (const child of [...parent.children]) controller.track(parent, child);
		return true;
	});
}

export function trackTurnChild(parent: Parent, child: Component): void {
	if (isUserMessage(child)) {
		const roots: WeakRef<Parent>[] = globals()[ROOTS_KEY] ??= [];
		if (!roots.some(ref => ref.deref() === parent)) roots.push(new WeakRef(parent));
	}
	globals()[CONTROLLER_KEY]?.track(parent, child);
}

export function untrackTurnChild(parent: Parent, child: Component): void {
	globals()[CONTROLLER_KEY]?.untrack(parent, child);
}

export function clearTurnChildren(parent: Parent): void {
	globals()[CONTROLLER_KEY]?.clear(parent);
}

export function beginTurnFolding(): void {
	globals()[CONTROLLER_KEY]?.begin();
}

export function settleTurnFolding(aborted: boolean): void {
	globals()[CONTROLLER_KEY]?.settle(aborted);
}

export function collapseTurnFolding(): number {
	return globals()[CONTROLLER_KEY]?.collapseAll() ?? 0;
}

function textOf(row: Row): string {
	return (row.lastMessage?.content ?? [])
		.filter((block: any) => block.type === 'text')
		.map((block: any) => block.text).join('\n').trim();
}

function hasImages(row: Row): boolean {
	return !!row.result?.content?.some(block => block.type === 'image');
}

class TurnProcessCard implements Component {
	private expanded = false;
	private settled: 'completed' | 'aborted' | undefined;
	private visibleFinal: Row | undefined;
	/** Rows the collapsed card leaves visible for this frame. */
	private visiblePreview: Set<Component> = new Set();
	/** The newest previewed progress row, which carries the `当前：` label. */
	private labeledRow: Row | undefined;
	readonly rows: Row[] = [];

	add(row: Row, running: boolean): void {
		if (running) {
			this.running = true;
			this.settled = undefined;
		}
		this.rows.push(row);
	}

	settle(aborted: boolean): void {
		this.running = false;
		this.settled = aborted ? 'aborted' : 'completed';
		this.expanded = false;
		this.parent.invalidate();
		this.requestRender();
	}

	constructor(
		private parent: Parent,
		private running: boolean,
		private previewRows: number = DEFAULT_TURN_PREVIEW_ROWS,
		private config: Config = {},
	) {}

	isExpanded(): boolean {
		return this.expanded;
	}

	collapse(): void {
		this.setDetailsExpanded(false);
	}

	private finalRow(): Row | undefined {
		const last = [...this.rows].reverse().find(row => isAssistantMessage(row));
		if (!last || last.isStreaming) return undefined;
		const reason = last.lastMessage?.stopReason;
		if (!['stop', 'error', 'aborted', 'length', 'deferred'].includes(reason)) return undefined;
		if (reason === 'stop' && last.lastMessage.content?.some((b: any) => b.type === 'toolCall')) return undefined;
		return last;
	}

	private progressRows(): Row[] {
		const final = this.running ? undefined : this.finalRow();
		return this.rows.filter(row => isAssistantMessage(row) && row !== final && textOf(row));
	}

	/**
	 * Rows that would render something while folded. Rows that Pi or this extension
	 * render as nothing (`count_only` calls, non-leader group members) do not use up a
	 * preview slot, so "3 rows" means three rows the reader can actually see.
	 */
	private rendersWhenFolded(row: Row): boolean {
		if (isAssistantMessage(row)) return !!textOf(row);
		if (!isToolComp(row)) return false;
		if (hasImages(row)) return false; // Always visible; does not consume a slot.
		const toolConfig = resolveToolConfig(row.toolName!, row.args, this.config);
		if (toolConfig.mode === 'count_only') return false;
		if (this.config.grouping === true && toolConfig.mode === 'lines' && toolConfig.grouping !== false) {
			const members = groupOf(row, this.config);
			if (members.length && members[0] !== row) return false;
		}
		return true;
	}

	/**
	 * The collapsed preview is the tail of the turn, rendered at each row's real
	 * transcript position: assistant progress text as normal conversation text, tool
	 * rows through their own renderer so grouping, `count_only` and per-tool line
	 * limits still decide how folded they look. The final answer renders natively and
	 * never consumes a slot.
	 */
	private previewTail(final: Row | undefined): Row[] {
		const tail: Row[] = [];
		for (let i = this.rows.length - 1; i >= 0 && tail.length < this.previewRows; i--) {
			const row = this.rows[i];
			if (row === final || !this.rendersWhenFolded(row)) continue;
			tail.push(row);
		}
		return tail;
	}

	/**
	 * Progress text is rendered here rather than natively while folded: the card already
	 * owns that row, and the preview must stay terminal-safe (no escape sequences) and
	 * wrapped to the terminal width.
	 */
	previewLines(row: Row, width: number): string[] | undefined {
		if (this.expanded || !this.visiblePreview.has(row) || !isAssistantMessage(row)) return undefined;
		const text = sanitizeToolText(textOf(row)).trim();
		if (!text) return undefined;
		const label = row === this.labeledRow ? '当前：' : '';
		return wrapTextWithAnsi(`${label}${text}`, width).map(line => truncateToWidth(line, width, '…'));
	}

	shouldShow(row: Row): boolean {
		// Image tool results stay visible, as do the final answer and unrelated UI rows.
		return this.expanded || row === this.visibleFinal || this.visiblePreview.has(row) || hasImages(row);
	}

	private setDetailsExpanded(expanded: boolean): void {
		if (this.expanded === expanded) return;
		this.expanded = expanded;
		// Outer visibility is independent: never change nested tool expansion or render configuration.
		this.parent.invalidate();
		this.requestRender();
	}

	private requestRender(): void {
		const ui = this.rows.find(row => row.ui)?.ui;
		if (ui) return ui.requestRender();
		let parent: any = this.parent;
		while (parent) {
			if (typeof parent.requestRender === 'function') return parent.requestRender();
			parent = getParentContainer(parent);
		}
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type !== 'click' || event.button !== 'left' || event.y !== 0) return undefined;
		this.setDetailsExpanded(!this.expanded);
		return { handled: true };
	}

	invalidate(): void {}

	render(width: number): string[] {
		// The card renders before its rows. Resolve the visible final and the preview
		// tail once per frame, rather than rescanning the whole turn from every row.
		const final = this.visibleFinal = this.running ? undefined : this.finalRow();
		const progress = this.progressRows();
		const tools = this.rows.filter(row => isToolComp(row));
		const tail = this.expanded ? [] : this.previewTail(final);
		this.visiblePreview = new Set(tail);
		// `tail` is newest-first: the first progress row in it is the current work.
		this.labeledRow = tail.find(row => isAssistantMessage(row));
		const reason = this.settled === 'aborted' ? 'aborted' : final?.lastMessage?.stopReason;
		const failures = tools.filter(row => row.result?.isError).length;
		const failedResponses = this.rows.filter(row => isAssistantMessage(row) && row !== final && ['error', 'aborted', 'length'].includes(row.lastMessage?.stopReason)).length;
		if (!progress.length && !tools.length && !failedResponses) return [];
		const status = this.running ? '进行中' : reason === 'aborted' ? '已取消' : reason === 'error' ? '失败' : reason === 'length' ? '响应截断' : reason === 'deferred' ? '等待结果' : final || this.settled ? '已完成' : '进行中';
		const header = `${this.expanded ? '▼' : '▶'} 执行过程 · ${status} · ${progress.length} 条进度 · ${tools.length} 次工具调用${failures ? ` · ${failures} 次工具失败` : ''}${failedResponses ? ` · ${failedResponses} 次响应异常` : ''}`;
		return [truncateToWidth(header, width, '…')];
	}
}

class TurnController {
	private running = false;
	private activeTurns = new Set<TurnProcessCard>();
	private turns = new Map<Parent, TurnProcessCard>();
	private wrapped = new Map<Row, { parent: Parent; turn: TurnProcessCard; render: Row['render'] }>();
	private previewRows: number;
	private config: Config;

	constructor(options: TurnFoldingOptions = {}) {
		this.previewRows = options.previewRows ?? DEFAULT_TURN_PREVIEW_ROWS;
		this.config = options.config ?? {};
	}

	track(parent: Parent, child: Component): void {
		if (isUserMessage(child)) {
			this.turns.set(parent, new TurnProcessCard(parent, this.running, this.previewRows, this.config));
			return;
		}
		const turn = this.turns.get(parent);
		if (!turn || (!isAssistantMessage(child) && !isToolComp(child))) return;
		const row = child as Row;
		const existing = this.wrapped.get(row);
		if (existing?.parent === parent && existing.turn === turn) return;
		if (existing) this.untrack(existing.parent, row);
		if (!turn.rows.length) {
			// UI-only card. Deliberately omit setExpanded: native Ctrl+O must not open all turns.
			parent.children.splice(parent.children.indexOf(child), 0, turn);
		}
		turn.add(row, this.running);
		if (this.running) this.activeTurns.add(turn);
		const original = row.render;
		this.wrapped.set(row, { parent, turn, render: original });
		row.render = function(width) {
			const preview = turn.previewLines(row, width);
			if (preview) return preview;
			return turn.shouldShow(row) ? original.call(this, width) : [];
		};
	}

	untrack(parent: Parent, child: Component): void {
		const row = child as Row;
		const entry = this.wrapped.get(row);
		if (!entry || entry.parent !== parent) return;
		row.render = entry.render;
		entry.turn.rows.splice(entry.turn.rows.indexOf(row), 1);
		this.wrapped.delete(row);
		if (!entry.turn.rows.length) this.removeCard(parent, entry.turn);
	}

	private removeCard(parent: Parent, card: TurnProcessCard): void {
		const index = parent.children.indexOf(card);
		if (index !== -1) parent.children.splice(index, 1);
		this.activeTurns.delete(card);
	}

	clear(parent: Parent): void {
		for (const [row, entry] of this.wrapped) if (entry.parent === parent) this.untrack(parent, row);
		this.turns.delete(parent);
	}

	begin(): void {
		this.running = true;
	}

	settle(aborted: boolean): void {
		this.running = false;
		for (const turn of this.activeTurns) turn.settle(aborted);
		this.activeTurns.clear();
	}

	collapseAll(): number {
		const opened = new Set<TurnProcessCard>();
		for (const { turn } of this.wrapped.values()) {
			if (turn.isExpanded()) opened.add(turn);
		}
		for (const turn of opened) turn.collapse();
		return opened.size;
	}

	dispose(): void {
		for (const parent of this.turns.keys()) this.clear(parent);
	}
}
