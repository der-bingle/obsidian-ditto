import { groupBy, pipe, toPairs, map, uniq } from 'ramda'
import { HighlightRecord, DateOrder } from './types'
import { BIBLE_BOOK_ABBREVIATIONS } from './constants'

export const normalizeTag = (tag: string): string => tag.replace(/^#/, '').trim().toLowerCase()

export const matchesTag = (wanted: string, actual: string): boolean => {
	const tag = normalizeTag(actual)
	const query = normalizeTag(wanted)
	return !!query && (tag === query || tag.startsWith(`${query}/`))
}

export const matchesTags = (selected: ReadonlyArray<string>, operator: 'and' | 'or', tags: ReadonlyArray<string>): boolean =>
	selected.length > 0 && (operator === 'and'
		? selected.every(tag => tags.some(actual => matchesTag(tag, actual)))
		: selected.some(tag => tags.some(actual => matchesTag(tag, actual))))

export const matchesCategories = (favorites: boolean, illustrations: boolean, tags: ReadonlyArray<string>): boolean =>
	(!favorites || tags.some(tag => matchesTag('fave', tag))) &&
	(!illustrations || tags.some(tag => matchesTag('illustration', tag)))

// Takes dated highlights and returns a stable order with invalid dates last.
export const sortHighlights = (order: DateOrder, records: ReadonlyArray<HighlightRecord>): HighlightRecord[] =>
	[...records].sort((a, b) => {
		if (a.highlightedMs === null) return b.highlightedMs === null ? a.path.localeCompare(b.path) : 1
		if (b.highlightedMs === null) return -1
		return (order === 'asc' ? 1 : -1) * (a.highlightedMs - b.highlightedMs) || a.path.localeCompare(b.path)
	})

export const groupHighlights = (order: DateOrder, records: ReadonlyArray<HighlightRecord>): Array<{source: string; highlights: HighlightRecord[]}> => {
	const grouped = pipe(
		groupBy((record: HighlightRecord) => record.source),
		toPairs,
		map(([source, highlights]) => ({ source, highlights: sortHighlights(order, highlights) }))
	)(records as HighlightRecord[])
	return grouped.sort((a, b) => b.highlights.length - a.highlights.length || a.source.localeCompare(b.source))
}

export const sectionTags = (tags: ReadonlyArray<string>, scripturePath: string): string[] => {
	const basename = scripturePath.split('/').pop()?.replace(/\.md$/, '') || ''
	const chapter = basename.split(' ').pop() || ''
	const book = basename.slice(0, -(chapter.length + 1))
	const code = BIBLE_BOOK_ABBREVIATIONS[book]
	if (!code || !chapter) return []
	const prefixes = [`bible/${code}/${chapter}/`, `bible/${basename.toLowerCase().replace(/\s+/g, '/')}/`]
	return uniq(tags.flatMap(tag => prefixes.filter(prefix => normalizeTag(tag).startsWith(prefix)).map(prefix => normalizeTag(tag).slice(prefix.length))))
}

export const matchesSection = (section: string, scripturePath: string, record: HighlightRecord): boolean =>
	section === 'all' || sectionTags(record.tags, scripturePath).includes(section)

export const tagCounts = (records: ReadonlyArray<HighlightRecord>): Array<{tag: string; count: number}> => {
	const counts = new Map<string, number>()
	records.forEach(record => {
		const paths = uniq(record.tags.flatMap(tag => {
			const parts = normalizeTag(tag).split('/')
			return parts.map((_, index) => parts.slice(0, index + 1).join('/'))
		}))
		paths.forEach(tag => counts.set(tag, (counts.get(tag) || 0) + 1))
	})
	return [...counts].map(([tag, count]) => ({tag, count})).sort((a, b) => a.tag.localeCompare(b.tag))
}
