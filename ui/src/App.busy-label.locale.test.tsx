import { afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

// run() stores its label in `busy` and the status line prints it as-is, so the
// busy labels ("Reading Shadow…", "Writing recap…", …) must be translated
// where they are passed in. They were bare English literals with no catalog key.

if (!GlobalRegistrator.isRegistered) {
	GlobalRegistrator.register();
}
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
beforeEach(() => {
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: document.defaultView,
		writable: true,
	});
});
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { I18nProvider } = await import("@ryu/i18n/react");
const { App } = await import("./App.tsx");

/** A German stand-in for the catalog entries the coordinator generates. */
const GERMAN: Record<string, string> = {
	"Reading Shadow…": "Shadow wird gelesen…",
};

/** A host whose Shadow read never settles, so the busy label stays visible. */
function pendingShadowHost() {
	return {
		crypto: {
			open: async ({ value }: { value: string }) => value,
			seal: async ({ value }: { value: string }) => value,
		},
		storage: {
			compareAndSet: async () => true,
			get: async () => null,
			keys: async () => [],
		},
		timeline: {
			transcripts: () => new Promise<never>(() => undefined),
		},
	};
}

const mounted: { root: Root; container: HTMLDivElement }[] = [];

afterEach(async () => {
	for (const { root, container } of mounted.splice(0)) {
		await act(async () => {
			root.unmount();
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
		container.remove();
	}
	Reflect.deleteProperty(window, "ryu");
});

async function settle() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

async function renderApp(locale: string): Promise<HTMLDivElement> {
	Reflect.set(window, "ryu", pendingShadowHost());
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	mounted.push({ root, container });
	await act(async () => {
		root.render(
			<I18nProvider
				autoLocalizeDom={false}
				initialLocale={locale}
				initialPackId={null}
				manageDocument={false}
				overlays={locale === "de" ? { de: GERMAN } : {}}
			>
				<App />
			</I18nProvider>
		);
	});
	await settle();
	return container;
}

async function clickRewind(container: HTMLElement) {
	const button = [...container.querySelectorAll("button")].find(
		(candidate) => candidate.textContent?.trim() === "Rewind 15 seconds"
	);
	if (!button) {
		throw new Error("Rewind 15 seconds button not found");
	}
	await act(async () => {
		button.click();
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

function statusText(container: HTMLElement): string[] {
	return [...container.querySelectorAll('[role="status"]')].map(
		(node) => node.textContent?.trim() ?? ""
	);
}

test("the Read Shadow busy label is translated", async () => {
	const container = await renderApp("de");
	await clickRewind(container);
	const statuses = statusText(container);
	expect(statuses).toContain("Shadow wird gelesen…");
	expect(statuses).not.toContain("Reading Shadow…");
});

test("the Read Shadow busy label stays English in English", async () => {
	const container = await renderApp("en");
	await clickRewind(container);
	expect(statusText(container)).toContain("Reading Shadow…");
});
