import { vi } from 'vitest';
import { ToolExecutionComponent } from '@earendil-works/pi-coding-agent';
import type { ToolRendererResolver, ToolRenderers } from '@earendil-works/pi-coding-agent';
import extension from '../src/index';

export function loadRenderingExtension(turnFolding = false) {
	let resolver: ToolRendererResolver;
	let sessionStart: ((event: any, ctx: any) => void) | undefined;
	extension({
		on: vi.fn((name, handler) => { if (name === "session_start") sessionStart = handler; }),
		registerShortcut: vi.fn(),
		registerTool: vi.fn(() => { throw new Error('Display extensions must not register tools'); }),
		registerToolRenderer: vi.fn((value: ToolRendererResolver) => { resolver = value; }),
	} as any);
	sessionStart?.({}, { mode: turnFolding ? "tui" : "print" });
	return (name: string, id: string, args: any, original?: ToolRenderers) => new ToolExecutionComponent(
		name, id, args, {}, resolver(name, () => original), { requestRender() {} } as any, process.cwd(),
	);
}
