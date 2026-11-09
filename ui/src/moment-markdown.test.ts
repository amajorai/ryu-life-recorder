import { describe, expect, test } from "bun:test";
import { formatMessage, type MessageValuesInput } from "@ryu/i18n/lite";
import { momentMarkdown, newMoment } from "./model.ts";
import { momentSourceLabel } from "./moment-source-labels.ts";

// A stub German catalog stands in for the shipped one.
const DE: Record<string, string> = {
	"Audio import": "Audioimport",
	Microphone: "Mikrofon",
	"Personal note": "Persönliche Notiz",
	Recap: "Zusammenfassung",
	Transcript: "Transkript",
};
const de = (source: string, values?: MessageValuesInput) =>
	formatMessage(DE[source] ?? source, values, "de");

const deFormat = {
	dateTime: (value: string) =>
		new Intl.DateTimeFormat("de", {
			dateStyle: "medium",
			timeStyle: "short",
			timeZone: "UTC",
		}).format(new Date(value)),
	time: (value: string) =>
		new Intl.DateTimeFormat("de", {
			timeStyle: "medium",
			timeZone: "UTC",
		}).format(new Date(value)),
};

const startedAt = "2026-09-12T08:00:00.000Z";
const moment = {
	...newMoment(
		"microphone",
		"Prototype review",
		[
			{
				id: "segment-1",
				startedAt: "2026-09-12T08:00:05.000Z",
				endedAt: "2026-09-12T08:00:30.000Z",
				text: "Bring the revised mobile flow.",
				timing: "window",
			},
		],
		new Date(startedAt)
	),
	recap: { text: "Review on Thursday.", createdAt: startedAt },
};

describe("momentMarkdown in German", () => {
	const markdown = momentMarkdown(moment, de, deFormat);

	test("headings and the source are translated", () => {
		expect(markdown).toContain("## Zusammenfassung\n\nReview on Thursday.");
		expect(markdown).toContain("## Transkript\n\n");
		expect(markdown).toContain(`Mikrofon · ${deFormat.dateTime(startedAt)}`);
		expect(markdown).not.toContain("## Recap");
		expect(markdown).not.toMatch(/\bmicrophone\b/);
	});

	test("times are formatted, never raw ISO", () => {
		expect(markdown).toContain("[08:00:05] Bring the revised mobile flow.");
		expect(markdown).not.toContain("2026-09-12T");
	});

	test("title and speech stay verbatim", () => {
		expect(markdown.startsWith("# Prototype review\n")).toBe(true);
	});
});

describe("momentSourceLabel", () => {
	test("every stored source has its own label", () => {
		expect(momentSourceLabel("import", de)).toBe("Audioimport");
		expect(momentSourceLabel("note", de)).toBe("Persönliche Notiz");
		expect(momentSourceLabel("shadow", de)).toBe("Shadow");
		expect(momentSourceLabel("microphone", de)).toBe("Mikrofon");
	});
});
