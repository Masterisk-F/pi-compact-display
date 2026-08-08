import { Box, Container, Text } from "@earendil-works/pi-tui";
import { Config, getEffectiveToolName, resolveToolConfig } from "./config";
import { formatCallLine, formatOutput } from "./renderUtils";

// ─────────────────────────────────────────────────────────────
// 親子ミラー
//
// pi-tui の Container.addChild は children.push するだけで親参照を持たないため、
// extension 側で addChild / removeChild / clear をパッチしてここにミラーを保守する。
// GroupContent はこのミラーから兄弟の ToolExecutionComponent を探してグループを組む。
// ─────────────────────────────────────────────────────────────

const parentMap = new WeakMap<object, Container>();
const childrenMap = new WeakMap<Container, object[]>();

export function trackChild(container: Container, comp: object): void {
	parentMap.set(comp, container);
	let list = childrenMap.get(container);
	if (!list) {
		list = [];
		childrenMap.set(container, list);
	}
	list.push(comp);
}

export function untrackChild(container: Container, comp: object): void {
	const list = childrenMap.get(container);
	if (list) {
		const i = list.indexOf(comp);
		if (i !== -1) list.splice(i, 1);
	}
	if (parentMap.get(comp) === container) parentMap.delete(comp);
}

export function resetChildren(container: Container): void {
	childrenMap.set(container, []);
}

// ─────────────────────────────────────────────────────────────
// グループ走査
//
// グループ = 直近のターン境界 (UserMessage / AssistantMessage) の間に存在する
// lines モードの ToolExecutionComponent 全て (ツール名・間に挟まるコンポーネントは問わない)。
// 先頭メンバー = リーダー。リーダーだけがグループ全体を描画する。
// ─────────────────────────────────────────────────────────────

const isUserMessage = (c: object) => (c as any)?.constructor?.name === "UserMessageComponent";
const isAssistantMessage = (c: object) => (c as any)?.constructor?.name === "AssistantMessageComponent";
const isTurnBoundary = (c: object) => isUserMessage(c) || isAssistantMessage(c);

const isToolComp = (c: object) => (c as any)?.constructor?.name === "ToolExecutionComponent";

function isGroupMember(c: object, config: Config): boolean {
	if (!isToolComp(c)) return false;
	const anyC = c as any;
	return resolveToolConfig(anyC.toolName, anyC.args, config).mode === "lines";
}

/**
 * owner が属するグループのメンバーを (呼び出し順で) 返す。
 * grouping 未設定・ツリー未登録・メンバーなしの場合は空配列。
 */
export function groupOf(owner: object, config: Config): any[] {
	if (config.grouping !== true) return [];
	const container = parentMap.get(owner);
	if (!container) return [];
	const cs = childrenMap.get(container) ?? [];
	const ownerIndex = cs.indexOf(owner);
	if (ownerIndex === -1) return [];

	// 後方: 直前のターン境界まで遡り、グループ先頭メンバー (start) を探す
	let start = ownerIndex;
	for (let i = ownerIndex - 1; i >= 0; i--) {
		if (isTurnBoundary(cs[i])) break;
		if (isGroupMember(cs[i], config)) start = i;
	}

	// 前方: 次のターン境界まで全メンバーを収集
	const members: any[] = [];
	for (let i = start; i < cs.length; i++) {
		if (isTurnBoundary(cs[i])) break;
		if (isGroupMember(cs[i], config)) members.push(cs[i]);
	}
	return members;
}

// ─────────────────────────────────────────────────────────────
// GroupContent コンポーネント
//
// リーダーの call renderer が返す動的コンポーネント。毎フレーム render(width) が呼ばれ、
// その時点のミラーとメンバー状態 (result / isPartial / expanded) を生で読んで
// グループ全体を1つのボックスに描画する。
// ─────────────────────────────────────────────────────────────

export class GroupContent {
	private owner: any;
	private config: Config;
	private theme: any;
	private box: Box;
	private text: Text;
	private lastText: string | null = null;

	constructor(owner: any, config: Config, theme: any) {
		this.owner = owner;
		this.config = config;
		this.theme = theme;
		const leaderConfig = resolveToolConfig(owner.toolName, owner.args, config);
		this.text = new Text("", 0, 0);
		this.box = new Box(leaderConfig.noPadding ? 0 : 1, 0, (t: string) => theme.bg(this.currentBgName(), t));
		this.box.addChild(this.text);
	}

	private currentBgName(): string {
		const members = groupOf(this.owner, this.config);
		if (members.length === 0) return "toolSuccessBg";
		if (members.some((m) => m.isPartial)) return "toolPendingBg";
		if (members.some((m) => m.result?.isError)) return "toolErrorBg";
		return "toolSuccessBg";
	}

	invalidate(): void {
		this.box.invalidate();
	}

	render(width: number): string[] {
		const members = groupOf(this.owner, this.config);
		// リーダー (先頭メンバー) だけが描画する
		if (members.length === 0 || members[0] !== this.owner) return [];
		const text = this.buildText(members);
		if (text !== this.lastText) {
			this.text.setText(text);
			this.lastText = text;
		}
		return this.box.render(width);
	}

	private buildText(members: any[]): string {
		const theme = this.theme;
		const bold = typeof theme.bold === "function" ? theme.bold : (s: string) => s;
		const expanded = !!this.owner.expanded;
		const lines: string[] = [];

		// ヘッダー (2回以上まとめたときのみ)
		if (members.length > 1) {
			const counts = new Map<string, number>();
			for (const m of members) {
				const name = getEffectiveToolName(m.toolName, m.args);
				counts.set(name, (counts.get(name) || 0) + 1);
			}
			const header = `⚡ ${[...counts.entries()].map(([n, c]) => `${n} ×${c}`).join(" ")}`;
			lines.push(theme.fg("toolTitle", bold(header)));
		}

		members.forEach((m, idx) => {
			if (idx > 0) lines.push("");
			lines.push(theme.fg("toolTitle", formatCallLine(m.toolName, m.args)));

			const raw = getResultText(m);
			if (raw) {
				const mConfig = resolveToolConfig(m.toolName, m.args, this.config);
				const formatted = formatOutput(raw, mConfig, expanded);
				if (formatted) {
					lines.push(...formatted.split("\n").map((l: string) => theme.fg("toolOutput", l)));
				}
			}
		});

		return lines.join("\n");
	}
}

function getResultText(m: any): string {
	const textItem = m.result?.content?.find((c: any) => c.type === "text");
	return textItem?.text ?? "";
}
