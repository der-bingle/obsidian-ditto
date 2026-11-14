import { Component, ItemView, MarkdownRenderer, Menu, Notice, Platform, setIcon, SuggestModal, TFile, WorkspaceLeaf } from 'obsidian'
import type DittoPlugin from './main'
import { VIEW_TYPE, TAG_VIEW_TYPE } from './constants'
import { DateOrder, HighlightRecord, Mode, ViewPreferences } from './types'
import { groupHighlights, matchesCategories, matchesSection, matchesTags, normalizeTag, sectionTags, sortHighlights } from './query'
import { cardActions, CardAction, displayTags, emptyMessage, formatCount, groupHeading, sectionLabel, sortIcon, sortLabel, sourceButton, sourceLine } from './display'
import { formatCallout } from './callout'

class TagPicker extends SuggestModal<{tag: string; count: number}> {
	constructor(private plugin: DittoPlugin) { super(plugin.app); this.setPlaceholder('Search highlight tags') }
	getSuggestions(query: string): Array<{tag: string; count: number}> {
		const selected = this.plugin.state.tags.selected
		return this.plugin.store.counts()
			.filter(item => item.tag.includes(normalizeTag(query)) && !selected.includes(item.tag))
			.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
			.slice(0, 100)
	}
	renderSuggestion(item: {tag: string; count: number}, el: HTMLElement): void {
		el.createSpan({ text: `#${item.tag}` })
		el.createSpan({ text: String(item.count), cls: 'ditto-tag-count' })
	}
	onChooseSuggestion(item: {tag: string; count: number}): void {
		this.plugin.updateState({ tags: { ...this.plugin.state.tags, selected: [...this.plugin.state.tags.selected, item.tag] } })
	}
}

// Takes a path, returns its basename without the .md extension.
const noteName = (path: string): string => path.replace(/\.md$/, '').split('/').pop() || path

export class DittoView extends ItemView {
	private generation = 0
	private renderComponent: Component | null = null
	private dirty = true
	private scrollTimer: number | null = null
	private visibilityObserver: MutationObserver | null = null
	// Per-card tag rows the user opened; kept in memory only, so re-renders don't close them.
	private shownTags = new Set<string>()

	constructor(leaf: WorkspaceLeaf, private plugin: DittoPlugin, private mode: Mode) { super(leaf) }
	getViewType(): string { return this.mode === 'scripture' ? VIEW_TYPE : TAG_VIEW_TYPE }
	getDisplayText(): string { return this.mode === 'scripture' ? 'Ditto Scripture' : 'Ditto Tags' }
	getIcon(): string { return this.mode === 'scripture' ? 'book-open' : 'hash' }

	async onOpen(): Promise<void> {
		this.contentEl.addClass('ditto-view')
		this.contentEl.addEventListener('scroll', this.saveScroll)
		this.visibilityObserver = new MutationObserver(() => {
			if (this.contentEl.isShown() && this.dirty) void this.refresh()
			else if (!this.contentEl.isShown() && !this.dirty) {
				this.generation++
				this.renderComponent?.unload()
				this.renderComponent = null
				this.contentEl.empty()
				this.dirty = true
			}
		})
		let ancestor: HTMLElement | null = this.contentEl
		while (ancestor && ancestor !== document.body) {
			this.visibilityObserver.observe(ancestor, { attributes: true, attributeFilter: ['class', 'style'] })
			ancestor = ancestor.parentElement
		}
		await this.refresh()
	}

	async onClose(): Promise<void> {
		this.generation++
		this.contentEl.removeEventListener('scroll', this.saveScroll)
		this.visibilityObserver?.disconnect()
		if (this.scrollTimer !== null) window.clearTimeout(this.scrollTimer)
		this.renderComponent?.unload()
	}

	onResize(): void { if (this.dirty && this.contentEl.isShown()) void this.refresh() }

