import { describe, it, expect, beforeEach } from 'vitest';
import { colorizeResult } from '../src/renderUtils';
import { initTheme } from '@earendil-works/pi-coding-agent';

describe('colorizeResult (diff coloring for edit)', () => {
	const fakeTheme = {
		fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
	};

	beforeEach(() => {
		initTheme('dark');
	});

	it('should colorize - lines and + lines differently for edit tool (S1)', () => {
		const diff = ' 1 alpha\n-2 bravo\n+2 BRAVO\n 3 charlie';
		const out = colorizeResult('edit', diff, fakeTheme);
		const lines = out.split('\n');

		// 削除行(-) と 追加行(+) の ANSI カラーコードが異なること
		expect(lines[1]).toContain('-2 bravo');
		expect(lines[2]).toContain('+2 BRAVO');
		const removeColor = lines[1].match(/\x1b\[38;2;(\d+;\d+;\d+)m/)?.[1];
		const addColor = lines[2].match(/\x1b\[38;2;(\d+;\d+;\d+)m/)?.[1];
		expect(removeColor).toBeDefined();
		expect(addColor).toBeDefined();
		expect(removeColor).not.toBe(addColor);
		// 具体的な RGB 値はテーマ定義 (dark.json) に依存し、Pi 1.0 で hex から okhsl 表記へ
		// 変わったため版ごとに異なる。ここでは「トークンごとに別の色が当たっている」ことだけを検証する。
		const contextColorS1 = lines[0].match(/\x1b\[38;2;(\d+;\d+;\d+)m/)?.[1];
		expect(removeColor).not.toBe(contextColorS1);
		expect(addColor).not.toBe(contextColorS1);
	});

	it('should colorize context lines with context color for edit tool (S2)', () => {
		const diff = ' 1 alpha\n-2 bravo\n+2 BRAVO\n 3 charlie';
		const out = colorizeResult('edit', diff, fakeTheme);
		const lines = out.split('\n');
		const contextColor = lines[0].match(/\x1b\[38;2;(\d+;\d+;\d+)m/)?.[1];
		const removeColor = lines[1].match(/\x1b\[38;2;(\d+;\d+;\d+)m/)?.[1];
		expect(contextColor).toBeDefined();
		expect(contextColor).not.toBe(removeColor); // context は削除行とは別トークン
	});

	it('should colorize diff with gap lines (...) without crashing (S3)', () => {
		const diff = '   96 Line 96\n   97 Line 97\n-100 old\n+100 new\n  101 Line 101\n     ...\n  104 Line 104';
		const out = colorizeResult('edit', diff, fakeTheme);
		const lines = out.split('\n');
		expect(lines.length).toBe(7);
		const removeColor = lines[2].match(/\x1b\[38;2;(\d+;\d+;\d+)m/)?.[1];
		const addColor = lines[3].match(/\x1b\[38;2;(\d+;\d+;\d+)m/)?.[1];
		expect(removeColor).toBeDefined();
		expect(addColor).toBeDefined();
		expect(removeColor).not.toBe(addColor);
	});

	it('should NOT colorize +/- lines for non-edit tools (S4)', () => {
		const text = '+added-like line\n-removed-like line\nnormal line';
		const out = colorizeResult('bash', text, fakeTheme);
		// 全行が一律 theme.fg("toolOutput", line) で塗られていること
		expect(out).toBe('[toolOutput]+added-like line[/toolOutput]\n[toolOutput]-removed-like line[/toolOutput]\n[toolOutput]normal line[/toolOutput]');
	});

	it('should preserve visible text after stripping ANSI (S3)', () => {
		const diff = ' 1 alpha\n-2 bravo\n+2 BRAVO\n 3 charlie';
		const out = colorizeResult('edit', diff, fakeTheme);
		const stripped = out.replace(/\x1b\[[0-9;]*m/g, '');
		expect(stripped).toBe(diff);
	});

	it('should handle empty string without error', () => {
		expect(colorizeResult('edit', '', fakeTheme)).toBe('');
		expect(colorizeResult('bash', '', fakeTheme)).toBe('');
	});
});
