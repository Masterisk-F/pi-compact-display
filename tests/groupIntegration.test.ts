import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import { Container } from '@earendil-works/pi-tui';
import { AssistantMessageComponent, UserMessageComponent, initTheme, renderDiff } from '@earendil-works/pi-coding-agent';
import { loadRenderingExtension } from './renderingHarness';
import { groupOf } from '../src/group';
import { loadConfig } from '../src/config';

vi.mock('fs');

describe('Grouping integration (registered renderers)', () => {
	let makeComponent: ReturnType<typeof loadRenderingExtension>;
	const configure = (config: any) => {
		vi.mocked(fs.existsSync).mockReturnValue(true);
		vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));
		makeComponent = loadRenderingExtension();
	};
	const result = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: false });

	beforeEach(() => {
		vi.resetAllMocks();
		initTheme('dark');
		configure({ grouping: true, bash: { mode: 'lines', outputLines: 2 }, read: { mode: 'count_only' }, write: { mode: 'lines' } });
	});

	it('should render consecutive bash calls as one card from the leader (header only)', () => {
		const c = new Container();
		const a = makeComponent('bash', '1', { command: 'echo a' });
		const b = makeComponent('bash', '2', { command: 'echo b' });
		a.updateResult(result('A1\nA2\nA3'));
		b.updateResult(result('B1'));
		c.addChild(a);
		c.addChild(b);
		const collapsed = a.render(80).join('\n');
		expect(collapsed).toContain('⚡ bash ×2');
		for (const text of ['$ echo a', '$ echo b', 'A1', 'B1']) expect(collapsed).not.toContain(text);
		expect(b.render(80)).toEqual([]);
		a.setExpanded(true);
		const expanded = a.render(80).join('\n');
		for (const text of ['⚡ bash ×2', '$ echo a', '$ echo b', 'A1', 'A2', 'A3', 'B1']) expect(expanded).toContain(text);
	});

	it('should split groups at a user-message boundary', () => {
		const c = new Container();
		const a = makeComponent('bash', '1', { command: 'echo a' });
		const b = makeComponent('bash', '2', { command: 'echo b' });
		a.updateResult(result('A'));
		b.updateResult(result('B'));
		c.addChild(a);
		c.addChild({ constructor: { name: 'UserMessageComponent' } } as any);
		c.addChild(b);
		for (const row of [a, b]) {
			const text = row.render(80).join('\n');
			expect(text).toContain('⚡ bash ×1');
			expect(text).not.toContain('$ echo');
		}
	});

	it('should clear the tracking marker and not track when addChild throws (Q2)', () => {
		const c = new Container();
		const row = makeComponent('bash', '1', { command: 'echo a' });
		const original = Container.prototype.addChild;
		Container.prototype.addChild = () => { throw new Error('boom'); };
		try {
			expect(() => c.addChild(row)).toThrow('boom');
			expect((row as any).__piCompactTrackedBy).toBeUndefined();
			expect(groupOf(row, loadConfig('/test/config.json'))).toEqual([]);
		} finally {
			Container.prototype.addChild = original;
		}
	});

	it('should track a component only once when the extension is loaded twice (Q2)', () => {
		makeComponent = loadRenderingExtension();
		const c = new Container();
		const row = makeComponent('bash', '1', { command: 'echo a' });
		row.updateResult(result('A'));
		c.addChild(row);
		expect(row.render(80).join('\n')).toContain('⚡ bash ×1');
		expect(groupOf(row, loadConfig('/test/config.json'))).toEqual([row]);
	});

	it('should NOT apply the extension renderer to default-mode tools', () => {
		configure({ fakeTool: { mode: 'default', outputLines: 2 }, bash: { mode: 'lines' } });
		const normal = makeComponent('fakeTool', '1', {});
		const compact = makeComponent('bash', '2', {});
		expect((normal as any).getRenderShell()).toBe('default');
		expect((normal as any).getResultRenderer()).toBeUndefined();
		expect((compact as any).getRenderShell()).toBe('self');
	});

	it('should render edit diff and write content on group expansion (D-07 / S8)', () => {
		configure({ grouping: true, edit: { mode: 'lines' }, write: { mode: 'lines' } });
		const c = new Container();
		const edit = makeComponent('edit', '1', { path: 'a.ts', edits: [{ oldText: 'foo', newText: 'bar' }] });
		edit.updateResult({ ...result('Successfully replaced'), details: { diff: ' 1 context\n-2 foo\n+2 bar\n 3 context' } });
		const write = makeComponent('write', '2', { path: 'b.txt', content: 'written line 1\nwritten line 2' });
		write.updateResult(result('Successfully wrote'));
		c.addChild(edit);
		c.addChild(write);
		const collapsed = edit.render(80).join('\n');
		expect(collapsed).toContain('⚡ edit ×1 write ×1');
		for (const text of ['Successfully', 'foo', 'written line']) expect(collapsed).not.toContain(text);
		edit.setExpanded(true);
		const expanded = edit.render(80).join('\n');
		for (const text of ['edit a.ts', '-2 foo', '+2 bar', 'write b.txt', 'written line 1', 'written line 2']) expect(expanded).toContain(text);
		expect(expanded).not.toContain('Successfully');
	});

	it('keeps consecutive tool groups between their actual assistant progress messages', () => {
		configure({ turnFolding: true, grouping: true, bash: { mode: 'lines' } });
		makeComponent = loadRenderingExtension(true);
		const c = new Container();
		c.addChild(new UserMessageComponent('Question'));
		const progress = (text: string, stopReason = 'toolUse') => new AssistantMessageComponent({ role: 'assistant', content: [{ type: 'text', text }], stopReason } as any);
		c.addChild(progress('STEP_ONE'));
		const a = makeComponent('bash', 'sequence-1', { command: 'echo one' });
		const b = makeComponent('bash', 'sequence-2', { command: 'echo two' });
		const d = makeComponent('bash', 'sequence-3', { command: 'echo three' });
		for (const row of [a, b, d]) row.updateResult(result('HIDDEN_TOOL_DETAIL'));
		c.addChild(a);
		c.addChild(b);
		c.addChild(progress('STEP_TWO'));
		c.addChild(d);
		c.addChild(progress('FINAL_STEP', 'stop'));
		const card = c.children.find(row => row.constructor.name === 'TurnProcessCard') as any;
		card.handleMouse({ type: 'click', button: 'left', y: 0 });
		const text = c.render(120).join('\n');
		const ordered = ['STEP_ONE', '⚡ bash ×2', 'STEP_TWO', '⚡ bash ×1', 'FINAL_STEP'].map(marker => text.indexOf(marker));
		for (let i = 0; i < ordered.length; i++) {
			expect(ordered[i]).toBeGreaterThanOrEqual(0);
			if (i) expect(ordered[i]).toBeGreaterThan(ordered[i - 1]);
		}
		expect(text).not.toContain('HIDDEN_TOOL_DETAIL');
		a.setExpanded(true);
		expect(d.render(120).join('\n')).not.toContain('HIDDEN_TOOL_DETAIL');
	});

	it('splits a live group when an empty assistant row gains text', () => {
		const c = new Container();
		const a = makeComponent('bash', 'dynamic-1', { command: 'echo before' });
		const b = makeComponent('bash', 'dynamic-2', { command: 'echo after' });
		const placeholder = new AssistantMessageComponent();
		a.updateResult(result('before result'));
		b.updateResult(result('after result'));
		c.addChild(a);
		c.addChild(placeholder);
		c.addChild(b);
		expect(c.render(120).join('\n')).toContain('⚡ bash ×2');
		placeholder.updateContent({ role: 'assistant', content: [{ type: 'text', text: 'STREAMED_BOUNDARY' }], stopReason: 'pending' } as any, true);
		const text = c.render(120).join('\n');
		expect(text).not.toContain('⚡ bash ×2');
		expect(text.match(/⚡ bash ×1/g)).toHaveLength(2);
		expect(text.indexOf('STREAMED_BOUNDARY')).toBeGreaterThan(text.indexOf('⚡ bash ×1'));
		expect(text.lastIndexOf('⚡ bash ×1')).toBeGreaterThan(text.indexOf('STREAMED_BOUNDARY'));
	});

	it('keeps the call and text note of an image-result tool outside the group', () => {
		const c = new Container();
		const a = makeComponent('bash', 'image-1', { command: 'echo before' });
		const image = makeComponent('bash', 'image-2', { command: 'render image' });
		const b = makeComponent('bash', 'image-3', { command: 'echo after' });
		a.updateResult(result('before result'));
		image.updateResult({ content: [{ type: 'text', text: 'IMAGE_RESULT_NOTE' }, { type: 'image', data: '', mimeType: 'image/png' }], isError: false });
		b.updateResult(result('after result'));
		for (const row of [a, image, b]) c.addChild(row);
		const text = c.render(120).join('\n');
		expect(text.match(/⚡ bash ×1/g)).toHaveLength(2);
		expect(text).toContain('$ render image');
		expect(text).toContain('IMAGE_RESULT_NOTE');
		expect(text.indexOf('$ render image')).toBeGreaterThan(text.indexOf('⚡ bash ×1'));
		expect(text.lastIndexOf('⚡ bash ×1')).toBeGreaterThan(text.indexOf('IMAGE_RESULT_NOTE'));
	});

	it('should colorize edit diff added/removed lines in group expansion (S5)', () => {
		configure({ grouping: true, edit: { mode: 'lines' } });
		const c = new Container();
		const edit = makeComponent('edit', '1', { path: 'a.ts' });
		edit.updateResult({ ...result('Successfully replaced'), details: { diff: ' 1 context\n-2 foo\n+2 bar\n 3 context' } });
		c.addChild(edit);
		edit.setExpanded(true);
		const lines = edit.render(80);
		const remove = lines.find(line => line.includes('-2 foo'));
		const add = lines.find(line => line.includes('+2 bar'));
		expect(remove).toContain(renderDiff('-2 foo'));
		expect(add).toContain(renderDiff('+2 bar'));
	});
});
