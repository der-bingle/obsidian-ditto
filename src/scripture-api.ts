import { App } from 'obsidian';

// Minimal slice of the obsidian-scripture plugin's public API (app.plugins.plugins['obsidian-scripture'].api)
// that this plugin depends on. See https://github.com/der-bingle/obsidian-scripture for the full API.
interface ScriptureTranslation {
	readonly availableAsNotes?: boolean;
	readonly notesDirectory?: string;
}

interface ScriptureAPI {
	getAvailableTranslations(): ReadonlyArray<ScriptureTranslation>;
}

interface AppWithScripturePlugin extends App {
	plugins: {
		plugins: Record<string, { api?: ScriptureAPI } | undefined>;
	};
}

const normalizeDirectory = (path: string): string => {
	const trimmed = path.trim().replace(/\/+$/, '');
	return trimmed ? `${trimmed}/` : '';
};

// Scripture notes can live in any vault-relative directory, per-translation, as configured by the
// user in the Scripture plugin's settings. Ask the plugin directly instead of hardcoding a path.
export const getScriptureNotePrefixes = (app: App, fallback: string): ReadonlyArray<string> => {
	const api = (app as AppWithScripturePlugin).plugins.plugins['obsidian-scripture']?.api;
	const translations = api?.getAvailableTranslations() ?? [];

	const prefixes = translations
		.filter((translation): translation is ScriptureTranslation & { notesDirectory: string } =>
			!!translation.availableAsNotes && !!translation.notesDirectory)
		.map(translation => normalizeDirectory(translation.notesDirectory));

	return prefixes.length > 0 ? Array.from(new Set(prefixes)) : [fallback];
};