	private saveScroll = (): void => {
		if (this.scrollTimer !== null) window.clearTimeout(this.scrollTimer)
		this.scrollTimer = window.setTimeout(() => {
			const prefs = this.preferences()
			this.plugin.updateState({ [this.mode]: { ...prefs, scroll: this.contentEl.scrollTop } }, false)
		}, 250)
	}

	private preferences(): ViewPreferences { return this.plugin.state[this.mode] }

	private updatePreferences(patch: Partial<ViewPreferences>): void {
		this.plugin.updateState({ [this.mode]: { ...this.preferences(), ...patch } })
	}

	async refresh(): Promise<void> {
		this.dirty = true
		const generation = ++this.generation
		if (!this.contentEl.isShown()) {
			this.renderComponent?.unload()
			this.renderComponent = null
			this.contentEl.empty()
			return
		}
		this.renderComponent?.unload()
		this.renderComponent = new Component()
		this.renderComponent.load()
		this.renderLoading()
		try {
			await this.plugin.store.ensureReady()
			if (generation !== this.generation) return
			this.render(generation)
			this.dirty = false
		} catch (error) {
			if (generation !== this.generation) return
			console.error('Ditto could not load highlights', error)
			const root = this.createRoot()
			this.renderHead(root, this.heading(), null)
			this.renderEmpty(root, 'alert-circle', 'Highlights could not load.', 'Ditto couldn’t read the highlight notes. Reopen the view to try again.', true)
		}
	}

	private createRoot(): HTMLElement {
		this.contentEl.empty()
		return this.contentEl.createDiv({ cls: Platform.isMobile ? 'ditto-root is-touch' : 'ditto-root' })
	}

	// The view's heading: the chapter in Scripture, "Tags" in Tags.
	private heading(): string {
		const path = this.plugin.state.scripturePath
		return this.mode === 'scripture' ? (path ? noteName(path) : 'No passage') : 'Tags'
	}

	private renderLoading(): void {
		const root = this.createRoot()
		this.renderHead(root, this.heading(), null)
		this.renderFilters(root, this.preferences())
		const list = root.createDiv({ cls: 'ditto-groups', attr: { 'aria-busy': 'true' } })
		for (let index = 0; index < 5; index++) {
			const row = list.createDiv('ditto-skeleton')
			row.createEl('i')
			row.createEl('i')
		}
	}

	private render(generation: number): void {
		const state = this.plugin.state
		const prefs = this.preferences()
		const scripturePath = state.scripturePath
		const root = this.createRoot()
		if (this.mode === 'scripture' && !scripturePath) {
			this.renderHead(root, 'No passage', null, true)
			this.renderEmpty(root, 'book-open', 'Open a Scripture chapter.', 'Open a chapter note such as James 5 and its highlights appear here. The view keeps that chapter when you move to other notes.')
			return
		}
		if (this.mode === 'tags' && !state.tags.selected.length) {
			this.renderHead(root, 'Tags', null, true)
			this.renderTagControls(root)
			this.renderEmpty(root, 'tag', 'Choose one or more tags.', el => {
				el.appendText('Highlights appear once the query has a tag. A parent tag includes its children, so ')
				el.createEl('code', { text: 'bible/jas' })
				el.appendText(' finds every section of James.')
			})
			return
		}
		const records = this.plugin.store.all().filter(record => this.mode === 'scripture'
			? record.scripturePaths.includes(scripturePath!)
			: matchesTags(state.tags.selected, state.tags.operator, record.tags))
		const section = scripturePath ? state.sectionByPath[scripturePath] || 'all' : 'all'
		const inSection = records.filter(record => this.mode !== 'scripture' || matchesSection(section, scripturePath!, record))
		const selected = inSection.filter(record => matchesCategories(prefs.favorites, prefs.illustrations, record.tags))
		this.renderHead(root, this.heading(), selected.length)
		if (this.mode === 'scripture') this.renderSectionControl(root, records, scripturePath!)
		else this.renderTagControls(root)
		this.renderFilters(root, prefs)
		if (!selected.length) {
			const message = emptyMessage({
				mode: this.mode, passage: this.heading(), tags: state.tags.selected, operator: state.tags.operator,
				favorites: prefs.favorites, illustrations: prefs.illustrations, matched: records.length, inSection: inSection.length
			})
			this.renderEmpty(root, 'search', message.title, message.hint)
			return
		}
		if (prefs.favorites || prefs.illustrations) {
			void this.renderCards(root.createDiv('ditto-list ditto-flat'), sortHighlights(prefs.order, selected), true, generation)
		} else {
			const groups = root.createDiv('ditto-groups')
			groupHighlights(prefs.order, selected).forEach(group => this.renderGroup(groups, group.source, group.highlights, generation))
		}
		this.contentEl.scrollTop = prefs.scroll
	}

