import { Component, ItemView, MarkdownRenderer, Notice, setIcon, SuggestModal, TFile, WorkspaceLeaf } from 'obsidian'
import type DittoPlugin from './main'
import { VIEW_TYPE, TAG_VIEW_TYPE } from './constants'
import { HighlightRecord, Mode, ViewPreferences } from './types'
import { groupHighlights, matchesCategories, matchesSection, matchesTags, normalizeTag, sectionTags, sortHighlights } from './query'
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

export class DittoView extends ItemView {
	private generation = 0
	private renderComponent: Component | null = null
	private dirty = true
	private scrollTimer: number | null = null
	private visibilityObserver: MutationObserver | null = null

	constructor(leaf: WorkspaceLeaf, private plugin: DittoPlugin, private mode: Mode) { super(leaf) }
	getViewType(): string { return this.mode === 'scripture' ? VIEW_TYPE : TAG_VIEW_TYPE }
	getDisplayText(): string { return this.mode === 'scripture' ? 'Ditto Scripture' : 'Ditto Tags' }
	getIcon(): string { return this.mode === 'scripture' ? 'book-open' : 'tags' }

	async onOpen(): Promise<void> {
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
		this.contentEl.empty()
		this.contentEl.createDiv({ cls: 'ditto-state', text: 'Loading highlights…' })
		try {
			await this.plugin.store.ensureReady()
			if (generation !== this.generation) return
			this.render(generation)
			this.dirty = false
		} catch (error) {
			if (generation !== this.generation) return
			console.error('Ditto could not load highlights', error)
			this.contentEl.empty()
			this.contentEl.createDiv({ cls: 'ditto-state', text: 'Could not load highlights.' })
		}
	}

	private render(generation: number): void {
		const state = this.plugin.state
		const prefs = this.preferences()
		const scripturePath = state.scripturePath
		this.contentEl.empty()
		const root = this.contentEl.createDiv('ditto-root')
		root.createEl('h3', { text: this.getDisplayText() })
		if (this.mode === 'scripture') root.createDiv({ cls: 'ditto-context', text: scripturePath ? scripturePath.replace(/\.md$/, '').split('/').pop() : 'Open a Scripture note to choose a passage.' })
		else this.renderTagControls(root)
		const records = this.plugin.store.all().filter(record => this.mode === 'scripture'
			? !!scripturePath && record.scripturePaths.includes(scripturePath)
			: matchesTags(state.tags.selected, state.tags.operator, record.tags))
		if (this.mode === 'scripture' && scripturePath) this.renderSectionControl(root, records, scripturePath)
		this.renderCommonControls(root, prefs)
		const section = scripturePath ? state.sectionByPath[scripturePath] || 'all' : 'all'
		const selected = records.filter(record =>
			matchesCategories(prefs.favorites, prefs.illustrations, record.tags) &&
			(this.mode !== 'scripture' || !scripturePath || matchesSection(section, scripturePath, record)))
		root.createDiv({ cls: 'ditto-count', text: `${selected.length} ${selected.length === 1 ? 'highlight' : 'highlights'}` })
		if (!selected.length) {
			const message = this.mode === 'tags' && !state.tags.selected.length ? 'Choose one or more tags.' : 'No highlights match this view.'
			root.createDiv({ cls: 'ditto-state', text: message })
			return
		}
		if (prefs.favorites || prefs.illustrations) {
			void this.renderCards(root, sortHighlights(prefs.order, selected), generation)
		} else {
			groupHighlights(prefs.order, selected).forEach(group => this.renderGroup(root, group.source, group.highlights, generation))
		}
		this.contentEl.scrollTop = prefs.scroll
	}

	private renderTagControls(root: HTMLElement): void {
		const prefs = this.plugin.state.tags
		const row = root.createDiv('ditto-query')
		const add = row.createEl('button', { text: 'Add tag' })
		add.addEventListener('click', () => new TagPicker(this.plugin).open())
		const operator = row.createEl('select', { attr: { 'aria-label': 'Tag operator' } })
		operator.createEl('option', { text: 'All tags (AND)', value: 'and' })
		operator.createEl('option', { text: 'Any tag (OR)', value: 'or' })
		operator.value = prefs.operator
		operator.addEventListener('change', () => this.plugin.updateState({ tags: { ...this.plugin.state.tags, operator: operator.value as 'and' | 'or' } }))
		const chips = root.createDiv('ditto-chips')
		prefs.selected.forEach(tag => {
			const chip = chips.createEl('button', { text: `#${tag} ×`, attr: { 'aria-label': `Remove ${tag}` } })
			chip.addEventListener('click', () => this.plugin.updateState({ tags: { ...this.plugin.state.tags, selected: this.plugin.state.tags.selected.filter(value => value !== tag) } }))
		})
	}

