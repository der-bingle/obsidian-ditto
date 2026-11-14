import { Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf } from 'obsidian'
import { VIEW_TYPE, TAG_VIEW_TYPE, HIGHLIGHTS_PATH_PREFIX, DEFAULT_SCRIPTURE_NOTES_PATH } from './constants'
import { getScriptureNotePrefixes } from './scripture-api'
import { HighlightStore } from './highlight-store'
import { DittoView } from './view'
import { DittoState, Mode, ViewPreferences } from './types'

const defaultPreferences = (): ViewPreferences => ({ favorites: false, illustrations: false, order: 'asc', expanded: [], scroll: 0 })
const defaultState = (): DittoState => ({
	scripturePath: null,
	sectionByPath: {},
	scripture: defaultPreferences(),
	tags: { ...defaultPreferences(), selected: [], operator: 'and' }
})

interface SavedData { folder?: string }

class DittoSettings extends PluginSettingTab {
	constructor(private plugin: DittoPlugin) { super(plugin.app, plugin) }
	display(): void {
		this.containerEl.empty()
		new Setting(this.containerEl)
			.setName('Highlight folder')
			.setDesc('Vault path that contains highlight notes. Changes rebuild the metadata list.')
			.addText(text => text.setPlaceholder('Library/Highlights').setValue(this.plugin.folder).onChange(async value => {
				this.plugin.folder = value.trim() || 'Library/Highlights'
				this.plugin.store.setFolder(this.plugin.folder)
				await this.plugin.saveSettings()
			}))
	}
}

export default class DittoPlugin extends Plugin {
	state: DittoState = defaultState()
	folder = HIGHLIGHTS_PATH_PREFIX.replace(/\/$/, '')
	store!: HighlightStore

	async onload(): Promise<void> {
		const saved = (await this.loadData() || {}) as SavedData
		const local = (this.app.loadLocalStorage('ditto-state') || {}) as Partial<DittoState>
		const defaults = defaultState()
		this.folder = saved.folder || this.folder
		this.state = {
			...defaults, ...local,
			scripture: { ...defaults.scripture, ...local.scripture },
			tags: { ...defaults.tags, ...local.tags },
			sectionByPath: local.sectionByPath || {}
		}
		this.store = new HighlightStore(this.app, this.folder, () => this.refreshViews())
		this.addSettingTab(new DittoSettings(this))
		this.registerView(VIEW_TYPE, leaf => new DittoView(leaf, this, 'scripture'))
		this.registerView(TAG_VIEW_TYPE, leaf => new DittoView(leaf, this, 'tags'))
		this.addRibbonIcon('book-open', 'Open Ditto Scripture', () => { void this.activate('scripture') })
		this.addRibbonIcon('hash', 'Open Ditto Tags', () => { void this.activate('tags') })
		this.addCommand({ id: 'open-study-highlights', name: 'Open Ditto Scripture', icon: 'book-open', callback: () => { void this.activate('scripture') } })
		this.addCommand({ id: 'open-tag-highlights', name: 'Open Ditto Tags', icon: 'hash', callback: () => { void this.activate('tags') } })
		this.registerEvent(this.app.workspace.on('file-open', file => this.trackScripture(file)))
		this.registerEvent(this.app.metadataCache.on('changed', file => this.store.upsert(file)))
		this.registerEvent(this.app.metadataCache.on('resolved', () => this.store.refreshLinks()))
		this.registerEvent(this.app.vault.on('create', file => { if (file instanceof TFile) this.store.upsert(file) }))
		this.registerEvent(this.app.vault.on('modify', file => {
			if (file instanceof TFile) this.store.invalidateBody(file.path)
		}))
		this.registerEvent(this.app.vault.on('delete', file => this.store.remove(file.path)))
		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
			this.store.remove(oldPath)
			if (file instanceof TFile) this.store.upsert(file)
			if (this.state.scripturePath === oldPath) this.updateState({ scripturePath: file.path })
		}))
		this.app.workspace.onLayoutReady(() => this.trackScripture(this.app.workspace.getActiveFile()))
	}

	onunload(): void {
		this.app.saveLocalStorage('ditto-state', this.state)
		this.app.workspace.detachLeavesOfType(VIEW_TYPE)
		this.app.workspace.detachLeavesOfType(TAG_VIEW_TYPE)
	}

	async saveSettings(): Promise<void> { await this.saveData({ folder: this.folder }) }

	updateState(patch: Partial<DittoState>, refresh = true): void {
		this.state = { ...this.state, ...patch }
		this.app.saveLocalStorage('ditto-state', this.state)
		if (refresh) this.refreshViews()
	}

	trackScripture(file: TFile | null): void {
		if (!file) return
		const prefixes = getScriptureNotePrefixes(this.app, DEFAULT_SCRIPTURE_NOTES_PATH)
		if (prefixes.some(prefix => file.path.startsWith(prefix)) && file.path !== this.state.scripturePath) {
			this.updateState({ scripturePath: file.path })
		}
	}

	refreshViews(): void {
		for (const type of [VIEW_TYPE, TAG_VIEW_TYPE]) {
			this.app.workspace.getLeavesOfType(type).forEach(leaf => {
				if (leaf.view instanceof DittoView) void leaf.view.refresh()
			})
		}
	}

	async activate(mode: Mode): Promise<void> {
		const type = mode === 'scripture' ? VIEW_TYPE : TAG_VIEW_TYPE
		let leaf = this.app.workspace.getLeavesOfType(type)[0]
		if (!leaf) {
			// Reuse the right tab group; splitting it places Ditto below the other tabs.
			leaf = this.app.workspace.getRightLeaf(false) as WorkspaceLeaf
			await leaf.setViewState({ type, active: true })
		}
		await this.app.workspace.revealLeaf(leaf)
		if (leaf.view instanceof DittoView) await leaf.view.refresh()
	}
}
