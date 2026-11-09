import { describe, expect, test } from "bun:test";
import {
	namedAssertionIsPresent,
	reconcileLocalInteractionMap,
} from "../../../../apps-store/companion-suite.mjs";

const centralRow = {
	component: "App",
	events: "onClick",
	line: "372",
	package: "life-recorder",
	source_file: "apps-store/life-recorder/ui/src/App.tsx",
	tag: "Button",
};

function localMap(assertions = [assertion()], overrides = {}) {
	return {
		assertions,
		evidenceBoundary: "Local browser fixtures only.",
		expectedRows: assertions.length,
		package: "life-recorder",
		selector: {
			config: "e2e/life-recorder-companion.playwright.config.ts",
			spec: "e2e/life-recorder-companion.spec.ts",
		},
		scope: "complete",
		version: 1,
		...overrides,
	};
}

function assertion(row = centralRow) {
	return {
		assertionMarker: "Stop and transcribe",
		assertionName: "Recording exposes a visible stop action",
		row,
		testTitle: "capture flow",
	};
}

describe("package-owned Companion interaction maps", () => {
	test("joins an assertion to one exact source-row identity", () => {
		const result = reconcileLocalInteractionMap(
			"life-recorder",
			[centralRow],
			localMap()
		);
		expect(result).toHaveLength(1);
		expect(result[0]?.row).toEqual(centralRow);
		expect(result[0]?.assertion.assertionName).toBe(
			"Recording exposes a visible stop action"
		);
	});

	test("rejects duplicate, stale, ambiguous, and missing row identities", () => {
		const duplicate = assertion();
		expect(() =>
			reconcileLocalInteractionMap(
				"life-recorder",
				[centralRow],
				localMap([duplicate, { ...duplicate }], {
					expectedRows: 2,
					scope: "partial",
				})
			)
		).toThrow("duplicates an interaction identity");

		const stale = assertion({ ...centralRow, line: "373" });
		expect(() =>
			reconcileLocalInteractionMap(
				"life-recorder",
				[centralRow],
				localMap([stale], { scope: "partial" })
			)
		).toThrow("does not match exactly one current central census row");

		expect(() =>
			reconcileLocalInteractionMap(
				"life-recorder",
				[centralRow, { ...centralRow }],
				localMap([assertion()], { scope: "partial" })
			)
		).toThrow("central census contains duplicate interaction identity");

		const missing = assertion({ ...centralRow });
		Reflect.deleteProperty(missing.row, "events");
		expect(() =>
			reconcileLocalInteractionMap(
				"life-recorder",
				[centralRow],
				localMap([missing])
			)
		).toThrow("is missing identity field events");

		expect(() =>
			reconcileLocalInteractionMap(
				"life-recorder",
				[centralRow],
				localMap([], { expectedRows: 1 })
			)
		).toThrow("expected 1 rows but contains 0");
	});

	test("complete maps fail when census rows are missing from the assertion list", () => {
		expect(() =>
			reconcileLocalInteractionMap(
				"life-recorder",
				[centralRow, { ...centralRow, line: "389" }],
				localMap()
			)
		).toThrow("complete interaction map expects 1 central rows but found 2");
	});

	test("assertion markers must live under their named rendered test", () => {
		const testSource = `test("capture flow", async () => {
			await expect(page.getByRole("button", { name: "Stop and transcribe" })).toBeVisible();
		});

		test("search flow", async () => {
			await expect(page.getByRole("textbox", { name: "Search moments" })).toBeVisible();
		});`;

		expect(
			namedAssertionIsPresent(testSource, "capture flow", "Stop and transcribe")
		).toBe(true);
		expect(
			namedAssertionIsPresent(testSource, "capture flow", "Search moments")
		).toBe(false);
		expect(
			namedAssertionIsPresent(testSource, "missing test", "Search moments")
		).toBe(false);
	});
});
