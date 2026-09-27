import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import { Container } from "@earendil-works/pi-tui";
import { ToolExecutionComponent, initTheme } from "@earendil-works/pi-coding-agent";
import extension from '../src/index';
import { groupOf } from '../src/group';
import { loadConfig } from '../src/config';

vi.mock('fs');

// 実 ToolExecutionComponent + パッチ済み renderer / addChild ミラーを使った
// グループ表示の統合テスト。
describe('Grouping integration (patched renderers)', () => {
	const fakeUi = { requestRender: () => {} };

	beforeEach(() => {
		vi.resetAllMocks();
		initTheme("dark"); // グローバル theme を初期化 (失敗時は dark にフォールバック)
		vi.mocked(fs.existsSync).mockReturnValue(true);
		vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
			grouping: true,
			bash: { mode: 'lines', outputLines: 2 },
			read: { mode: 'count_only' },
			write: { mode: 'lines' },
		}));
		extension({ on: vi.fn(), registerTool: vi.fn() } as any);
	});

	const makeComponent = (toolName: string, id: string, args: any) =>
		new ToolExecutionComponent(toolName, id, args, {}, undefined as any, fakeUi as any, process.cwd());

	it('should render consecutive bash calls as one card from the leader (header only)', () => {
		const c = new Container();
		const t1 = makeComponent('bash', '1', { command: 'echo a' });
		const t2 = makeComponent('bash', '2', { command: 'echo b' });
		t1.updateResult({ content: [{ type: 'text', text: 'A1\nA2\nA3' }], isError: false });
		t2.updateResult({ content: [{ type: 'text', text: 'B1' }], isError: false });
		c.addChild(t1);
		c.addChild(t2);

		const leaderLines = t1.render(60);
		expect(leaderLines.length).toBeGreaterThan(0);
		const text = leaderLines.join('\n');
		expect(text).toContain('⚡ bash ×2');
		// デフォルトでは集約ヘッダーのみ (コマンド行・出力は出ない)
		expect(text).not.toContain('$ echo a');
		expect(text).not.toContain('A1');
		expect(text).not.toContain('$ echo b');
		expect(text).not.toContain('B1');

		// 非リーダーは描画しない
		expect(t2.render(60).length).toBe(0);

		// 展開時はコマンド行 + 全出力が表示される
		t1.setExpanded(true);
		const expandedText = t1.render(60).join('\n');
		expect(expandedText).toContain('⚡ bash ×2');
		expect(expandedText).toContain('$ echo a');
		expect(expandedText).toContain('A1');
		expect(expandedText).toContain('A2');
		expect(expandedText).toContain('A3');
		expect(expandedText).toContain('$ echo b');
		expect(expandedText).toContain('B1');
	});

	it('should split groups at a user-message boundary', () => {
		const c = new Container();
		const t1 = makeComponent('bash', '1', { command: 'echo a' });
		t1.updateResult({ content: [{ type: 'text', text: 'A' }], isError: false });
		// 実装と同じ判定基準 (constructor.name) を持つ擬似ユーザーメッセージ境界
		const boundary = { constructor: { name: 'UserMessageComponent' } };
		const t2 = makeComponent('bash', '2', { command: 'echo b' });
		t2.updateResult({ content: [{ type: 'text', text: 'B' }], isError: false });

		c.addChild(t1);
		c.addChild(boundary);
		c.addChild(t2);


		// t1 は単独グループ (境界で分割): ⚡ bash ×1・コマンド行なし・t2 を含まない
		const text1 = t1.render(60).join('\n');
		expect(text1).toContain('⚡ bash ×1');
		expect(text1).not.toContain('$ echo a');
		expect(text1).not.toContain('$ echo b');

		// t2 も単独グループ
		const text2 = t2.render(60).join('\n');
		expect(text2).toContain('⚡ bash ×1');
		expect(text2).not.toContain('$ echo b');
	});

	it('should clear the tracking marker and not track when addChild throws (Q2)', () => {
		const origAddChild = Container.prototype.addChild;
		Container.prototype.addChild = () => { throw new Error('boom'); };
		try {
			const c = new Container();
			const t = makeComponent('bash', '1', { command: 'echo a' });
			expect(() => c.addChild(t)).toThrow('boom');
			expect((t as any).__piCompactTrackedBy).toBeUndefined();

			const config = loadConfig('/test/config.json');
			expect(groupOf(t, config)).toEqual([]);
		} finally {
			Container.prototype.addChild = origAddChild;
		}
	});

	it('should track a component only once when the extension is loaded twice (Q2)', () => {
		// 再ロード (二重読み込み) をシミュレート
		extension({ on: vi.fn(), registerTool: vi.fn() } as any);

		const c = new Container();
		const t = makeComponent('bash', '1', { command: 'echo a' });
		t.updateResult({ content: [{ type: 'text', text: 'A' }], isError: false });
		c.addChild(t);

		const text = t.render(60).join('\n');
		expect(text).toContain('⚡ bash ×1');
		expect(text).not.toContain('⚡ bash ×2');

		const config = loadConfig('/test/config.json');
		expect(groupOf(t, config)).toEqual([t]);
	});

	it('should NOT apply the extension renderer to default-mode tools (D1 revert)', () => {
		vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
			fakeTool: { mode: 'default', outputLines: 2 },
			bash: { mode: 'lines' },
		}));
		// loadConfig が新しい mock の json を読むようにコンポーネントを生成
		const tDefault = makeComponent('fakeTool', '1', {});
		const tLines = makeComponent('bash', '2', {});

		const c = new Container();
		c.addChild(tDefault);
		c.addChild(tLines);

		// default モードは "self" シェルを強制されず、フォーマッタも登録されない
		expect(tDefault.getRenderShell()).toBe('default');
		expect(tDefault.getResultRenderer()).toBeUndefined(); // mock では origRenderer は undefined

		// lines モードは "self" シェルになる
		expect(tLines.getRenderShell()).toBe('self');
	});

	it('should render edit diff and write content on group expansion (D-07 / S8)', () => {
		vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
			grouping: true,
			edit: { mode: 'lines' },
			write: { mode: 'lines' },
		}));
		extension({ on: vi.fn(), registerTool: vi.fn() } as any);

		const c = new Container();
		const tEdit = makeComponent('edit', '1', { path: 'a.ts', edits: [{ oldText: 'foo', newText: 'bar' }] });
		tEdit.updateResult({
			content: [{ type: 'text', text: 'Successfully replaced 1 block(s) in a.ts.' }],
			details: { diff: ' 1 context\n-2 foo\n+2 bar\n 3 context' },
			isError: false,
		});

		const tWrite = makeComponent('write', '2', { path: 'b.txt', content: 'written line 1\nwritten line 2' });
		tWrite.updateResult({
			content: [{ type: 'text', text: 'Successfully wrote 29 bytes to b.txt' }],
			isError: false,
		});

		c.addChild(tEdit);
		c.addChild(tWrite);

		// 通常時: グループヘッダーのみ
		const normalText = tEdit.render(60).join('\n');
		expect(normalText).toContain('⚡ edit ×1 write ×1');
		expect(normalText).not.toContain('Successfully replaced');
		expect(normalText).not.toContain('foo');

		// 展開時: edit は diff、write は args.content が表示される
		tEdit.setExpanded(true);
		const expandedText = tEdit.render(60).join('\n');
		expect(expandedText).toContain('edit a.ts');
		expect(expandedText).toContain('-2 foo');
		expect(expandedText).toContain('+2 bar');
		expect(expandedText).not.toContain('Successfully replaced');

		expect(expandedText).toContain('write b.txt');
		expect(expandedText).toContain('written line 1');
		expect(expandedText).toContain('written line 2');
		expect(expandedText).not.toContain('Successfully wrote');
	});

	it('should colorize edit diff added/removed lines in group expansion (S5)', () => {
		vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
			grouping: true,
			edit: { mode: 'lines' },
		}));
		extension({ on: vi.fn(), registerTool: vi.fn() } as any);

		const c = new Container();
		const tEdit = makeComponent('edit', '1', { path: 'a.ts', edits: [{ oldText: 'foo', newText: 'bar' }] });
		tEdit.updateResult({
			content: [{ type: 'text', text: 'Successfully replaced 1 block(s) in a.ts.' }],
			details: { diff: ' 1 context\n-2 foo\n+2 bar\n 3 context' },
			isError: false,
		});
		c.addChild(tEdit);

		tEdit.setExpanded(true);
		const rawLines = tEdit.render(60);
		const removeLine = rawLines.find((l: string) => l.includes('-2 foo'));
		const addLine = rawLines.find((l: string) => l.includes('+2 bar'));

		expect(removeLine).toBeDefined();
		expect(addLine).toBeDefined();

		// - 行 (赤) と + 行 (緑) で ANSI カラーコードが異なること
		const removeColor = removeLine?.match(/\x1b\[38;2;(\d+;\d+;\d+)m/)?.[1];
		const addColor = addLine?.match(/\x1b\[38;2;(\d+;\d+;\d+)m/)?.[1];
		expect(removeColor).toBe('204;102;102'); // 赤
		expect(addColor).toBe('181;189;104');    // 緑
	});
});