	private renderHead(root: HTMLElement, title: string, count: number | null, muted = false): void {
		const head = root.createDiv('ditto-head')
		head.createEl('h2', { cls: muted ? 'ditto-context is-muted' : 'ditto-context', text: title })
		if (count === null) return
		const countEl = head.createSpan('ditto-count')
		countEl.createEl('strong', { text: formatCount(count) })
		countEl.appendText(count === 1 ? ' highlight' : ' highlights')
	}

	private renderEmpty(root: HTMLElement, icon: string, title: string, hint: string | ((el: HTMLElement) => void), isError = false): void {
		const empty = root.createDiv({ cls: isError ? 'ditto-empty is-error' : 'ditto-empty' })
		if (isError) empty.setAttribute('role', 'alert')
		setIcon(empty.createSpan('ditto-empty-icon'), icon)
		empty.createEl('p', { cls: 'ditto-empty-title', text: title })
		const hintEl = empty.createEl('p')
		if (typeof hint === 'string') hintEl.setText(hint)
		else hint(hintEl)
	}

	private renderTagControls(root: HTMLElement): void {
		const prefs = this.plugin.state.tags
		const chips = root.createDiv('ditto-chips')
		prefs.selected.forEach(tag => {
			const chip = chips.createSpan('ditto-chip')
			const name = chip.createSpan('ditto-chip-name')
			name.createSpan({ cls: 'ditto-hash', text: '#' })
			name.appendText(tag)
			const remove = chip.createEl('button', { attr: { 'aria-label': `Remove ${tag}` } })
			setIcon(remove, 'x')
			remove.addEventListener('click', () => this.plugin.updateState({ tags: { ...this.plugin.state.tags, selected: this.plugin.state.tags.selected.filter(value => value !== tag) } }))
		})
		const add = chips.createEl('button', { cls: 'ditto-add' })
		setIcon(add, 'plus')
		add.appendText('Add tag')
		add.addEventListener('click', () => new TagPicker(this.plugin).open())
		const field = root.createDiv('ditto-field')
		field.createSpan({ cls: 'ditto-field-label', text: 'Match' })
		const segment = field.createDiv({ cls: 'ditto-segment', attr: { role: 'group', 'aria-label': 'Match' } })
		for (const [value, label] of [['and', 'All tags (AND)'], ['or', 'Any tag (OR)']] as const) {
			const button = segment.createEl('button', { text: label, attr: { 'aria-pressed': String(prefs.operator === value) } })
			button.addEventListener('click', () => {
				if (this.plugin.state.tags.operator !== value) this.plugin.updateState({ tags: { ...this.plugin.state.tags, operator: value } })
			})
		}
	}

