export type Mode = 'scripture' | 'tags'
export type DateOrder = 'asc' | 'desc'

export interface HighlightRecord {
	readonly id: string
	readonly path: string
	readonly source: string
	readonly attribution: string
	readonly attributionLink: string | null
	readonly sourcePath: string | null
	readonly readwiseId: string | null
	readonly isBook: boolean
	readonly highlightedMs: number | null
	readonly tags: ReadonlyArray<string>
	readonly scripturePaths: ReadonlyArray<string>
}

export interface ViewPreferences {
	readonly favorites: boolean
	readonly illustrations: boolean
	readonly order: DateOrder
	readonly expanded: ReadonlyArray<string>
	readonly scroll: number
}

export interface DittoState {
	readonly scripturePath: string | null
	readonly sectionByPath: Record<string, string>
	readonly scripture: ViewPreferences
	readonly tags: ViewPreferences & {
		readonly selected: ReadonlyArray<string>
		readonly operator: 'and' | 'or'
	}
}
