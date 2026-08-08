import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import { Container } from "@earendil-works/pi-tui";
import { loadConfig } from '../src/config';
import { GroupContent, groupOf, trackChild, untrackChild, resetChildren } from '../src/group';

vi.mock('fs');

// ── helpers ──

function makeConfig(json: any) {
	vi.mocked(fs.existsSync).mockReturnValue(true);
	vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(json));
	return loadConfig('/test/config.json');
}

/** Fake ToolExecutionComponent (constructor.name ベース判定のため名前を一致させる) */
function makeTool(name: string, args: any, extra: any = {}) {
	return {
		constructor: { name: "ToolExecutionComponent" },
		toolName: name,
		args,
		result: undefined,
		isPartial: false,
		expanded: false,
		...extra,
	};
}

const userMsg = { constructor: { name: "UserMessageComponent" } };
const assistantMsg = { constructor: { name: "AssistantMessageComponent" } };

const theme = {
	bg: (name: string, s: string) => `[${name}]${s}[/${name}]`,
	fg: (name: string, s: string) => `<${name}>${s}</${name}>`,
	bold: (s: string) => `*${s}*`,
};

const resultOf = (text: string, isError = false) => ({
	content: [{ type: "text", text }],
	isError,
});

// ── groupOf ──

describe('groupOf', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it('should return empty when grouping is not enabled', () => {
		const config = makeConfig({ bash: { mode: 'lines' } });
		const c = new Container();
		const t1 = makeTool('bash', { command: 'echo a' });
		trackChild(c, t1);
		expect(groupOf(t1, config)).toEqual([]);
	});

	it('should return empty when owner is not in the tree', () => {
		const config = makeConfig({ grouping: true, bash: { mode: 'lines' } });
		const t1 = makeTool('bash', { command: 'echo a' });
		expect(groupOf(t1, config)).toEqual([]);
	});

	it('should group consecutive lines tools of the same turn', () => {
		const config = makeConfig({ grouping: true, bash: { mode: 'lines' } });
		const c = new Container();
		const t1 = makeTool('bash', { command: 'echo a' });
		const t2 = makeTool('bash', { command: 'echo b' });
		const t3 = makeTool('bash', { command: 'echo c' });
		trackChild(c, t1);
		trackChild(c, t2);
		trackChild(c, t3);
		expect(groupOf(t1, config)).toEqual([t1, t2, t3]);
		expect(groupOf(t2, config)).toEqual([t1, t2, t3]);
		expect(groupOf(t3, config)).toEqual([t1, t2, t3]);
	});

	it('should group different lines tools together', () => {
		const config = makeConfig({ grouping: true, bash: { mode: 'lines' }, write: { mode: 'lines' } });
		const c = new Container();
		const b = makeTool('bash', { command: 'echo a' });
		const w = makeTool('write', { path: 'a.txt' });
		trackChild(c, b);
		trackChild(c, w);
		expect(groupOf(b, config)).toEqual([b, w]);
		expect(groupOf(w, config)).toEqual([b, w]);
	});

	it('should break the group at a turn boundary (user message)', () => {
		const config = makeConfig({ grouping: true, bash: { mode: 'lines' } });
		const c = new Container();
		const t1 = makeTool('bash', { command: 'echo a' });
		const t2 = makeTool('bash', { command: 'echo b' });
		const t3 = makeTool('bash', { command: 'echo c' });
		trackChild(c, t1);
		trackChild(c, t2);
		trackChild(c, userMsg);
		trackChild(c, t3);
		expect(groupOf(t1, config)).toEqual([t1, t2]);
		expect(groupOf(t3, config)).toEqual([t3]);
	});

	it('should break the group at an assistant message boundary', () => {
		const config = makeConfig({ grouping: true, bash: { mode: 'lines' } });
		const c = new Container();
		const t1 = makeTool('bash', { command: 'echo a' });
		const t2 = makeTool('bash', { command: 'echo b' });
		trackChild(c, t1);
		trackChild(c, assistantMsg);
		trackChild(c, t2);
		expect(groupOf(t1, config)).toEqual([t1]);
		expect(groupOf(t2, config)).toEqual([t2]);
	});

	it('should still group across a count_only tool (invisible) within the turn', () => {
		const config = makeConfig({ grouping: true, bash: { mode: 'lines' }, read: { mode: 'count_only' } });
		const c = new Container();
		const t1 = makeTool('bash', { command: 'echo a' });
		const r = makeTool('read', { path: 'x' });
		const t2 = makeTool('bash', { command: 'echo b' });
		trackChild(c, t1);
		trackChild(c, r);
		trackChild(c, t2);
		expect(groupOf(t1, config)).toEqual([t1, t2]);
	});

	it('should not include default-mode tools in the group', () => {
		const config = makeConfig({ grouping: true, bash: { mode: 'lines' }, write: { mode: 'default' } });
		const c = new Container();
		const t1 = makeTool('bash', { command: 'echo a' });
		const w = makeTool('write', { path: 'a.txt' });
		trackChild(c, t1);
		trackChild(c, w);
		expect(groupOf(t1, config)).toEqual([t1]);
	});

	it('should update the group after removeChild/resetChildren', () => {
		const config = makeConfig({ grouping: true, bash: { mode: 'lines' } });
		const c = new Container();
		const t1 = makeTool('bash', { command: 'echo a' });
		const t2 = makeTool('bash', { command: 'echo b' });
		trackChild(c, t1);
		trackChild(c, t2);
		expect(groupOf(t1, config)).toEqual([t1, t2]);

		untrackChild(c, t2);
		expect(groupOf(t1, config)).toEqual([t1]);

		resetChildren(c);
		expect(groupOf(t1, config)).toEqual([]);
	});
});

