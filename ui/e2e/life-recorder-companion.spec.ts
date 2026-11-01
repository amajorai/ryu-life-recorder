import { Buffer } from "node:buffer";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

const FIXTURE_SPEECH =
	"We agreed to review the mobile prototype on Thursday. Bring the revised onboarding flow and ask Maya for the latest feedback.";
const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");
const DEFAULT_EVIDENCE_DIRECTORY = path.join(
	REPO_ROOT,
	"docs/proof/test-coverage-sweep-20260924/evidence/life-recorder"
);

function appFrame(page: Page) {
	return page.frameLocator("iframe");
}

async function saveScreenshot(page: Page, name: string): Promise<void> {
	const evidenceDirectory =
		process.env.RYU_APPS_STORE_PROOF_DIR ?? DEFAULT_EVIDENCE_DIRECTORY;
	const destination = path.join(evidenceDirectory, name);
	await mkdir(path.dirname(destination), { recursive: true });
	await page.screenshot({
		animations: "disabled",
		fullPage: true,
		path: destination,
	});
}

function fixtureWav(): Buffer {
	const sampleRate = 16_000;
	const sampleCount = sampleRate / 2;
	const dataBytes = sampleCount * 2;
	const wav = Buffer.alloc(44 + dataBytes);
	wav.write("RIFF", 0);
	wav.writeUInt32LE(wav.length - 8, 4);
	wav.write("WAVE", 8);
	wav.write("fmt ", 12);
	wav.writeUInt32LE(16, 16);
	wav.writeUInt16LE(1, 20);
	wav.writeUInt16LE(1, 22);
	wav.writeUInt32LE(sampleRate, 24);
	wav.writeUInt32LE(sampleRate * 2, 28);
	wav.writeUInt16LE(2, 32);
	wav.writeUInt16LE(16, 34);
	wav.write("data", 36);
	wav.writeUInt32LE(dataBytes, 40);

	for (let sample = 0; sample < sampleCount; sample += 1) {
		const tone = Math.sin((2 * Math.PI * 440 * sample) / sampleRate);
		wav.writeInt16LE(Math.round(tone * 8192), 44 + sample * 2);
	}

	return wav;
}

test("records, saves and reads back a transcript with a deterministic local model recap", async ({
	page,
}) => {
	const browserErrors: string[] = [];
	page.on("pageerror", (error) => browserErrors.push(error.message));
	await page.goto("/");
	const app = appFrame(page);

	await app.getByRole("button", { name: "Record conversation" }).click();
	await expect(
		app.getByRole("button", { name: "Stop and transcribe" })
	).toBeVisible();
	await expect(
		app.getByRole("status").filter({ hasText: "Microphone on" })
	).toBeVisible();
	await page.waitForTimeout(700);
	await app.getByRole("button", { name: "Stop and transcribe" }).click();
	await expect(
		app.getByRole("heading", { name: "Recorded conversation" })
	).toBeVisible();
	await expect(app.getByText(FIXTURE_SPEECH, { exact: true })).toBeVisible();
	await expect(
		app.getByText(
			"Transcript saved. The temporary microphone recording was removed."
		)
	).toBeVisible();

	await app.getByRole("button", { name: "Save moment" }).click();
	await expect(
		app.getByRole("button", { name: "Unsave moment" })
	).toBeVisible();
	await expect(
		app.getByRole("option", { name: /Recorded conversation/ })
	).toBeVisible();
	await app.getByRole("button", { name: "Create recap" }).click();
	const recapSection = app
		.locator(".recorder-detail .ryu-app-section")
		.filter({ has: app.getByRole("heading", { name: "Recap" }) });
	await expect(recapSection).toContainText(
		"Review the mobile prototype on Thursday."
	);
	await expect(recapSection).toContainText("Next steps");
	await expect(
		app.getByRole("button", { name: "Regenerate recap" })
	).toBeEnabled();
	await app.getByRole("button", { name: "Regenerate recap" }).click();
	await expect(app.getByText("Recap added to your moment.")).toBeVisible();
	await expect(recapSection).toContainText("Next steps");
	await saveScreenshot(page, "recorded-saved-recap.png");

	await page.setViewportSize({ width: 390, height: 844 });
	await app.getByRole("button", { name: "Back to moments" }).click();
	await app.getByLabel("Search moments").fill("Maya");
	const savedMoment = app.getByRole("option", {
		name: /Recorded conversation/,
	});
	await expect(savedMoment).toBeVisible();
	await app.getByRole("button", { name: "Saved", exact: true }).click();
	await expect(savedMoment).toBeVisible();
	await savedMoment.click();
	await expect(app.getByText(FIXTURE_SPEECH, { exact: true })).toBeVisible();
	await expect(
		app.getByRole("button", { name: "Unsave moment" })
	).toBeVisible();
	expect(browserErrors).toEqual([]);
});

