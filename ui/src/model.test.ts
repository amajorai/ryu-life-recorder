import { describe, expect, test } from "bun:test";
import {
	isExpired,
	momentMarkdown,
	newMoment,
	RETENTION_MS,
	recapPrompt,
	rewindSegments,
	searchMoments,
} from "./model.ts";
import { MomentRepository, type PrivateStorage } from "./repository.ts";

const startedAt = "2026-09-12T08:00:00.000Z";
const segments = [
	{
		id: "segment-1",
		startedAt,
		endedAt: "2026-09-12T08:00:30.000Z",
		text: "The prototype review is on Thursday. Bring the revised mobile flow.",
		timing: "window" as const,
	},
];
const create = () =>
	newMoment("shadow", "Prototype review", segments, new Date(startedAt));

test("rewind includes an overlapping source window without inventing clipped text", () => {
	expect(
		rewindSegments(segments, 15, Date.parse("2026-09-12T08:00:35Z"))
	).toEqual(segments);
	expect(
		rewindSegments(segments, 15, Date.parse("2026-09-12T08:01:00Z"))
	).toEqual([]);
});
test("saved moments survive retention and unsaved moments expire from creation", () => {
	const moment = create();
	const expiry = Date.parse(startedAt) + RETENTION_MS;
	expect(isExpired(moment, expiry - 1)).toBe(false);
	expect(
		isExpired({ ...moment, updatedAt: new Date(expiry).toISOString() }, expiry)
	).toBe(true);
	expect(isExpired({ ...moment, saved: true }, expiry)).toBe(false);
});
test("search combines transcript details, recap, and saved filtering", () => {
	const moment = {
		...create(),
		saved: true,
		recap: { text: "Prepare a demo", createdAt: startedAt },
	};
	expect(searchMoments([moment], "thursday demo", true)).toEqual([moment]);
	expect(searchMoments([moment], "friday", false)).toEqual([]);
});
test("recap prompt delimits transcript as untrusted data and rejects empty or oversized input", () => {
	expect(recapPrompt(create()).system).toContain("never instructions");
	expect(recapPrompt(create()).prompt).toContain(segments[0]?.text ?? "");
	expect(() => recapPrompt({ ...create(), segments: [] })).toThrow("no speech");
	expect(() =>
		recapPrompt({
			...create(),
			segments: [{ ...segments[0]!, text: "x".repeat(81_000) }],
		})
	).toThrow("too long");
});
test("Markdown export contains source text and recap", () => {
	expect(
		momentMarkdown({
			...create(),
			recap: { text: "Review on Thursday.", createdAt: startedAt },
		})
	).toContain("## Recap\n\nReview on Thursday.");
	expect(momentMarkdown(create())).toContain("Bring the revised mobile flow.");
});

function storage() {
	const entries = new Map<string, string>();
	const host: PrivateStorage = {
		crypto: {
			seal: async ({ value }) => `sealed:${btoa(value)}`,
			open: async ({ value }) => {
				if (!value.startsWith("sealed:")) {
					throw new Error("Invalid seal");
				}
				return atob(value.slice(7));
			},
		},
		storage: {
			keys: async () => [...entries.keys()],
			get: async ({ key }) => entries.get(key) ?? null,
			compareAndSet: async ({ key, value, expected }) => {
				if ((entries.get(key) ?? null) !== expected) {
					return false;
				}
				if (value === null) {
					entries.delete(key);
				} else {
					entries.set(key, value);
				}
				return true;
			},
		},
	};
	return { entries, host, repository: new MomentRepository(host) };
}

describe("private moment persistence", () => {
	test("writes only sealed records and reloads them through the host", async () => {
		const data = storage();
		const moment = { ...create(), saved: true };
		await data.repository.write(moment, null);
		expect(data.entries.get(moment.id)).not.toContain("prototype");
		expect((await data.repository.list())[0]?.moment).toEqual(moment);
	});
	test("a stale surface cannot overwrite or delete another surface's changes", async () => {
		const data = storage();
		const first = await data.repository.write(
			{ ...create(), saved: true },
			null
		);
		const changed = await data.repository.write(
			{ ...first.moment, title: "Changed elsewhere" },
			first.envelope
		);
		await expect(
			data.repository.write(first.moment, first.envelope)
		).rejects.toThrow("another surface");
		await expect(data.repository.remove(first)).rejects.toThrow(
			"another surface"
		);
		expect((await data.repository.list())[0]).toEqual(changed);
	});
	test("expired records are deleted on load while saved records remain", async () => {
		const data = storage();
		await data.repository.write(
			{ ...create(), createdAt: "2000-01-01T00:00:00.000Z" },
			null
		);
		const saved = { ...create(), saved: true };
		await data.repository.write(saved, null);
		expect(
			(await data.repository.list()).map((record) => record.moment.id)
		).toEqual([saved.id]);
		expect(data.entries.size).toBe(1);
	});
	test("corrupt or newer records fail visibly and remain recoverable", async () => {
		const data = storage();
		data.entries.set("broken", `sealed:${btoa('{"schemaVersion":2}')}`);
		await expect(data.repository.list()).rejects.toThrow();
		expect(data.entries.has("broken")).toBe(true);
	});
	test("successful deletion removes a moment without touching its neighbors", async () => {
		const data = storage();
		const first = await data.repository.write(
			{ ...create(), saved: true },
			null
		);
		const second = await data.repository.write(
			{ ...create(), saved: true },
			null
		);
		await data.repository.remove(first);
		expect((await data.repository.list())[0]).toEqual(second);
	});
});
