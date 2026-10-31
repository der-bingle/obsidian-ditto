import { HighlightRecord } from './types'

// Takes highlight body text and returns the newer callout with a hidden highlight link.
export const formatCallout = (record: HighlightRecord, body: string): string => {
	const lines = body.split('\n')
	const linkedBody = lines.map((line, index) => index === lines.length - 1 ? `${line} [[${record.id}|]]` : line)
	const quoted = linkedBody.map(line => `> ${line}`).join('\n')
	return `> [!quote] ${record.attributionLink || record.attribution || record.source}\n${quoted}`
}
