import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import { ToolExecutionComponent, initTheme } from "@earendil-works/pi-coding-agent";
import extension from '../src/index';

vi.mock('fs');

// 系統A (index.ts の prototype パッチ) による lines モードの結果描画を、
// 実 ToolExecutionComponent + 実際に登録された tool 定義で検証する
// (Pi 本体は interactive-mode.js で getRegisteredToolDefinition(name) を
//  ToolExecutionComponent に渡すため、登録定義を渡すのが実挙動に一致する)。
describe('lines-mode result rendering (patched renderer)', () => {
	const fakeUi = { requestRender: () => {} };
	let registered: Record<string, any>;

	beforeEach(() => {
		vi.resetAllMocks();
		initTheme("dark");
		registered = {};
		vi.mocked(fs.existsSync).mockReturnValue(true);
		vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
			write: { mode: 'lines' },
			edit: { mode: 'lines' },
		}));
		extension({ on: vi.fn(), registerTool: (d: any) => { registered[d.name] = d; } } as any);
	});

	const makeComponent = (toolName: string, id: string, args: any) =>
		new ToolExecutionComponent(toolName, id, args, {}, registered[toolName], fakeUi as any, process.cwd());

	const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

	it('should show the error message, not the attempted payload, when write fails (I1)', () => {
		const t = makeComponent('write', '1', { path: '/root/x.txt', content: 'SECRET_PAYLOAD' });
		t.updateResult({ content: [{ type: 'text', text: 'EACCES: permission denied' }], isError: true });
		const out = strip(t.render(80).join('\n'));
		expect(out).toContain('EACCES: permission denied');
		expect(out).not.toContain('SECRET_PAYLOAD');
	});

	it('should show the written content, not the host metadata, when write succeeds (I1)', () => {
		const t = makeComponent('write', '2', { path: '/tmp/x.txt', content: 'written line 1' });
		t.updateResult({ content: [{ type: 'text', text: 'Successfully wrote 13 bytes' }], isError: false });
		const out = strip(t.render(80).join('\n'));
		expect(out).toContain('written line 1');
		expect(out).not.toContain('Successfully wrote');
	});

	it('should not leak host metadata when the written content is empty (I3)', () => {
		const t = makeComponent('write', '3', { path: '/tmp/empty.txt', content: '' });
		t.updateResult({ content: [{ type: 'text', text: 'Successfully wrote 0 bytes to /tmp/empty.txt' }], isError: false });
		const out = strip(t.render(80).join('\n'));
		expect(out).not.toContain('Successfully wrote');
	});

	it('should show the error message when edit fails (I1)', () => {
		const t = makeComponent('edit', '4', { path: '/a.ts', edits: [{ oldText: 'foo', newText: 'bar' }] });
		t.updateResult({ content: [{ type: 'text', text: 'Could not find the exact text in /a.ts.' }], isError: true });
		const out = strip(t.render(80).join('\n'));
		expect(out).toContain('Could not find the exact text in /a.ts.');
	});
});
