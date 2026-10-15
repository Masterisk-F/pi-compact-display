import { truncateToWidth, type Component, type TuiMouseEvent, type TuiMouseEventResult } from '@earendil-works/pi-tui';
import { isAssistantMessage, isToolComp, isUserMessage } from './componentUtils';
import { sanitizeToolText } from './sanitize';
import { getParentContainer } from './group';

// Pi has no assistant/whole-turn renderer resolver. Keep the shim at the existing
// Container tracking boundary: preserve actual rows and wrap only their render method.
// No transcript entries, tool executors, or model-facing messages are changed.
const CONTROLLER_KEY = Symbol.for('pi-compact-display.turn-folding');
const DETAIL_KEY = Symbol.for('pi-compact-display.turn-expanded');
const ROOTS_KEY = Symbol.for('pi-compact-display.turn-roots');

type Row = Component & {
	lastMessage?: any;
	isStreaming?: boolean;
	rendererState?: object;
	toolName?: string;
	result?: { isError?: boolean; content?: Array<{ type: string; text?: string }> };
	expanded?: boolean;
	setExpanded?: (expanded: boolean) => void;
	ui?: { requestRender(): void };
};
type Parent = { children: Component[]; invalidate(): void; requestRender?: () => void };

function globals(): Record<symbol, any> { return globalThis as unknown as Record<symbol, any>; }

export function configureTurnFolding(enabled: boolean): void {
	globals()[CONTROLLER_KEY]?.dispose();
	const controller = enabled ? new TurnController() : undefined;
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

export function isTurnDetailExpanded(state: object): boolean {
	return (state as Record<symbol, unknown>)[DETAIL_KEY] === true;
}

function textOf(row: Row): string {
	return (row.lastMessage?.content ?? [])
		.filter((block: any) => block.type === 'text')
		.map((block: any) => block.text).join('\n').trim();
}

class TurnProcessCard implements Component {
	private expanded = false;
	private settled: 'completed' | 'aborted' | undefined;
	private visibleFinal: Row | undefined;
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
		for (const row of this.rows) this.syncTool(row);
		this.parent.invalidate();
		this.requestRender();
	}

	constructor(private parent: Parent, private running: boolean) {}

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

	shouldShow(row: Row): boolean {
		// Image tool results stay visible, as do the final answer and unrelated UI rows.
		return this.expanded || row === this.visibleFinal || !!row.result?.content?.some(block => block.type === 'image');
	}

	private setDetailsExpanded(expanded: boolean): void {
		if (this.expanded === expanded) return;
		this.expanded = expanded;
		for (const row of this.rows) this.syncTool(row);
		this.parent.invalidate();
		this.requestRender();
	}

	syncTool(row: Row): void {
		if (!isToolComp(row) || !row.rendererState) return;
		const state = row.rendererState as Record<symbol, unknown>;
		const expanded = this.expanded;
		if (state[DETAIL_KEY] === expanded && row.expanded === expanded) return;
		state[DETAIL_KEY] = expanded;
		row.setExpanded?.(expanded);
		row.invalidate();
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
		// The card renders before its rows. Resolve the visible final once per frame,
		// rather than rescanning the whole turn from every hidden row.
		const final = this.visibleFinal = this.running ? undefined : this.finalRow();
		const progress = this.progressRows();
		const tools = this.rows.filter(row => isToolComp(row));
		const reason = this.settled === 'aborted' ? 'aborted' : final?.lastMessage?.stopReason;
		const failures = tools.filter(row => row.result?.isError).length;
		const failedResponses = this.rows.filter(row => isAssistantMessage(row) && row !== final && ['error', 'aborted', 'length'].includes(row.lastMessage?.stopReason)).length;
		if (!progress.length && !tools.length && !failedResponses) return [];
		const status = this.running ? '进行中' : reason === 'aborted' ? '已取消' : reason === 'error' ? '失败' : reason === 'length' ? '响应截断' : reason === 'deferred' ? '等待结果' : final || this.settled ? '已完成' : '进行中';
		const header = `${this.expanded ? '▼' : '▶'} 执行过程 · ${status} · ${progress.length} 条进度 · ${tools.length} 次工具调用${failures ? ` · ${failures} 次工具失败` : ''}${failedResponses ? ` · ${failedResponses} 次响应异常` : ''}`;
		const lines = [truncateToWidth(header, width, '…')];
		if (!this.expanded && !final && !this.settled && progress.length) {
			const latest = sanitizeToolText(textOf(progress[progress.length - 1])).replace(/\s+/g, ' ').trim();
			lines.push(truncateToWidth(`当前：${latest}`, width, '…'));
		}
		return lines;
	}
}

class TurnController {
	private running = false;
	private activeTurns = new Set<TurnProcessCard>();
	private turns = new Map<Parent, TurnProcessCard>();
	private wrapped = new Map<Row, { parent: Parent; turn: TurnProcessCard; render: Row['render']; expanded: boolean | undefined }>();

	track(parent: Parent, child: Component): void {
		if (isUserMessage(child)) {
			this.turns.set(parent, new TurnProcessCard(parent, this.running));
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
		this.wrapped.set(row, { parent, turn, render: original, expanded: row.expanded });
		row.render = function(width) {
			turn.syncTool(row);
			return turn.shouldShow(row) ? original.call(this, width) : [];
		};
	}

	untrack(parent: Parent, child: Component): void {
		const row = child as Row;
		const entry = this.wrapped.get(row);
		if (!entry || entry.parent !== parent) return;
		row.render = entry.render;
		if (row.rendererState) {
			delete (row.rendererState as Record<symbol, unknown>)[DETAIL_KEY];
			if (entry.expanded !== undefined) row.setExpanded?.(entry.expanded);
			row.invalidate();
		}
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