// ── GroupContent ──

describe('GroupContent', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it('should render the whole group from the leader: header + call lines + outputs', () => {
		const config = makeConfig({ grouping: true, bash: { mode: 'lines', outputLines: 2 } });
		const c = new Container();
		const t1 = makeTool('bash', { command: 'echo a' }, { result: resultOf('line1\nline2\nline3') });
		const t2 = makeTool('bash', { command: 'echo b' }, { result: resultOf('outB') });
		trackChild(c, t1);
		trackChild(c, t2);

		const gc = new GroupContent(t1, config, theme);
		const text = gc.render(60).join("\n");
		expect(text).toContain('⚡ bash ×2');
		expect(text).toContain('$ echo a');
		expect(text).toContain('line1');
		expect(text).toContain('line2');
		expect(text).not.toContain('line3'); // outputLines=2 でトランケート
		expect(text).toContain('$ echo b');
		expect(text).toContain('outB');
	});

	it('should render nothing for a non-leader member', () => {
		const config = makeConfig({ grouping: true, bash: { mode: 'lines' } });
		const c = new Container();
		const t1 = makeTool('bash', { command: 'echo a' }, { result: resultOf('A') });
		const t2 = makeTool('bash', { command: 'echo b' }, { result: resultOf('B') });
		trackChild(c, t1);
		trackChild(c, t2);

		const gc = new GroupContent(t2, config, theme);
		expect(gc.render(60)).toEqual([]);
	});

	it('should render a singleton without a header', () => {
		const config = makeConfig({ grouping: true, bash: { mode: 'lines' } });
		const c = new Container();
		const t1 = makeTool('bash', { command: 'echo solo' }, { result: resultOf('solo out') });
		trackChild(c, t1);

		const gc = new GroupContent(t1, config, theme);
		const text = gc.render(60).join("\n");
		expect(text).not.toContain('⚡');
		expect(text).toContain('$ echo solo');
		expect(text).toContain('solo out');
	});

	it('should use error background when any member errored', () => {
		const config = makeConfig({ grouping: true, bash: { mode: 'lines' } });
		const c = new Container();
		const t1 = makeTool('bash', { command: 'ok' }, { result: resultOf('ok') });
		const t2 = makeTool('bash', { command: 'bad' }, { result: resultOf('boom', true) });
		trackChild(c, t1);
		trackChild(c, t2);

		const gc = new GroupContent(t1, config, theme);
		const text = gc.render(60).join("\n");
		expect(text).toContain('toolErrorBg');
	});

	it('should use pending background while any member is partial', () => {
		const config = makeConfig({ grouping: true, bash: { mode: 'lines' } });
		const c = new Container();
		const t1 = makeTool('bash', { command: 'a' }, { isPartial: true, result: undefined });
		trackChild(c, t1);

		const gc = new GroupContent(t1, config, theme);
		const text = gc.render(60).join("\n");
		expect(text).toContain('toolPendingBg');
	});

	it('should expand all members when the leader is expanded', () => {
		const config = makeConfig({ grouping: true, bash: { mode: 'lines', outputLines: 2 } });
		const c = new Container();
		const t1 = makeTool('bash', { command: 'long' }, { result: resultOf('l1\nl2\nl3\nl4'), expanded: true });
		trackChild(c, t1);

		const gc = new GroupContent(t1, config, theme);
		const text = gc.render(60).join("\n");
		expect(text).toContain('l1');
		expect(text).toContain('l4'); // expanded 時は outputLines を無視
	});

	it('should respect per-member outputLines', () => {
		const config = makeConfig({
			grouping: true,
			bash: { mode: 'lines', outputLines: 1 },
			edit: { mode: 'lines', outputLines: 3 },
		});
		const c = new Container();
		const b = makeTool('bash', { command: 'x' }, { result: resultOf('b1\nb2\nb3') });
		const e = makeTool('edit', { path: 'f.txt' }, { result: resultOf('e1\ne2\ne3') });
		trackChild(c, b);
		trackChild(c, e);

		const gc = new GroupContent(b, config, theme);
		const text = gc.render(60).join("\n");
		expect(text).toContain('b1');
		expect(text).not.toContain('b2');
		expect(text).toContain('e1');
		expect(text).toContain('e3');
	});
});
