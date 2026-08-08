import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import { Container } from "@earendil-works/pi-tui";
import { ToolExecutionComponent, initTheme } from "@earendil-works/pi-coding-agent";
import extension from '../src/index';

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
});