	private renderSectionControl(root: HTMLElement, records: HighlightRecord[], scripturePath: string): void {
		const counts = new Map<string, number>()
		records.forEach(record => sectionTags(record.tags, scripturePath).forEach(section => counts.set(section, (counts.get(section) || 0) + 1)))
		const sections = [...counts.keys()].sort()
		if (!sections.length) return
		const field = root.createEl('label', 'ditto-field')
		field.createSpan({ cls: 'ditto-field-label', text: 'Passage section' })
		const select = field.createSpan('ditto-select').createEl('select')
		select.createEl('option', { text: `All sections (${formatCount(records.length)})`, value: 'all' })
		sections.forEach(section => select.createEl('option', { text: `${sectionLabel(section)} (${formatCount(counts.get(section)!)})`, value: section }))
		select.value = this.plugin.state.sectionByPath[scripturePath] || 'all'
		select.addEventListener('change', () => this.plugin.updateState({ sectionByPath: { ...this.plugin.state.sectionByPath, [scripturePath]: select.value } }))
	}

	private renderFilters(root: HTMLElement, prefs: ViewPreferences): void {
		const row = root.createDiv('ditto-filters')
		for (const [key, label, icon] of [['favorites', 'Favorites', 'star'], ['illustrations', 'Illustrations', 'lightbulb']] as const) {
			const button = row.createEl('button', { cls: 'ditto-toggle', attr: { 'aria-pressed': String(prefs[key]) } })
			setIcon(button, icon)
			button.appendText(label)
			button.addEventListener('click', () => this.updatePreferences({ [key]: !this.preferences()[key] }))
		}
		const label = `Sort: ${sortLabel(prefs.order).toLowerCase()}`
		const sort = row.createEl('button', { cls: 'ditto-sort', attr: { 'aria-label': label, 'aria-haspopup': 'menu', 'aria-expanded': 'false' } })
		setIcon(sort, sortIcon(prefs.order))
		sort.addEventListener('click', event => {
			// In-app menu even where the vault uses native menus: it matches the sidebar and shows the order icons
			const menu = new Menu().setUseNativeMenu(false)
			for (const order of ['asc', 'desc'] as DateOrder[]) {
				menu.addItem(item => item
					.setTitle(sortLabel(order))
					.setIcon(sortIcon(order))
					.setChecked(this.preferences().order === order)
					.onClick(() => { if (this.preferences().order !== order) this.updatePreferences({ order }) }))
			}
			sort.setAttribute('aria-expanded', 'true')
			menu.onHide(() => sort.setAttribute('aria-expanded', 'false'))
			const rect = sort.getBoundingClientRect()
			if (event.detail === 0) menu.showAtPosition({ x: rect.left, y: rect.bottom })
			else menu.showAtMouseEvent(event)
		})
	}

	private renderGroup(root: HTMLElement, source: string, records: HighlightRecord[], generation: number): void {
		const expanded = this.preferences().expanded.includes(source)
		const group = root.createEl('section', { cls: expanded ? 'ditto-group is-open' : 'ditto-group' })
		const row = group.createDiv('ditto-group-row')
		const toggle = row.createEl('button', { cls: 'ditto-group-toggle', attr: { 'aria-expanded': String(expanded) } })
		setIcon(toggle, 'chevron-right')
		const heading = groupHeading(this.mode, records[0])
		const sourceEl = toggle.createSpan('ditto-source')
		sourceEl.createSpan({ cls: heading.name ? 'ditto-source-name' : 'ditto-source-name is-muted', text: heading.name || 'No source' })
		if (heading.sub) sourceEl.createSpan({ cls: 'ditto-source-sub', text: heading.sub })
		toggle.createSpan({ cls: 'ditto-group-count', text: formatCount(records.length) })
		this.sourceIconButton(row, records[0])
		toggle.addEventListener('click', () => {
			const expandedNow = this.preferences().expanded
			this.updatePreferences({ expanded: expandedNow.includes(source) ? expandedNow.filter(value => value !== source) : [...expandedNow, source] })
		})
		if (expanded) void this.renderCards(group.createDiv('ditto-group-body').createDiv('ditto-list'), records, false, generation)
	}

	private async renderCards(root: HTMLElement, records: HighlightRecord[], flat: boolean, generation: number): Promise<void> {
		for (let offset = 0; offset < records.length; offset += 10) {
			if (generation !== this.generation || !this.contentEl.isShown()) { this.dirty = true; return }
			const batch = records.slice(offset, offset + 10)
			await Promise.all(batch.map(record => this.renderCard(root, record, flat, generation)))
			await new Promise<void>(resolve => setTimeout(resolve, 0))
		}
	}

