// The localized name of where a moment came from. The stored `source` is an
// enum (`microphone`, `shadow`, …) and must never reach copy as a raw word.

import type { LiteralMessage } from "@ryu/i18n/react";
import type { Moment } from "./model.ts";

export function momentSourceLabel(
	source: Moment["source"],
	tl: LiteralMessage
): string {
	switch (source) {
		case "shadow":
			return tl("Shadow");
		case "import":
			return tl("Audio import");
		case "note":
			return tl("Personal note");
		default:
			return tl("Microphone");
	}
}