test("rewinds Shadow speech and keeps the selected range visible after saving", async ({
	page,
}) => {
	await page.goto("/");
	const app = appFrame(page);

	await app.getByRole("button", { name: "Rewind 15 seconds" }).click();
	await expect(
		app.getByRole("heading", { name: "What was just said" })
	).toBeVisible();
	await expect(app.getByText(FIXTURE_SPEECH, { exact: true })).toBeVisible();
	await expect(app.getByText("Preview · not saved")).toBeVisible();
	await app.getByRole("button", { name: "Save moment" }).click();
	await expect(
		app.getByRole("button", { name: "Unsave moment" })
	).toBeVisible();
	await expect(
		app.getByRole("option", { name: /What was just said/ })
	).toBeVisible();

	await app.getByRole("button", { name: "Last 5 minutes" }).click();
	await expect(
		app.getByRole("heading", { name: "Recent conversation" })
	).toBeVisible();
	await expect(app.getByText(FIXTURE_SPEECH, { exact: true })).toBeVisible();
	await app.getByRole("button", { name: "Save moment" }).click();
	await expect(
		app.getByRole("option", { name: /Recent conversation/ })
	).toBeVisible();
	await saveScreenshot(page, "shadow-rewind-saved.png");
});

test("imports WAV, adds a note, exports Markdown, and confirms deletion", async ({
	page,
}) => {
	await page.goto("/");
	const app = appFrame(page);
	const importInput = app.getByLabel("Import audio recording");
	await importInput.setInputFiles({
		name: "prototype-review.wav",
		mimeType: "audio/wav",
		buffer: fixtureWav(),
	});
	await expect(
		app.getByRole("heading", { name: "prototype-review" })
	).toBeVisible();
	await expect(app.getByText("Audio import", { exact: true })).toBeVisible();
	await expect(app.getByText(FIXTURE_SPEECH, { exact: true })).toBeVisible();
	await expect(
		app.getByText(
			"Recording transcribed. Your audio has not been stored in Life Recorder."
		)
	).toBeVisible();
	await expect(importInput).toHaveValue("");
	await app.getByRole("button", { name: "Save moment" }).click();
	await expect(
		app.getByRole("button", { name: "Unsave moment" })
	).toBeVisible();

	await app.getByRole("button", { name: "Add a note" }).click();
	const canceledNoteDialog = app.getByRole("dialog");
	await expect(
		canceledNoteDialog.getByRole("heading", { name: "Add a moment" })
	).toBeVisible();
	await canceledNoteDialog.getByLabel("Moment title").fill("Cancelled note");
	await canceledNoteDialog.getByRole("button", { name: "Cancel" }).click();
	await expect(canceledNoteDialog).toBeHidden();
	await expect(app.getByRole("option", { name: /Cancelled note/ })).toHaveCount(
		0
	);

	await app.getByRole("button", { name: "Add a note" }).click();
	const noteDialog = app.getByRole("dialog");
	await expect(
		noteDialog.getByRole("heading", { name: "Add a moment" })
	).toBeVisible();
	await noteDialog.getByLabel("Moment title").fill("Team lunch follow-up");
	await noteDialog
		.getByLabel("What happened")
		.fill("Ask Maya to share the revised onboarding flow.");
	await noteDialog.getByRole("button", { name: "Add moment" }).click();
	await expect(
		app.getByRole("heading", { name: "Team lunch follow-up" })
	).toBeVisible();
	await expect(
		app.getByText("Ask Maya to share the revised onboarding flow.", {
			exact: true,
		})
	).toBeVisible();
	await expect(app.getByText("Moment added.")).toBeVisible();
	const noteOption = app.getByRole("option", {
		name: /Team lunch follow-up/,
	});
	await expect(app.getByRole("option")).toHaveCount(2);
	await app.getByRole("button", { name: "Saved", exact: true }).click();
	await expect(
		app.getByRole("option", { name: /prototype-review/ })
	).toBeVisible();
	await expect(noteOption).toHaveCount(0);
	await app.getByRole("button", { name: "Recent", exact: true }).click();
	await expect(noteOption).toBeVisible();
	await noteOption.click();
	await expect(
		app.getByRole("heading", { name: "Team lunch follow-up" })
	).toBeVisible();

	await app.getByRole("button", { name: "Export text" }).click();
	const exportDialog = app.getByRole("dialog", { name: "Export moment" });
	const exported = exportDialog.getByRole("textbox", {
		name: "Exported moment",
	});
	await exported.focus();
	const markdown = await exported.inputValue();
	expect(markdown).toContain("# Team lunch follow-up");
	expect(markdown).toContain("note ·");
	expect(markdown).toContain("Ask Maya to share the revised onboarding flow.");
	expect(
		await exported.evaluate(
			(field: HTMLTextAreaElement) =>
				field.selectionStart === 0 && field.selectionEnd === field.value.length
		)
	).toBe(true);
	await saveScreenshot(page, "note-markdown-export.png");
	await exportDialog.getByRole("button", { name: "Done" }).click();

	const deleteButton = app
		.locator(".recorder-detail")
		.getByRole("button", { name: "Delete moment" });
	await deleteButton.click();
	const deleteDialog = app.getByRole("dialog", { name: "Delete this moment?" });
	await expect(deleteDialog).toBeVisible();
	await deleteDialog.getByRole("button", { name: "Cancel" }).click();
	await expect(deleteDialog).toBeHidden();
	await expect(
		app.getByRole("heading", { name: "Team lunch follow-up" })
	).toBeVisible();
	await deleteButton.click();
	await app
		.getByRole("dialog", { name: "Delete this moment?" })
		.getByRole("button", { name: "Delete moment" })
		.click();
	await expect(app.getByText("Moment deleted.")).toBeVisible();
	await expect(
		app.getByRole("heading", { name: "A little help remembering" })
	).toBeVisible();
});

