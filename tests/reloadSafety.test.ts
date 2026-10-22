import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Pi loads extensions through jiti with the `@earendil-works/*` packages aliased to
// native files. Measured behaviour on `/reload` after a rebuild:
//
//   * a module that imports an aliased package is re-evaluated, so it sees new exports;
//   * a module that imports only Node builtins stays in the native ESM cache, so a
//     freshly written file keeps its OLD export list;
//   * `index.ts` is always re-evaluated.
//
// So a binding that `index.ts` imports from a builtin-only module resolves to whatever
// that module exported when pi first loaded it. Bindings that existed then keep working,
// but a NEW one is `undefined` after `/reload`, which surfaced as
// "(@earendil-works, _config.resolveTurnPreviewRows) is not a function".
// These tests pin that invariant so the regression cannot come back.

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const read = (file: string) => fs.readFileSync(path.join(srcDir, file), 'utf-8');
const isReevaluated = (file: string) => /from\s+['"]@earendil-works\//.test(read(`${file}.ts`));

const entry = read('index.ts');
const localImports = (source: string) =>
	[...source.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]\.\/([\w.-]+)['"]/g)]
		.flatMap(([, names, file]) => names.split(',').map(name => name.trim()).filter(Boolean).map(name => ({ name, file })));

/**
 * Bindings `index.ts` takes from a builtin-only module. They were exported before this
 * invariant existed, so a stale cached copy still provides them. Adding a name here is
 * how a `/reload` crash happens: put new entry-facing exports in `turn.ts` instead, or
 * pass data and resolve it in a re-evaluated module.
 */
const PINNED_STALE_SAFE: Record<string, string[]> = {
	config: ['loadConfig', 'resolveToolConfig', 'getEffectiveToolName'],
	contextUtils: ['cleanContextMessages'],
	componentUtils: ['isSpacer', 'isUserMessage', 'isAssistantMessage', 'isSkillInvocation'],
	state: ['SummaryTracker'],
};

describe('reload safety (stale sibling modules)', () => {
	it('takes no new binding from a module that stays in the native cache', () => {
		const stale = localImports(entry)
			.filter(({ file }) => !isReevaluated(file))
			.filter(({ name, file }) => !(PINNED_STALE_SAFE[file] ?? []).includes(name));
		expect(stale.map(({ name, file }) => `${name} <- ${file}.ts`)).toEqual([]);
	});

	it('keeps the turn-preview resolver in the re-evaluated turn module', () => {
		// This exact binding crashed `/reload` when it lived in config.ts (builtin-only).
		expect(isReevaluated('turn')).toBe(true);
		expect(isReevaluated('config')).toBe(false);
		expect(localImports(entry)).toContainEqual({ name: 'resolveTurnPreviewRows', file: 'turn' });
	});

	it('passes plain data, not a config module function, into the resolver', () => {
		expect(entry).toContain('resolveTurnPreviewRows(config.turnPreviewRows)');
	});

	it('does not depend on a fresh export from any pinned builtin-only module', () => {
		// The pinned bindings must still exist in the current source: a rename would make the
		// entry import an undefined name on a plain load, which no reload test would catch.
		for (const [file, names] of Object.entries(PINNED_STALE_SAFE)) {
			const source = read(`${file}.ts`);
			for (const name of names) {
				const exported = new RegExp(`export\\s+(?:const|function|class|interface|type|let)\\s+${name}\\b`).test(source);
				expect({ file, name, exported }).toEqual({ file, name, exported: true });
			}
		}
	});
});
