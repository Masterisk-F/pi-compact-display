import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import { Container } from "@earendil-works/pi-tui";
import { ToolExecutionComponent, initTheme } from "@earendil-works/pi-coding-agent";
import extension from '../src/index';
import { formatCallLine } from '../src/renderUtils';

vi.mock('fs');

describe('Standalone vs Grouped Parity (Q2 regression prevention)', () => {
	const fakeUi = { requestRender: () => {} };
	const dummyMcpDef = { name: 'mcp' };

	beforeEach(() => {
		vi.resetAllMocks();
		initTheme("dark");
	});

	const makeComponent = (toolName: string, id: string, args: any) =>
		new ToolExecutionComponent(toolName, id, args, {}, dummyMcpDef as any, fakeUi as any, process.cwd());

	it('should render the exact same call line in standalone lines mode and grouped expansion (Q2)', () => {
		const mcpArgs = {
			tool: 'read',
			args: JSON.stringify({ path: '/etc/hosts' }),
		};
		const expectedCallLine = formatCallLine('mcp', mcpArgs);

		// 1. Grouped mode configuration
		vi.mocked(fs.existsSync).mockReturnValue(true);
		vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
			grouping: true,
			mcp: { mode: 'lines' },
		}));
		extension({ on: vi.fn(), registerTool: vi.fn() } as any);

		// In grouped mode, create container and tool component, expand it
		const c = new Container();
		const tGrouped = makeComponent('mcp', '1', mcpArgs);
		tGrouped.updateResult({ content: [{ type: 'text', text: '127.0.0.1 localhost' }], isError: false });
		c.addChild(tGrouped);
		tGrouped.setExpanded(true);

		const groupedText = tGrouped.render(120).join('\n');
		expect(groupedText).toContain(expectedCallLine);

		// 2. Standalone mode configuration (grouping: false)
		vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
			grouping: false,
			mcp: { mode: 'lines' },
		}));
		extension({ on: vi.fn(), registerTool: vi.fn() } as any);

		const tStandalone = makeComponent('mcp', '2', mcpArgs);
		tStandalone.updateResult({ content: [{ type: 'text', text: '127.0.0.1 localhost' }], isError: false });

		const standaloneText = tStandalone.render(120).join('\n');
		expect(standaloneText).toContain(expectedCallLine);
	});

	it('should respect noPadding setting on standalone lines-mode call line (Q2)', () => {
		// With padding (default: noPadding false -> padTop = 1)
		vi.mocked(fs.existsSync).mockReturnValue(true);
		vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
			grouping: false,
			mcp: { mode: 'lines', noPadding: false },
		}));
		extension({ on: vi.fn(), registerTool: vi.fn() } as any);

		const tPadded = makeComponent('mcp', '1', { tool: 'search' });
		// Call renderer produces a Box with paddingX = padTop (1)
		const callRendererPadded = (tPadded as any).getCallRenderer();
		const boxPadded = callRendererPadded({ tool: 'search' }, { fg: () => '', bg: () => '' }, {});
		expect(boxPadded.paddingX).toBe(1);

		// Without padding (noPadding true -> padTop = 0)
		vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
			grouping: false,
			mcp: { mode: 'lines', noPadding: true },
		}));
		extension({ on: vi.fn(), registerTool: vi.fn() } as any);

		const tNoPad = makeComponent('mcp', '2', { tool: 'search' });
		const callRendererNoPad = (tNoPad as any).getCallRenderer();
		const boxNoPad = callRendererNoPad({ tool: 'search' }, { fg: () => '', bg: () => '' }, {});
		expect(boxNoPad.paddingX).toBe(0);
	});
});
