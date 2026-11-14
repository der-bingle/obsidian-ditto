import { filter, reject, toUpper } from 'ramda'
import { DateOrder, HighlightRecord, Mode } from './types'
import { matchesTag } from './query'

export type CardAction = 'open-highlight' | 'open-source' | 'tags' | 'copy'

// Takes a tag name and returns a predicate for that tag or any of its children.
const isTagOrChild = (name: string) => (tag: string): boolean => matchesTag(name, tag)

// Takes the active category toggles and a highlight's tags, returns the tags worth reading on its card.
export const displayTags = (favorites: boolean, illustrations: boolean, tags: ReadonlyArray<string>): string[] =>
	reject(
		(tag: string) => isTagOrChild('bible')(tag) ||
			(favorites && isTagOrChild('fave')(tag)) ||
			(illustrations && isTagOrChild('illustration')(tag)),
		[...tags]
	)

// Takes where a card sits and whether it has tags to show, returns its action buttons in display order.
// Inside a group the heading already opens the source, so only the flat list repeats it,
// on every card, faded where there is no source note.
export const cardActions = (flat: boolean, hasTags: boolean): CardAction[] =>
	filter(Boolean, [
		'open-highlight',
		flat ? 'open-source' : null,
		hasTags ? 'tags' : null,
		'copy'
	]) as CardAction[]

// Takes a highlight, returns its source button: whether a note exists to open, and a label that
// names the kind ("Open sermon note") so it can't be mistaken for the highlight note itself.
// The icon stays the same for every kind so the button is easy to find.
export const sourceButton = (record: Pick<HighlightRecord, 'sourceType' | 'sourcePath'>): {icon: string; label: string; available: boolean} => {
	const kind = record.sourceType
	const available = !!record.sourcePath
	const label = available
		? `Open ${kind || 'source'} note`
		: kind ? `No note for this ${kind} in the vault` : 'No note for this highlight’s source in the vault'
	return { icon: 'book-open', label, available }
}

// Takes a view mode and a highlight, returns its group heading: author first for Scripture
// (commentaries share titles), title first for Tags (titles are distinct across a query).
export const groupHeading = (mode: Mode, record: Pick<HighlightRecord, 'author' | 'title'>): {name: string | null; sub: string | null} => {
	const [first, second] = mode === 'scripture' ? [record.author, record.title] : [record.title, record.author]
	const name = first || second || null
	return { name, sub: first && second ? second : null }
}

// Takes a highlight, returns the flat-list source line parts (`Author · Title`), or null when it has neither.
export const sourceLine = (record: Pick<HighlightRecord, 'author' | 'title'>): {author: string; title: string} | null =>
	record.author || record.title ? { author: record.author, title: record.title } : null

// Takes a date order, returns the Lucide icon that pictures it.
export const sortIcon = (order: DateOrder): string => order === 'desc' ? 'arrow-down-wide-narrow' : 'arrow-up-narrow-wide'

// Takes a date order, returns its menu and tooltip label.
export const sortLabel = (order: DateOrder): string => order === 'desc' ? 'Newest first' : 'Oldest first'

// Takes a section tag such as `two-ways`, returns `Two ways`.
export const sectionLabel = (section: string): string => {
	const words = section.replace(/-/g, ' ')
	return toUpper(words.charAt(0)) + words.slice(1)
}

// Takes a count, returns it with thousands separators.
export const formatCount = (count: number): string => count.toLocaleString('en-US')

const categoryName = (favorites: boolean, illustrations: boolean): string =>
	favorites && illustrations ? 'favorite illustrations' : favorites ? 'favorites' : 'illustrations'

const toggleNames = (favorites: boolean, illustrations: boolean): string =>
	favorites && illustrations ? 'Favorites or Illustrations' : favorites ? 'Favorites' : 'Illustrations'

export interface EmptyContext {
	readonly mode: Mode
	readonly passage: string
	readonly tags: ReadonlyArray<string>
	readonly operator: 'and' | 'or'
	readonly favorites: boolean
	readonly illustrations: boolean
	readonly matched: number
	readonly inSection: number
}

// Takes the counts left after each filter, returns what didn't match and the one change most likely to help.
export const emptyMessage = (context: EmptyContext): {title: string; hint: string} => {
	const { mode, passage, tags, operator, favorites, illustrations, matched, inSection } = context
	if (inSection > 0) {
		const noun = inSection === 1 ? 'highlight' : 'highlights'
		return {
			title: `None of these ${formatCount(inSection)} ${noun} are ${categoryName(favorites, illustrations)}.`,
			hint: `Turn off ${toggleNames(favorites, illustrations)} to see them.`
		}
	}
	if (matched > 0) return { title: 'No highlights in this section.', hint: 'Choose All sections to see the whole chapter.' }
	if (mode === 'scripture') return { title: `No highlights link to ${passage}.`, hint: 'A highlight appears here once its scripture field links this chapter.' }
	if (tags.length > 1 && operator === 'and') return { title: 'No highlights have all of these tags.', hint: 'Remove a tag, or switch to Any tag (OR).' }
	if (tags.length > 1) return { title: 'No highlights have any of these tags.', hint: 'Try a parent tag, which includes its children.' }
	return { title: 'No highlights have this tag.', hint: 'Try a parent tag, which includes its children.' }
}