test("reloads the private library after a deterministic storage error", async ({
	page,
}) => {
	await page.goto("/?fixture=storage-retry");
	const app = appFrame(page);

	await expect(app.getByRole("alert")).toContainText(
		"The local fixture storage is temporarily unavailable."
	);
	await app.getByRole("button", { name: "Reload library" }).click();
	await expect(app.getByRole("alert")).toHaveCount(0);
	await expect(
		app.getByRole("heading", { name: "Your day starts here" })
	).toBeVisible();
});

test("canceling a live recording keeps it running and confirmed discard returns to idle", async ({
	page,
}) => {
	await page.goto("/");
	const app = appFrame(page);
	const discardButton = app
		.locator(".recorder-start")
		.getByRole("button", { name: "Discard recording" });
	await app.getByRole("button", { name: "Record conversation" }).click();
	await expect(
		app.getByRole("button", { name: "Stop and transcribe" })
	).toBeVisible();
	await discardButton.click();
	const discardDialog = app.getByRole("dialog", {
		name: "Discard this recording?",
	});
	await expect(discardDialog).toBeVisible();
	await discardDialog.getByRole("button", { name: "Cancel" }).click();
	await expect(discardDialog).toBeHidden();
	await expect(
		app.getByRole("button", { name: "Stop and transcribe" })
	).toBeVisible();
	await discardButton.click();
	await app
		.getByRole("dialog", { name: "Discard this recording?" })
		.getByRole("button", { name: "Discard recording" })
		.click();
	await expect(
		app.getByRole("button", { name: "Record conversation" })
	).toBeVisible();
	await expect(app.getByText("Microphone on", { exact: false })).toHaveCount(0);
});
