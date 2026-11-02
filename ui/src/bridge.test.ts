import { expect, test } from "bun:test";
import { transcribedMoment } from "./bridge.ts";

const startedAt = "2026-09-28T09:00:00.000Z";

test("keeps legacy text replies as window-timed imported speech", () => {
	const moment = transcribedMoment(
		"  Review the prototype.  ",
		"import",
		"Recording",
		startedAt,
		4000
	);
	expect(moment.segments[0]).toMatchObject({
		text: "Review the prototype.",
		startedAt,
		endedAt: "2026-09-28T09:00:04.000Z",
		timing: "window",
	});
});

test("keeps valid segment timing and falls back when timestamps exceed the recording", () => {
	const reply = {
		text: "Review the prototype.",
		segments: [{ text: "Review the prototype.", startMs: 1000, endMs: 3000 }],
	};
	expect(
		transcribedMoment(reply, "microphone", "Recording", startedAt, 4000)
			.segments[0]
	).toMatchObject({
		startedAt: "2026-09-28T09:00:01.000Z",
		endedAt: "2026-09-28T09:00:03.000Z",
		timing: "segment",
	});
	expect(
		transcribedMoment(reply, "microphone", "Recording", startedAt, 1000)
			.segments[0]
	).toMatchObject({
		startedAt,
		endedAt: "2026-09-28T09:00:01.000Z",
		timing: "window",
	});
});

test("refuses empty imported speech while accepting an empty live recording", () => {
	expect(() =>
		transcribedMoment(" ", "import", "Recording", startedAt, 4000)
	).toThrow("No speech was returned");
	expect(
		transcribedMoment(" ", "microphone", "Recording", startedAt, 4000).segments
	).toEqual([]);
});
