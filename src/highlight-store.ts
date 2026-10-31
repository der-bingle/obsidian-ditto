import { App, CachedMetadata, getAllTags, getFrontMatterInfo, TFile, TFolder } from 'obsidian'
import { HighlightRecord } from './types'
import { normalizeTag, tagCounts } from './query'

const asStrings = (value: unknown): string[] =>
	(Array.isArray(value) ? value : value == null ? [] : [value]).filter((item): item is string => typeof item === 'string')

const linkText = (value: string): string => value.replace(/^\[\[/, '').replace(/\]\]$/, '').split('|')[0].split('#')[0].trim()
const displayText = (value: string): string => value.replace(/^\[\[/, '').replace(/\]\]$/, '').split('|').pop()!.trim()

// Takes cached metadata and returns the small record used by both views.
export const projectHighlight = (app: App, file: TFile, cache: CachedMetadata): HighlightRecord => {
	const frontmatter = cache.frontmatter || {}
	const authors = asStrings(frontmatter.authors)
	const author = authors[0] ? displayText(authors[0]) : ''
	const book = typeof frontmatter.book === 'string' ? frontmatter.book : ''
	const title = typeof frontmatter.title === 'string' ? frontmatter.title : ''
	const sourceName = book ? displayText(book) : title
	const source = sourceName ? (author && !sourceName.includes(author) ? `${author}, ${sourceName}` : sourceName) : author || 'Unknown Source'
	const sourceLink = book || title
	const candidate = sourceLink ? app.metadataCache.getFirstLinkpathDest(linkText(sourceLink), file.path) : null
	const sourceMetadata = candidate ? app.metadataCache.getFileCache(candidate)?.frontmatter : null
	const isArticleNote = !sourceMetadata?.highlighted && (sourceMetadata?.type === 'article' || typeof sourceMetadata?.source === 'string')
	const sourcePath = candidate && (book || isArticleNote) ? candidate.path : null
	const rawDate = typeof frontmatter.highlighted === 'string' ? Date.parse(frontmatter.highlighted) : NaN
	return {
		id: file.basename,
		path: file.path,
		source,
		attribution: book ? displayText(book) : author,
		sourcePath,
		readwiseId: typeof frontmatter.readwise === 'string' || typeof frontmatter.readwise === 'number' ? String(frontmatter.readwise) : null,
		isBook: !!book,
		highlightedMs: Number.isFinite(rawDate) ? rawDate : null,
		tags: [...new Set((getAllTags(cache) || []).map(normalizeTag))],
		scripturePaths: [...new Set(asStrings(frontmatter.scripture).map(ref =>
			app.metadataCache.getFirstLinkpathDest(linkText(ref), file.path)?.path || ''
		).filter(Boolean))]
	}
}

// Takes a highlight path and returns only its Markdown body.
export const bodyFromText = (text: string): string => text.slice(getFrontMatterInfo(text).contentStart).trim()

export class HighlightStore {
	private records = new Map<string, HighlightRecord>()
	private ready: Promise<void> | null = null
	private bodies = new Map<string, string>()
	private bodyBytes = 0
	private inFlight = new Map<string, Promise<string>>()
	private activeReads = 0
	private waiting: Array<() => void> = []
	private tagCountCache: Array<{tag: string; count: number}> | null = null
	private revision = 0

	constructor(private app: App, private folder: string, private changed: () => void) {}

	setFolder(folder: string): void {
		this.revision++
		this.folder = folder
		this.records.clear()
		this.tagCountCache = null
		this.bodies.clear()
		this.bodyBytes = 0
		this.ready = null
		this.changed()
	}

	private isInFolder(path: string): boolean {
		return path.startsWith(`${this.folder.replace(/\/+$/, '')}/`) && path.endsWith('.md')
	}

	async ensureReady(): Promise<void> {
		if (!this.ready) this.ready = this.build()
		await this.ready
	}

	private async build(): Promise<void> {
		const revision = this.revision
		const root = this.app.vault.getAbstractFileByPath(this.folder.replace(/\/+$/, ''))
		if (!(root instanceof TFolder)) return
		const folders = [root]
		let count = 0
		while (folders.length) {
			if (revision !== this.revision) return
			const folder = folders.pop()!
			for (const child of folder.children) {
				if (revision !== this.revision) return
				if (child instanceof TFolder) folders.push(child)
				else if (child instanceof TFile && this.isInFolder(child.path)) this.upsert(child, false)
				if (++count % 2000 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0))
			}
		}
		this.changed()
	}

	upsert(file: TFile, notify = true): void {
		if (!this.isInFolder(file.path)) return
		const cache = this.app.metadataCache.getFileCache(file)
		if (!cache) return
		this.records.set(file.path, projectHighlight(this.app, file, cache))
		this.tagCountCache = null
		if (notify) this.changed()
	}

	remove(path: string): void {
		this.records.delete(path)
		this.tagCountCache = null
		this.invalidateBody(path)
		this.changed()
	}

	all(): HighlightRecord[] { return [...this.records.values()] }
	refreshLinks(): void {
		if (!this.ready) return
		this.records.forEach((_, path) => {
			const file = this.app.vault.getAbstractFileByPath(path)
			if (file instanceof TFile) this.upsert(file, false)
		})
		this.changed()
	}
	counts(): Array<{tag: string; count: number}> {
		if (!this.tagCountCache) this.tagCountCache = tagCounts(this.all())
		return this.tagCountCache
	}

	invalidateBody(path: string): void {
		const old = this.bodies.get(path)
		if (old) this.bodyBytes -= old.length * 2
		this.bodies.delete(path)
	}

	async body(path: string): Promise<string> {
		const cached = this.bodies.get(path)
		if (cached !== undefined) {
			this.bodies.delete(path)
			this.bodies.set(path, cached)
			return cached
		}
		const pending = this.inFlight.get(path)
		if (pending) return pending
		const read = this.readBody(path)
		this.inFlight.set(path, read)
		try { return await read } finally { this.inFlight.delete(path) }
	}

	private async readBody(path: string): Promise<string> {
		if (this.activeReads >= 2) await new Promise<void>(resolve => this.waiting.push(resolve))
		this.activeReads++
		try {
			const file = this.app.vault.getAbstractFileByPath(path)
			if (!(file instanceof TFile)) return ''
			const body = bodyFromText(await this.app.vault.cachedRead(file))
			this.bodies.set(path, body)
			this.bodyBytes += body.length * 2
			while (this.bodies.size > 60 || this.bodyBytes > 2 * 1024 * 1024) {
				const oldest = this.bodies.keys().next().value as string
				this.invalidateBody(oldest)
			}
			return body
		} finally {
			this.activeReads--
			this.waiting.shift()?.()
		}
	}
}
