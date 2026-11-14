# Ditto

Ditto is an Obsidian plugin for research highlights. It adds separate Scripture and Tag views in the sidebar.

## Views

### Scripture

The Scripture view finds highlights linked to the active Scripture note. It keeps the last Scripture passage visible when you open another note. It groups highlights by source when the category filters are off.

You can filter highlights by section. The view sorts highlight dates from oldest to newest. You can copy a highlight with its source and a link to the highlight note.

### Tags

The Tag view finds highlights that match a tag query. It keeps its query separate from the Scripture view. Research state stays on the current device.

Favorites and Illustrations are independent filters. If you select both filters, Ditto shows highlights that match both. When either filter is active, Ditto shows a flat list instead of source groups.

## Install with BRAT

1. Install the BRAT plugin from Obsidian's Community Plugins.
2. Open BRAT settings.
3. Add `der-bingle/obsidian-ditto` as a beta plugin.
4. Enable Ditto in Obsidian's Community Plugins settings.

## Use the views

Use the separate ribbon buttons to open the Scripture and Tag views. You can also open each view from the command palette. Each view remains in the sidebar until you close it.

## Appearance

Ditto follows your theme's colors and fonts in light and dark mode. With the [Style Settings](https://github.com/mgmeyers/obsidian-style-settings) plugin you can adjust its fonts, text sizes, spacing, control heights and colors under **Ditto**.

## Data and privacy

Ditto reads highlight metadata and the body text for visible results from your vault. It does not send vault content to a server. It does not change your notes.

Ditto adds no saved-search manager. Tag research state stays on the current device.

## Development

Install dependencies and build the plugin:

```sh
npm install
npm run build
```

For development with automatic rebuilds, run:

```sh
npm run dev
```

## License

MIT
