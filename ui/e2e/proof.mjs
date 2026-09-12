import { resolve } from "node:path";
import { chromium } from "../../../../apps/desktop/node_modules/@playwright/test/index.mjs";

const browser = await chromium.launch({
	args: [
		"--use-fake-ui-for-media-stream",
		"--use-fake-device-for-media-stream",
	],
});
const island = process.env.PROOF_SURFACE === "island";
try {
	const page = await browser.newPage({
		viewport: { width: 1440, height: 1000 },
	});
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto(`http://127.0.0.1:4391${island ? "/?surface=island" : ""}`);
	const app = page.frameLocator("iframe");
	await app
		.getByRole("button", { name: "Rewind 15 seconds", exact: true })
		.click();
	await app
		.getByRole("heading", { name: "What was just said", exact: true })
		.waitFor();
	await app.getByRole("button", { name: "Save moment", exact: true }).click();
	await app.getByRole("button", { name: "Create recap", exact: true }).click();
	await app
		.getByRole("button", { name: "Regenerate recap", exact: true })
		.waitFor();
	await page.screenshot({
		path: resolve(
			`docs/proof/life-recorder/${island ? "island" : "desktop"}.png`
		),
		fullPage: true,
	});
	await app.getByRole("button", { name: "Export text", exact: true }).click();
	await app.getByRole("textbox", { name: "Exported moment" }).waitFor();
	await page.keyboard.press("Escape");
	await app.getByRole("button", { name: "Delete moment", exact: true }).click();
	await app.getByRole("button", { name: "Cancel", exact: true }).click();
	await app
		.getByRole("heading", { name: "What was just said", exact: true })
		.waitFor();
	await page.setViewportSize({ width: 390, height: 844 });
	if (!island) {
		await page.screenshot({
			path: resolve("docs/proof/life-recorder/mobile-width.png"),
			fullPage: true,
		});
	}
	await app
		.getByRole("button", { name: "Back to moments", exact: true })
		.click();
	await app.getByRole("textbox", { name: "Search moments" }).fill("Maya");
	await app.getByRole("option", { name: /What was just said/ }).waitFor();
	if (!island) {
		await app
			.getByRole("button", { name: "Record conversation", exact: true })
			.click();
		await app
			.getByRole("button", { name: "Stop and transcribe", exact: true })
			.waitFor();
		await page.waitForTimeout(600);
		await app
			.getByRole("button", { name: "Stop and transcribe", exact: true })
			.click();
		await app
			.getByRole("heading", { name: "Recorded conversation", exact: true })
			.waitFor();
		await app
			.getByRole("button", { name: "Delete moment", exact: true })
			.click();
		await app
			.getByRole("dialog")
			.getByRole("button", { name: "Delete moment", exact: true })
			.click();
		await app
			.getByRole("heading", { name: "Recorded conversation", exact: true })
			.waitFor({ state: "detached" });
	}
	if (errors.length) {
		throw new Error(errors.join("\n"));
	}
	console.log(
		`PASS: ${island ? "Island" : "desktop"} packed app, rewind, persistence, recap, export, deletion cancel, responsive layout and transcript search; no page errors.`
	);
} finally {
	await browser.close();
}