	private renderSectionControl(root: HTMLElement, records: HighlightRecord[], scripturePath: string): void {
		const sections = [...new Set(records.flatMap(record => sectionTags(record.tags, scripturePath)))].sort()
		if (!sections.length) return
		const row = root.createDiv('ditto-section')
		row.createSpan({ text: 'Passage section' })
		const select = row.createEl('select', { attr: { 'aria-label': 'Passage section' } })
		select.createEl('option', { text: 'All sections', value: 'all' })
		sections.forEach(section => select.createEl('option', { text: section.replace(/-/g, ' '), value: section }))
		select.value = this.plugin.state.sectionByPath[scripturePath] || 'all'
		select.addEventListener('change', () => this.plugin.updateState({ sectionByPath: { ...this.plugin.state.sectionByPath, [scripturePath]: select.value } }))
	}

	private renderCommonControls(root: HTMLElement, prefs: ViewPreferences): void {
		const row = root.createDiv('ditto-controls')
		for (const [key, label] of [['favorites', 'Favorites'], ['illustrations', 'Illustrations']] as const) {
			const button = row.createEl('button', { text: label, cls: prefs[key] ? 'is-active' : '' })
			button.setAttribute('aria-pressed', String(prefs[key]))
			button.addEventListener('click', () => this.updatePreferences({ [key]: !this.preferences()[key] }))
		}
		const order = row.createEl('select', { attr: { 'aria-label': 'Date order' } })
		order.createEl('option', { text: 'Oldest first', value: 'asc' })
		order.createEl('option', { text: 'Newest first', value: 'desc' })
		order.value = prefs.order
		order.addEventListener('change', () => this.updatePreferences({ order: order.value as 'asc' | 'desc' }))
	}

	private renderGroup(root: HTMLElement, source: string, records: HighlightRecord[], generation: number): void {
		const group = root.createDiv('ditto-group')
		const header = group.createEl('button', { cls: 'ditto-group-header' })
		const expanded = this.preferences().expanded.includes(source)
		const icon = header.createSpan()
		setIcon(icon, expanded ? 'chevron-down' : 'chevron-right')
		header.createSpan({ text: `${source} (${records.length})` })
		const sourcePath = records[0]?.sourcePath
		if (sourcePath) {
			const open = group.createEl('button', { cls: 'ditto-source-open', attr: { 'aria-label': `Open ${source}` } })
			setIcon(open, records[0].isBook ? 'book-open' : 'external-link')
			open.addEventListener('click', () => this.openFile(sourcePath))
		}
		header.addEventListener('click', () => {
			const expandedNow = this.preferences().expanded
			this.updatePreferences({ expanded: expandedNow.includes(source) ? expandedNow.filter(value => value !== source) : [...expandedNow, source] })
		})
		if (expanded) void this.renderCards(group.createDiv('ditto-group-body'), records, generation)
	}

	private async renderCards(root: HTMLElement, records: HighlightRecord[], generation: number): Promise<void> {
		for (let offset = 0; offset < records.length; offset += 10) {
			if (generation !== this.generation || !this.contentEl.isShown()) { this.dirty = true; return }
			const batch = records.slice(offset, offset + 10)
			await Promise.all(batch.map(record => this.renderCard(root, record, generation)))
			await new Promise<void>(resolve => setTimeout(resolve, 0))
		}
	}

	private async renderCard(root: HTMLElement, record: HighlightRecord, generation: number): Promise<void> {
		const card = root.createDiv('ditto-card')
		card.createDiv({ cls: 'ditto-attribution', text: record.source })
		const bodyEl = card.createDiv('ditto-body')
		try {
			const body = await this.plugin.store.body(record.path)
			if (generation !== this.generation) return
			await MarkdownRenderer.render(this.app, body || '*Empty highlight*', bodyEl, record.path, this.renderComponent!)
			if (generation !== this.generation) return
			const actions = card.createDiv('ditto-actions')
			this.action(actions, 'external-link', 'Open highlight', () => this.openFile(record.path))
			if (record.sourcePath) this.action(actions, 'book-open', 'Open source', () => this.openFile(record.sourcePath!))
			this.action(actions, 'copy', 'Copy as callout', () => { void navigator.clipboard.writeText(formatCallout(record, body)).then(() => new Notice('Copied callout')).catch(() => new Notice('Could not copy callout')) })
			if (record.tags.length) actions.createSpan({ text: record.tags.map(tag => `#${tag}`).join(' '), cls: 'ditto-card-tags' })
			if (record.readwiseId) actions.createSpan({ text: `Readwise ${record.readwiseId}`, cls: 'ditto-readwise-id' })
		} catch (error) {
			if (generation !== this.generation) return
			console.error('Ditto could not render highlight', record.path, error)
			bodyEl.setText('Could not load this highlight.')
		}
	}

	private action(parent: HTMLElement, icon: string, label: string, action: () => void): void {
		const button = parent.createEl('button', { attr: { 'aria-label': label, title: label } })
		setIcon(button, icon)
		button.addEventListener('click', action)
	}

	private openFile(path: string): void {
		const file = this.app.vault.getAbstractFileByPath(path)
		if (file instanceof TFile) void this.app.workspace.getLeaf().openFile(file)
	}
}
