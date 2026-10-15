import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { Container, Text, resetCapabilitiesCache, setCapabilities, visibleWidth } from '@earendil-works/pi-tui';
import { AssistantMessageComponent, UserMessageComponent, initTheme } from '@earendil-works/pi-coding-agent';
import { loadRenderingExtension } from './renderingHarness';
import extension from '../src/index';
import { beginTurnFolding, collapseTurnFolding, configureTurnFolding, settleTurnFolding } from '../src/turn';

vi.mock('node:fs');
vi.mock('fs');

const message = (text: string, stopReason = 'toolUse') => ({
	role: 'assistant' as const,
	content: [{ type: 'text' as const, text }],
	stopReason,
});
const assistant = (text: string, stopReason = 'toolUse') => new AssistantMessageComponent(message(text, stopReason) as any);
const cards = (chat: Container) => chat.children.filter(row => row.constructor.name === 'TurnProcessCard') as any[];

describe('Whole-turn process folding', () => {
	let makeTool: ReturnType<typeof loadRenderingExtension>;
	const chats: Container[] = [];
	const createChat = () => {
		const chat = new Container();
		chats.push(chat);
		return chat;
	};

	beforeEach(() => {
		vi.resetAllMocks();
		initTheme('dark');
		vi.mocked(fs.existsSync).mockReturnValue(true);
		vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
			turnFolding: true,
			grouping: true,
			default: { mode: 'lines', noPadding: true },
			read: { mode: 'count_only' },
		}));
		makeTool = loadRenderingExtension(true);
	});
	afterEach(() => {
		configureTurnFolding(false);
		for (const chat of chats) chat.clear();
		chats.length = 0;
		resetCapabilitiesCache();
	});

	it('folds progress and tools during execution while keeping the latest work visible', () => {
		beginTurnFolding();
		const chat = createChat();
		chat.addChild(new UserMessageComponent('Implement this feature'));
		chat.addChild(assistant('OLD_PROGRESS: inspecting the implementation'));
		const tool = makeTool('bash', 'tool-1', { command: 'echo RAW_TOOL_OUTPUT' });
		tool.updateResult({ content: [{ type: 'text', text: 'RAW_TOOL_OUTPUT' }], isError: false });
		chat.addChild(tool);
		chat.addChild(assistant('LATEST_PROGRESS: checking the tests'));
		const text = chat.render(120).join('\n');
		expect(cards(chat)).toHaveLength(1);
		expect(text).toContain('执行过程');
		expect(text).toContain('进行中');
		expect(text).toContain('当前：LATEST_PROGRESS');
		expect(text).not.toContain('OLD_PROGRESS');
		expect(text).not.toContain('RAW_TOOL_OUTPUT');
		// A terminal model response alone is not the settlement boundary: retries or
		// extensions may still continue the same run.
		chat.addChild(assistant('FINAL_RESULT', 'stop'));
		expect(chat.render(120).join('\n')).toContain('进行中');
		expect(chat.render(120).join('\n')).toContain('当前：FINAL_RESULT');
		settleTurnFolding(false);
		const folded = chat.render(120).join('\n');
		expect(folded).toContain('执行过程');
		expect(folded).toContain('已完成');
		expect(folded).toContain('FINAL_RESULT');
		expect(folded).not.toContain('OLD_PROGRESS');
		expect(folded).not.toContain('RAW_TOOL_OUTPUT');
		expect(chat.children).toContain(tool);
	});

	it('keeps the final answer visible without modifying any assistant message', () => {
		const chat = createChat();
		chat.addChild(new UserMessageComponent('Question'));
		const progress = message('MIDWAY');
		const answer = message('FINAL_RESULT\nAll checks passed.', 'stop');
		chat.addChild(new AssistantMessageComponent(progress as any));
		chat.addChild(new AssistantMessageComponent(answer as any));
		const text = chat.render(120).join('\n');
		expect(text).toContain('已完成');
		expect(text).toContain('FINAL_RESULT');
		expect(text).not.toContain('MIDWAY');
		expect(answer).toEqual(message('FINAL_RESULT\nAll checks passed.', 'stop'));
		expect(progress).toEqual(message('MIDWAY'));
	});

	it('updates a single current-work preview during streaming, then shows the completed answer', () => {
		beginTurnFolding();
		const chat = createChat();
		chat.addChild(new UserMessageComponent('Question'));
		const row = assistant('STREAMING_ONE', 'pending');
		chat.addChild(row);
		row.updateContent(message('STREAMING_ONE', 'pending') as any, true);
		expect(chat.render(120).join('\n')).toContain('当前：STREAMING_ONE');
		row.updateContent(message('STREAMING_TWO', 'pending') as any, true);
		const update = chat.render(120).join('\n');
		expect(update).toContain('当前：STREAMING_TWO');
		expect(update).not.toContain('STREAMING_ONE');
		row.updateContent(message('FINAL_STREAM', 'stop') as any, false);
		settleTurnFolding(false);
		expect(chat.render(120).join('\n')).toContain('FINAL_STREAM');
		expect(chat.render(120).join('\n')).not.toContain('当前：');
	});

	it('expands progress without overriding count_only tools, and can fold again', () => {
		const chat = createChat();
		chat.addChild(new UserMessageComponent('Question'));
		chat.addChild(assistant('EARLY_STEP'));
		const read = makeTool('read', 'read-1', { path: 'notes.txt' });
		read.updateResult({ content: [{ type: 'text', text: 'FULL_READ_CONTENT' }], isError: false });
		chat.addChild(read);
		chat.addChild(assistant('FINAL_ANSWER', 'stop'));
		expect(chat.render(120).join('\n')).not.toContain('FULL_READ_CONTENT');
		cards(chat)[0].handleMouse({ type: 'click', button: 'left', y: 0 });
		const expanded = chat.render(120).join('\n');
		for (const text of ['EARLY_STEP', 'FINAL_ANSWER']) expect(expanded).toContain(text);
		expect(expanded).not.toContain('read notes.txt');
		expect(expanded).not.toContain('FULL_READ_CONTENT');
		expect((read as any).expanded).toBe(false);
		cards(chat)[0].handleMouse({ type: 'click', button: 'left', y: 0 });
		const folded = chat.render(120).join('\n');
		expect(folded).not.toContain('EARLY_STEP');
		expect(folded).not.toContain('FULL_READ_CONTENT');
		expect(folded).toContain('FINAL_ANSWER');
	});

	it.each(['error', 'aborted', 'length'])('keeps a terminal %s visible', reason => {
		const chat = createChat();
		chat.addChild(new UserMessageComponent('Question'));
		chat.addChild(assistant('PROGRESS'));
		const failed = { ...message('Partial response', reason), errorMessage: 'terminal failure' };
		chat.addChild(new AssistantMessageComponent(failed as any));
		const text = chat.render(120).join('\n');
		expect(text).toContain('Partial response');
		expect(text).toContain(reason === 'error' ? 'terminal failure' : reason === 'aborted' ? 'terminal failure' : 'truncated');
		expect(text).not.toContain('PROGRESS');
	});

	it('reports failed tools even when a later final answer succeeds', () => {
		const chat = createChat();
		chat.addChild(new UserMessageComponent('Question'));
		const tool = makeTool('bash', 'failed-tool', { command: 'failed command' });
		tool.updateResult({ content: [{ type: 'text', text: 'ERROR_DETAIL' }], isError: true });
		chat.addChild(tool);
		chat.addChild(assistant('Recovered final answer', 'stop'));
		expect(chat.render(120).join('\n')).toContain('1 次工具失败');
		cards(chat)[0].handleMouse({ type: 'click', button: 'left', y: 0 });
		expect(chat.render(120).join('\n')).not.toContain('ERROR_DETAIL');
		tool.setExpanded(true);
		expect(chat.render(120).join('\n')).toContain('ERROR_DETAIL');
	});

	it('splits cards at user messages and leaves unrelated UI rows visible', () => {
		const chat = createChat();
		for (const id of [1, 2]) {
			chat.addChild(new UserMessageComponent(`Question ${id}`));
			chat.addChild(assistant(`PROGRESS_${id}`));
			chat.addChild(assistant(`ANSWER_${id}`, 'stop'));
		}
		chat.addChild(new Text('IMPORTANT_UI_WARNING', 0, 0));
		expect(cards(chat)).toHaveLength(2);
		cards(chat)[0].handleMouse({ type: 'click', button: 'left', y: 0 });
		const text = chat.render(120).join('\n');
		for (const visible of ['Question 1', 'Question 2', 'ANSWER_1', 'ANSWER_2', 'PROGRESS_1', 'IMPORTANT_UI_WARNING']) expect(text).toContain(visible);
		expect(text).not.toContain('PROGRESS_2');
	});

	it('preserves image-result rows instead of hiding their previews', () => {
		const chat = createChat();
		chat.addChild(new UserMessageComponent('Question'));
		const tool = makeTool('bash', 'image-tool', { command: 'image operation' });
		setCapabilities({ images: 'kitty', trueColor: true, hyperlinks: false });
		const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=';
		tool.updateResult({ content: [{ type: 'text', text: 'IMAGE_NOTE' }, { type: 'image', data: png, mimeType: 'image/png' }], isError: false });
		chat.addChild(tool);
		expect(chat.render(120).some(line => line.includes('\u001b_G'))).toBe(true);
		expect((tool as any).result.content[1].data).toBe(png);
	});

	it('supports clicking a completed header and constrains its width', () => {
		const chat = createChat();
		chat.addChild(new UserMessageComponent('Question'));
		chat.addChild(assistant('早期消息'));
		chat.addChild(assistant('长进度'.repeat(150)));
		chat.addChild(assistant('最终回复', 'stop'));
		const card = cards(chat)[0];
		const lines = card.render(40);
		expect(lines).toHaveLength(1);
		for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(40);
		expect(card.handleMouse({ type: 'click', button: 'left', y: 0 })).toEqual({ handled: true });
		expect(chat.render(80).join('\n')).toContain('早期消息');
	});

	it('cleans up on disable and rebuilds one card after reload/replay', () => {
		const chat = createChat();
		chat.addChild(new UserMessageComponent('Question'));
		const row = assistant('RESTORABLE_PROGRESS');
		chat.addChild(row);
		configureTurnFolding(false);
		expect(cards(chat)).toHaveLength(0);
		expect(chat.render(120).join('\n')).toContain('RESTORABLE_PROGRESS');
		makeTool = loadRenderingExtension(true);
		expect(cards(chat)).toHaveLength(1);
		chat.addChild(assistant('RESTORABLE_FINAL', 'stop'));
		expect(chat.render(120).join('\n')).not.toContain('RESTORABLE_PROGRESS');
		chat.clear();
		chat.addChild(new UserMessageComponent('Restored question'));
		chat.addChild(assistant('RESTORED_PROGRESS'));
		chat.addChild(assistant('RESTORED_FINAL', 'stop'));
		expect(cards(chat)).toHaveLength(1);
		expect(chat.render(120).join('\n')).toContain('RESTORED_FINAL');
		expect(chat.render(120).join('\n')).not.toContain('RESTORED_PROGRESS');
	});

	it('does not create process cards for a simple final-only answer or when disabled', () => {
		const chat = createChat();
		chat.addChild(new UserMessageComponent('Question'));
		chat.addChild(assistant('SIMPLE_FINAL', 'stop'));
		expect(chat.render(120).join('\n')).not.toContain('执行过程');
		configureTurnFolding(false);
		chat.clear();
		chat.addChild(new UserMessageComponent('Question'));
		chat.addChild(assistant('UNFOLDED_PROGRESS'));
		expect(cards(chat)).toHaveLength(0);
		expect(chat.render(120).join('\n')).toContain('UNFOLDED_PROGRESS');
	});

	it('collapses every opened process card and never expands already folded cards', () => {
		const chat = createChat();
		for (const id of [1, 2, 3]) {
			chat.addChild(new UserMessageComponent(`Finished question ${id}`));
			chat.addChild(assistant(`COMPLETED_DETAIL_${id}`));
			chat.addChild(assistant(`COMPLETED_ANSWER_${id}`, 'stop'));
		}
		cards(chat)[0].handleMouse({ type: 'click', button: 'left', y: 0 });
		cards(chat)[1].handleMouse({ type: 'click', button: 'left', y: 0 });
		const expanded = chat.render(120).join('\n');
		expect(expanded).toContain('COMPLETED_DETAIL_1');
		expect(expanded).toContain('COMPLETED_DETAIL_2');
		expect(expanded).not.toContain('COMPLETED_DETAIL_3');
		beginTurnFolding();
		chat.addChild(new UserMessageComponent('Running question'));
		chat.addChild(assistant('RUNNING_DETAIL'));
		expect(collapseTurnFolding()).toBe(2);
		for (let i = 0; i < 3; i++) expect(collapseTurnFolding()).toBe(0);
		const text = chat.render(120).join('\n');
		for (const id of [1, 2, 3]) {
			expect(text).not.toContain(`COMPLETED_DETAIL_${id}`);
			expect(text).toContain(`COMPLETED_ANSWER_${id}`);
		}
		expect(text).toContain('当前：RUNNING_DETAIL');
		expect(cards(chat)[3].handleMouse({ type: 'click', button: 'left', y: 0 })).toEqual({ handled: true });
		const open = chat.render(120).join('\n');
		expect(open).toContain('RUNNING_DETAIL');
		expect(open).not.toContain('当前：RUNNING_DETAIL');
		expect(collapseTurnFolding()).toBe(1);
		expect(collapseTurnFolding()).toBe(0);
		expect(chat.render(120).join('\n')).toContain('当前：RUNNING_DETAIL');
	});

	it('does not expose a native global expansion hook on process cards', () => {
		const chat = createChat();
		chat.addChild(new UserMessageComponent('Question'));
		chat.addChild(assistant('HIDDEN_PROGRESS'));
		const tool = makeTool('bash', 'native-1', { command: 'echo RAW_DETAIL' });
		tool.updateResult({ content: [{ type: 'text', text: 'RAW_DETAIL' }], isError: false });
		chat.addChild(tool);
		chat.addChild(assistant('FINAL_ANSWER', 'stop'));
		expect(cards(chat)[0]).not.toHaveProperty('setExpanded');
		// Replay Pi's native Ctrl+O dispatch: only top-level expandable components.
		for (const child of chat.children as any[]) child.setExpanded?.(true);
		const text = chat.render(120).join('\n');
		expect(text).not.toContain('HIDDEN_PROGRESS');
		expect(text).not.toContain('RAW_DETAIL');
		expect(text).toContain('FINAL_ANSWER');
	});

	it('automatically refolds a finished run even if it was expanded before completion', () => {
		beginTurnFolding();
		const chat = createChat();
		chat.addChild(new UserMessageComponent('Question'));
		chat.addChild(assistant('DETAIL'));
		expect(cards(chat)[0].handleMouse({ type: 'click', button: 'left', y: 0 })).toEqual({ handled: true });
		expect(chat.render(120).join('\n')).toContain('DETAIL');
		expect(chat.render(120).join('\n')).not.toContain('当前：');
		chat.addChild(assistant('ANSWER', 'stop'));
		settleTurnFolding(false);
		expect(chat.render(120).join('\n')).not.toContain('DETAIL');
		expect(chat.render(120).join('\n')).toContain('ANSWER');
	});

	it('allows a running card to open, retain new streaming/tool detail, and close again', () => {
		beginTurnFolding();
		const chat = createChat();
		chat.addChild(new UserMessageComponent('Question'));
		chat.addChild(assistant('EARLIER_RUNNING_STEP'));
		const row = assistant('CURRENT_RUNNING_STEP', 'pending');
		row.updateContent(message('CURRENT_RUNNING_STEP', 'pending') as any, true);
		chat.addChild(row);
		const tool = makeTool('bash', 'running-bash', { command: 'echo details' });
		tool.updateResult({ content: [{ type: 'text', text: 'PARTIAL_TOOL_DETAIL' }], isError: false }, true);
		chat.addChild(tool);
		const card = cards(chat)[0];
		expect(card.handleMouse({ type: 'click', button: 'right', y: 0 })).toBeUndefined();
		expect(card.handleMouse({ type: 'click', button: 'left', y: 1 })).toBeUndefined();
		expect(card.handleMouse({ type: 'click', button: 'left', y: 0 })).toEqual({ handled: true });
		const open = chat.render(120).join('\n');
		for (const text of ['EARLIER_RUNNING_STEP', 'CURRENT_RUNNING_STEP', '⚡ bash ×1']) expect(open).toContain(text);
		expect(open).not.toContain('PARTIAL_TOOL_DETAIL');
		expect((tool as any).expanded).toBe(false);
		expect(open).not.toContain('当前：');
		row.updateContent(message('UPDATED_RUNNING_STEP', 'pending') as any, true);
		tool.updateResult({ content: [{ type: 'text', text: 'COMPLETE_TOOL_DETAIL' }], isError: false });
		chat.addChild(assistant('LATER_RUNNING_STEP'));
		const update = chat.render(120).join('\n');
		for (const text of ['UPDATED_RUNNING_STEP', '⚡ bash ×1', 'LATER_RUNNING_STEP']) expect(update).toContain(text);
		expect(update).not.toContain('COMPLETE_TOOL_DETAIL');
		expect((tool as any).expanded).toBe(false);
		expect(card.isExpanded()).toBe(true);
		expect(card.handleMouse({ type: 'click', button: 'left', y: 0 })).toEqual({ handled: true });
		const folded = chat.render(120).join('\n');
		expect(folded).toContain('当前：LATER_RUNNING_STEP');
		expect(folded).not.toContain('EARLIER_RUNNING_STEP');
		expect(folded).not.toContain('COMPLETE_TOOL_DETAIL');
	});

	it('keeps the live preview short and sanitized on narrow terminals', () => {
		beginTurnFolding();
		const chat = createChat();
		chat.addChild(new UserMessageComponent('Question'));
		chat.addChild(assistant('OLD_STEP'));
		chat.addChild(assistant('\u001b]8;;https://example.com\u0007最新工作\u001b]8;;\u0007'.repeat(100)));
		const lines = cards(chat)[0].render(40);
		expect(lines).toHaveLength(2);
		expect(lines[1]).toContain('当前：最新工作');
		// truncateToWidth may add safe SGR resets; original OSC links must not pass through.
		expect(lines[1]).not.toContain('\u001b]');
		expect(lines[1]).not.toContain('https://example.com');
		for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(40);
	});

	it('does not relabel or refold an older completed turn when a later run is cancelled', () => {
		const chat = createChat();
		chat.addChild(new UserMessageComponent('Old question'));
		chat.addChild(assistant('OLD_DETAIL'));
		chat.addChild(assistant('OLD_ANSWER', 'stop'));
		const oldCard = cards(chat)[0];
		oldCard.handleMouse({ type: 'click', button: 'left', y: 0 });
		beginTurnFolding();
		chat.addChild(new UserMessageComponent('Later question'));
		chat.addChild(assistant('LATER_DETAIL'));
		settleTurnFolding(true);
		expect(oldCard.isExpanded()).toBe(true);
		expect(oldCard.render(120).join('\n')).toContain('已完成');
		expect(oldCard.render(120).join('\n')).not.toContain('已取消');
		expect(cards(chat)[1].render(120).join('\n')).toContain('已取消');
	});

	it('ignores settlement when no new row belongs to that run', () => {
		const chat = createChat();
		chat.addChild(new UserMessageComponent('Historical question'));
		chat.addChild(assistant('HISTORICAL_DETAIL'));
		chat.addChild(assistant('HISTORICAL_ANSWER', 'stop'));
		const card = cards(chat)[0];
		card.handleMouse({ type: 'click', button: 'left', y: 0 });
		beginTurnFolding();
		settleTurnFolding(true);
		expect(card.isExpanded()).toBe(true);
		expect(card.render(120).join('\n')).toContain('已完成');
		expect(card.render(120).join('\n')).not.toContain('已取消');
	});

	it('keeps grouped tools folded when the outer process opens', () => {
		const chat = createChat();
		chat.addChild(new UserMessageComponent('Question'));
		chat.addChild(assistant('GROUPED_PROGRESS'));
		const a = makeTool('bash', 'group-1', { command: 'echo TOOL_A' });
		const b = makeTool('bash', 'group-2', { command: 'echo TOOL_B' });
		a.updateResult({ content: [{ type: 'text', text: 'TOOL_A' }], isError: false });
		b.updateResult({ content: [{ type: 'text', text: 'TOOL_B' }], isError: false });
		chat.addChild(a);
		chat.addChild(b);
		chat.addChild(assistant('GROUPED_FINAL', 'stop'));
		cards(chat)[0].handleMouse({ type: 'click', button: 'left', y: 0 });
		const open = chat.render(120).join('\n');
		expect(open).toContain('GROUPED_PROGRESS');
		expect(open.match(/⚡ bash ×2/g)).toHaveLength(1);
		expect(open).not.toContain('TOOL_A');
		expect(open).not.toContain('TOOL_B');
		expect((a as any).expanded).toBe(false);
		expect((b as any).expanded).toBe(false);
	});

	it('preserves per-tool line limits and grouping exclusions inside an open process', () => {
		vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
			turnFolding: true, grouping: true,
			bash: { mode: 'lines', outputLines: 1, grouping: false, noPadding: true },
		}));
		makeTool = loadRenderingExtension(true);
		const chat = createChat();
		chat.addChild(new UserMessageComponent('Question'));
		const tool = makeTool('bash', 'limited', { command: 'echo limited' });
		tool.updateResult({ content: [{ type: 'text', text: 'VISIBLE_LINE\nHIDDEN_LINE' }], isError: false });
		chat.addChild(tool);
		chat.addChild(assistant('LIMITED_FINAL', 'stop'));
		cards(chat)[0].handleMouse({ type: 'click', button: 'left', y: 0 });
		const open = chat.render(120).join('\n');
		expect(open).toContain('$ echo limited');
		expect(open).toContain('VISIBLE_LINE');
		expect(open).not.toContain('HIDDEN_LINE');
		expect(open).not.toContain('⚡ bash');
	});

	it('does not replace default-mode tool renderers when the process opens', () => {
		vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ turnFolding: true, bash: { mode: 'default' } }));
		makeTool = loadRenderingExtension(true);
		const chat = createChat();
		chat.addChild(new UserMessageComponent('Question'));
		const renderCall = vi.fn(() => new Text('ORIGINAL_CALL', 0, 0));
		const renderResult = vi.fn(() => new Text('ORIGINAL_RESULT', 0, 0));
		const tool = makeTool('bash', 'original', {}, { renderCall, renderResult, renderShell: 'self' });
		tool.updateResult({ content: [{ type: 'text', text: 'RAW_ORIGINAL' }], isError: false });
		chat.addChild(tool);
		chat.addChild(assistant('ORIGINAL_FINAL', 'stop'));
		cards(chat)[0].handleMouse({ type: 'click', button: 'left', y: 0 });
		const open = chat.render(120).join('\n');
		expect(open).toContain('ORIGINAL_CALL');
		expect(open).toContain('ORIGINAL_RESULT');
		expect(open).not.toContain('RAW_ORIGINAL');
		expect((tool as any).expanded).toBe(false);
	});

	it('preserves independently expanded tools across process collapse, settlement and disable', () => {
		beginTurnFolding();
		const chat = createChat();
		chat.addChild(new UserMessageComponent('Question'));
		const tool = makeTool('bash', 'independent', { command: 'echo INNER_DETAIL' });
		tool.updateResult({ content: [{ type: 'text', text: 'INNER_DETAIL' }], isError: false });
		chat.addChild(tool);
		tool.setExpanded(true);
		const card = cards(chat)[0];
		card.handleMouse({ type: 'click', button: 'left', y: 0 });
		expect(chat.render(120).join('\n')).toContain('INNER_DETAIL');
		collapseTurnFolding();
		expect((tool as any).expanded).toBe(true);
		card.handleMouse({ type: 'click', button: 'left', y: 0 });
		expect(chat.render(120).join('\n')).toContain('INNER_DETAIL');
		chat.addChild(assistant('INDEPENDENT_FINAL', 'stop'));
		settleTurnFolding(false);
		expect((tool as any).expanded).toBe(true);
		configureTurnFolding(false);
		expect((tool as any).expanded).toBe(true);
		expect(chat.render(120).join('\n')).toContain('INNER_DETAIL');
	});

	it('restores native tool expansion state when turn folding is disabled', () => {
		const chat = createChat();
		chat.addChild(new UserMessageComponent('Question'));
		const tool = makeTool('bash', 'restore-tool', { command: 'echo NATIVE_DETAIL' });
		tool.updateResult({ content: [{ type: 'text', text: 'NATIVE_DETAIL' }], isError: false });
		chat.addChild(tool);
		chat.addChild(assistant('ANSWER', 'stop'));
		cards(chat)[0].handleMouse({ type: 'click', button: 'left', y: 0 });
		chat.render(120);
		configureTurnFolding(false);
		expect((tool as any).expanded).toBe(false);
		expect(chat.render(120).join('\n')).not.toContain('NATIVE_DETAIL');
	});

	it.each([
		[true, 'tui', true],
		[false, 'tui', false],
		[undefined, 'tui', false],
		[true, 'rpc', false],
		[true, 'json', false],
		[true, 'print', false],
	] as const)('enables configured turnFolding=%s only in TUI (mode=%s)', (enabled, mode, folded) => {
		vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ turnFolding: enabled, grouping: true, default: { mode: 'lines' } }));
		const handlers = new Map<string, Function>();
		const shortcut = vi.fn();
		const registerTool = vi.fn();
		extension({
			on: (name: string, handler: Function) => handlers.set(name, handler),
			registerShortcut: shortcut,
			registerTool,
			registerToolRenderer: vi.fn(),
		} as any);
		handlers.get('session_start')?.({}, { mode });
		const chat = createChat();
		chat.addChild(new UserMessageComponent('Question'));
		chat.addChild(assistant('CONFIG_PROGRESS'));
		chat.addChild(assistant('CONFIG_FINAL', 'stop'));
		const rendered = chat.render(120).join('\n');
		expect(cards(chat).length > 0).toBe(folded);
		expect(rendered.includes('CONFIG_PROGRESS')).toBe(!folded);
		expect(rendered).toContain('CONFIG_FINAL');
		expect(shortcut).toHaveBeenCalledTimes(enabled === true ? 1 : 0);
		expect(registerTool).not.toHaveBeenCalled();
	});

	it('does not replace the final message or model context with TUI summaries when enabled', async () => {
		const handlers = new Map<string, Function>();
		extension({
			on: (name: string, handler: Function) => handlers.set(name, handler),
			registerShortcut: vi.fn(),
			registerToolRenderer: vi.fn(),
		} as any);
		await handlers.get('session_start')?.({}, { mode: 'tui' });
		await handlers.get('tool_call')?.({ toolName: 'read', toolCallId: 'context-read', input: {} });
		const final = message('FINAL_MESSAGE', 'stop');
		const before = JSON.parse(JSON.stringify(final));
		expect(await handlers.get('message_end')?.({ message: final }, { mode: 'tui' })).toBeUndefined();
		expect(final).toEqual(before);
		const history = [message('HISTORY_PROGRESS'), final];
		const transformed = await handlers.get('context')?.({ messages: history });
		expect(transformed.messages).toEqual(history);
	});

	it('marks cancellation without a final model response after the run settles', () => {
		beginTurnFolding();
		const chat = createChat();
		chat.addChild(new UserMessageComponent('Question'));
		chat.addChild(assistant('WAITING_PROGRESS'));
		settleTurnFolding(true);
		expect(chat.render(120).join('\n')).toContain('已取消');
		expect(chat.render(120).join('\n')).not.toContain('进行中');
	});
});
