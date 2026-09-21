import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import extension from '../src/index';

vi.mock('fs');

describe('Tools Registration Filtering & Metadata Inheritance (D-01, D-04, D-05)', () => {
	let mockPi: any;
	let registeredTools: Map<string, any>;

	beforeEach(() => {
		vi.resetAllMocks();
		registeredTools = new Map();
		mockPi = {
			on: vi.fn(),
			registerTool: vi.fn((def: any) => {
				registeredTools.set(def.name, def);
			}),
		};
	});

	const setup = (configJson: any) => {
		vi.mocked(fs.existsSync).mockReturnValue(true);
		vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(configJson));
		extension(mockPi);
	};

	it('should NOT register any tool when config is empty (S1)', () => {
		setup({});
		expect(mockPi.registerTool).not.toHaveBeenCalled();
		expect(registeredTools.size).toBe(0);
	});

	it('should NOT register any tool when default key is explicitly "default" (S1)', () => {
		setup({ default: { mode: 'default' } });
		expect(mockPi.registerTool).not.toHaveBeenCalled();
		expect(registeredTools.size).toBe(0);
	});

	it('should register only count_only tools when specified (S2)', () => {
		setup({ read: { mode: 'count_only' } });
		expect(mockPi.registerTool).toHaveBeenCalledTimes(1);
		expect(registeredTools.has('read')).toBe(true);
		expect(registeredTools.has('bash')).toBe(false);
		expect(registeredTools.has('ls')).toBe(false);
	});

	it('should register only lines tools when specified (S3)', () => {
		setup({
			read: { mode: 'lines', outputLines: 2 },
			bash: { mode: 'lines', outputLines: 3 },
		});
		expect(mockPi.registerTool).toHaveBeenCalledTimes(2);
		expect(registeredTools.has('read')).toBe(true);
		expect(registeredTools.has('bash')).toBe(true);
		expect(registeredTools.has('write')).toBe(false);
		expect(registeredTools.has('ls')).toBe(false);
	});

	it('should register read WITHOUT ZERO renderCall/renderResult so lines mode uses built-in renderer (S3 / D-04)', () => {
		setup({ read: { mode: 'lines', outputLines: 2 } });
		const def = registeredTools.get('read');
		expect(def).toBeDefined();
		expect(def.renderCall).toBeUndefined();
		expect(def.renderResult).toBeUndefined();
	});

	it('should register all 7 tools when default key specifies count_only (S8)', () => {
		setup({ default: { mode: 'count_only' } });
		expect(mockPi.registerTool).toHaveBeenCalledTimes(7);
		for (const name of ['bash', 'read', 'write', 'edit', 'ls', 'find', 'grep']) {
			expect(registeredTools.has(name)).toBe(true);
		}
	});

	it('should register all 7 tools when default key specifies lines (S8)', () => {
		setup({ default: { mode: 'lines', outputLines: 3 } });
		expect(mockPi.registerTool).toHaveBeenCalledTimes(7);
		for (const name of ['bash', 'read', 'write', 'edit', 'ls', 'find', 'grep']) {
			expect(registeredTools.has(name)).toBe(true);
		}
	});

	it('should allow tool-specific lines mode to override default count_only (S8)', () => {
		setup({
			default: { mode: 'count_only' },
			read: { mode: 'lines', outputLines: 2 },
		});
		expect(mockPi.registerTool).toHaveBeenCalledTimes(7);
		const readDef = registeredTools.get('read');
		expect(readDef.renderCall).toBeUndefined();
	});

	it('should allow tool-specific default mode to override default key lines and skip registration (S9)', () => {
		setup({
			default: { mode: 'lines' },
			read: { mode: 'default' },
		});
		expect(mockPi.registerTool).toHaveBeenCalledTimes(6);
		expect(registeredTools.has('read')).toBe(false);
		expect(registeredTools.has('bash')).toBe(true);
		expect(registeredTools.has('ls')).toBe(true);
	});

	it('should inherit promptSnippet and promptGuidelines from built-in definition on registered tool (S5)', () => {
		setup({ read: { mode: 'count_only' } });
		const def = registeredTools.get('read');
		expect(def.promptSnippet).toBe('Read file contents');
		expect(Array.isArray(def.promptGuidelines)).toBe(true);
		expect(def.promptGuidelines.length).toBeGreaterThan(0);
	});

	it('should inherit detailed description from built-in definition on registered tool (S6 / D-05)', () => {
		setup({ read: { mode: 'count_only' } });
		const def = registeredTools.get('read');
		expect(def.description.length).toBeGreaterThan(100);
		expect(def.description).toContain('Supports text files and images');
	});

	it('should inherit prepareArguments and executionMode from built-in edit definition (S7)', () => {
		setup({ edit: { mode: 'lines' } });
		const def = registeredTools.get('edit');
		expect(typeof def.prepareArguments).toBe('function');
		const normalized = def.prepareArguments({
			path: 'test.ts',
			oldText: 'foo',
			newText: 'bar',
		});
		expect(normalized.edits).toEqual([{ oldText: 'foo', newText: 'bar' }]);
	});
});
