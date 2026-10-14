import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import { Text } from '@earendil-works/pi-tui';
import { ToolExecutionComponent } from '@earendil-works/pi-coding-agent';
import extension from '../src/index';

vi.mock('fs');

describe('Renderer registration compatibility', () => {
	let mockPi: any;
	let resolver: any;

	beforeEach(() => {
		vi.resetAllMocks();
		resolver = undefined;
		mockPi = {
			on: vi.fn(),
			registerTool: vi.fn(),
			registerToolRenderer: vi.fn((registered: any) => { resolver = registered; }),
		};
	});

	const setup = (configJson: any) => {
		vi.mocked(fs.existsSync).mockReturnValue(true);
		vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(configJson));
		extension(mockPi);
	};

	const theme = {
		fg: (_name: string, text: string) => text,
		bg: (_name: string, text: string) => text,
		bold: (text: string) => text,
	};
	const context = { args: {}, state: {}, isPartial: false, isError: false, expanded: false };

	it('does not register tools when Bash belongs to another extension', () => {
		const execute = vi.fn();
		const parameters = { type: 'object', properties: { command: { type: 'string' } } };
		const existing = { name: 'bash', execute, parameters, prepareArguments: vi.fn(), promptSnippet: 'RTK Bash' };
		mockPi.registerTool.mockImplementation((tool: any) => {
			throw new Error(`Tool "${tool.name}" conflicts with pi-code-intel`);
		});
		expect(() => setup({ grouping: true, bash: { mode: 'lines' } })).not.toThrow();
		expect(mockPi.registerTool).not.toHaveBeenCalled();
		expect(mockPi.registerToolRenderer).toHaveBeenCalledTimes(1);
		expect(resolver('bash', () => existing)).not.toHaveProperty('execute');
		expect(existing.execute).toBe(execute);
		expect(existing.parameters).toBe(parameters);
		expect(existing.promptSnippet).toBe('RTK Bash');
	});

	it('preserves downstream renderers for default mode without mutating them', () => {
		setup({ default: { mode: 'lines' }, bash: { mode: 'default' } });
		const next = { renderCall: vi.fn(), renderResult: vi.fn(), renderShell: 'default' };
		expect(resolver('bash', () => next)).toBe(next);
		expect(mockPi.registerTool).not.toHaveBeenCalled();
	});

	it('does not change tool component renderer prototypes', () => {
		const prototype = ToolExecutionComponent.prototype as any;
		const methods = [prototype.getCallRenderer, prototype.getResultRenderer, prototype.getRenderShell];
		setup({ bash: { mode: 'lines' } });
		expect([prototype.getCallRenderer, prototype.getResultRenderer, prototype.getRenderShell]).toEqual(methods);
	});

	it('renders unknown tools using the default configuration before they register', () => {
		setup({ default: { mode: 'lines', outputLines: 2, noPadding: true } });
		const renderers = resolver('mcp__server__unknown', () => undefined);
		expect(renderers.renderShell).toBe('self');
		const result = { content: [{ type: 'text', text: 'first\nsecond\nthird' }] };
		const collapsed = renderers.renderResult(result, { expanded: false, isPartial: false }, theme, context).render(80).join('\n');
		expect(collapsed).toContain('first');
		expect(collapsed).toContain('second');
		expect(collapsed).not.toContain('third');
		const expanded = renderers.renderResult(result, { expanded: true, isPartial: false }, theme, context).render(80).join('\n');
		expect(expanded).toContain('third');
	});

	it('keeps grouped call and result details available outside the TUI mirror', () => {
		setup({ grouping: true, default: { mode: 'lines', outputLines: 1, noPadding: true } });
		const renderers = resolver('unknown', () => undefined);
		const args = { action: 'inspect' };
		const renderContext = { ...context, args, expanded: true };
		const call = renderers.renderCall(args, theme, renderContext).render(80).join('\n');
		expect(call).toContain('unknown:inspect ×1');
		expect(call).toContain('unknown:inspect { action: inspect }');
		const result = { content: [{ type: 'text', text: 'first\nsecond' }] };
		const output = renderers.renderResult(result, { expanded: true, isPartial: false }, theme, renderContext).render(80).join('\n');
		expect(output).toContain('first');
		expect(output).toContain('second');
	});

	it('uses count_only renderers without replacing tool execution', () => {
		setup({ read: { mode: 'count_only' } });
		const renderers = resolver('read', () => undefined);
		expect(renderers.renderCall({}, theme, context).render(80)).toEqual([]);
		expect(renderers.renderResult({}, {}, theme, context).render(80)).toEqual([]);
		expect(mockPi.registerTool).not.toHaveBeenCalled();
	});

	it('resolves action-specific configuration with fallback to downstream renderers', () => {
		setup({ mcp: { mode: 'default' }, 'mcp:search': { mode: 'lines', noPadding: true } });
		const renderCall = vi.fn(() => new Text('original', 0, 0));
		const renderers = resolver('mcp', () => ({ renderCall }));
		expect(renderers.renderCall({ action: 'search' }, theme, context).render(80).join('\n')).toContain('mcp:search');
		expect(renderers.renderCall({ action: 'other' }, theme, context).render(80).join('\n')).toContain('original');
		expect(renderCall).toHaveBeenCalledTimes(1);
	});

	it('fails clearly on Pi versions without registerToolRenderer before changing prototypes', () => {
		const addChild = ToolExecutionComponent.prototype.addChild;
		delete mockPi.registerToolRenderer;
		expect(() => setup({ bash: { mode: 'lines' } })).toThrow(/Pi >=1\.0\.1.*registerToolRenderer/);
		expect(ToolExecutionComponent.prototype.addChild).toBe(addChild);
		expect(mockPi.registerTool).not.toHaveBeenCalled();
	});
});