	private async renderCard(root: HTMLElement, record: HighlightRecord, flat: boolean, generation: number): Promise<void> {
		const card = root.createEl('article', 'ditto-card')
		const line = flat ? sourceLine(record) : null
		if (line) {
			const sourceEl = card.createDiv('ditto-card-source')
			if (line.author) sourceEl.createEl('strong', { text: line.author })
			if (line.author && line.title) sourceEl.appendText(' · ')
			if (line.title) sourceEl.appendText(line.title)
		}
		const bodyEl = card.createDiv('ditto-card-body')
		try {
			const body = await this.plugin.store.body(record.path)
			if (generation !== this.generation) return
			await MarkdownRenderer.render(this.app, body || '*Empty highlight*', bodyEl, record.path, this.renderComponent!)
			if (generation !== this.generation) return
			const prefs = this.preferences()
			const tags = displayTags(prefs.favorites, prefs.illustrations, record.tags)
			const foot = card.createDiv('ditto-card-foot')
			const tagsEl = foot.createDiv('ditto-tags')
			tags.forEach(tag => tagsEl.createSpan({ text: tag }))
			tagsEl.hidden = !this.shownTags.has(record.path)
			const actions = foot.createDiv('ditto-actions')
			cardActions(flat, tags.length > 0).forEach((action: CardAction) => {
				if (action === 'open-highlight') this.iconButton(actions, 'highlighter', 'Open highlight note', () => this.openFile(record.path))
				else if (action === 'open-source') this.sourceIconButton(actions, record)
				else if (action === 'tags') {
					const button = this.iconButton(actions, 'tag', 'Show tags', () => {
						const shown = tagsEl.hidden
						tagsEl.hidden = !shown
						button.setAttribute('aria-pressed', String(shown))
						if (shown) this.shownTags.add(record.path)
						else this.shownTags.delete(record.path)
					})
					button.setAttribute('aria-pressed', String(!tagsEl.hidden))
				}
				else this.iconButton(actions, 'copy', 'Copy as callout', () => { void navigator.clipboard.writeText(formatCallout(record, body)).then(() => new Notice('Copied callout')).catch(() => new Notice('Could not copy callout')) })
			})
		} catch (error) {
			if (generation !== this.generation) return
			console.error('Ditto could not render highlight', record.path, error)
			card.addClass('is-failed')
			bodyEl.empty()
			setIcon(bodyEl, 'alert-circle')
			bodyEl.createSpan({ text: 'This highlight couldn’t load. The rest of the list still works; open the note to check it.' })
			const foot = card.createDiv('ditto-card-foot')
			foot.createDiv('ditto-tags')
			this.iconButton(foot.createDiv('ditto-actions'), 'highlighter', 'Open highlight note', () => this.openFile(record.path))
		}
	}

	// A source button stays in place when there is no source note: faded, inert, and saying why.
	private sourceIconButton(parent: HTMLElement, record: HighlightRecord): void {
		const source = sourceButton(record)
		const button = this.iconButton(parent, source.icon, source.label, () => { if (record.sourcePath) this.openFile(record.sourcePath) })
		// aria-disabled rather than disabled, so the tooltip still shows on hover
		if (!source.available) button.setAttribute('aria-disabled', 'true')
	}

	private iconButton(parent: HTMLElement, icon: string, label: string, action: () => void): HTMLButtonElement {
		const button = parent.createEl('button', { cls: 'ditto-icon-button', attr: { 'aria-label': label } })
		setIcon(button, icon)
		button.addEventListener('click', action)
		return button
	}

	private openFile(path: string): void {
		const file = this.app.vault.getAbstractFileByPath(path)
		if (file instanceof TFile) void this.app.workspace.getLeaf().openFile(file)
	}
}
