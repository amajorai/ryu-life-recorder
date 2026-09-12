import { ExtensionHost } from "@ryu/app-host/ExtensionHost";
import {
	capabilitiesFromGrants,
	dispatchRpc,
	type HostServices,
} from "@ryu/app-host/rpc";
import { IslandPluginHost } from "../../../../apps/island/src/renderer/host/IslandPluginHost.tsx";
import { I18nProvider } from "../../../../packages/i18n/src/react.tsx";
import "./host.css";
import { htmlCompanionSrcdoc } from "@ryu/app-host/third-party-plugin";
import { browserRecordingHost } from "@ryu/blocks/companion/browser-recording";
import { createRoot } from "react-dom/client";
import manifest from "../../manifest.json" with { type: "json" };
import appHtml from "../dist/index.html?raw";

// Isolated verification data. The production app and sandbox bridge are unmodified.
const values = new Map<string, string>();
const nonce = crypto.randomUUID();
const id = manifest.id;
const island = new URLSearchParams(location.search).get("surface") === "island";
const key = (input: { key: string; namespace?: string }) =>
	`${input.namespace ?? "default"}/${input.key}`;
const fixtureSpeech =
	"We agreed to review the mobile prototype on Thursday. Bring the revised onboarding flow and ask Maya for the latest feedback.";
const services: HostServices = {
	listAgents: async () => [],
	registerRoute: async () => {
		throw new Error("Navigation is outside this isolated proof.");
	},
	storageKeys: async ({ namespace }) =>
		[...values.keys()]
			.filter((value) => value.startsWith(`${namespace}/`))
			.map((value) => value.slice((namespace?.length ?? 0) + 1)),
	storageGet: async (input) => values.get(key(input)) ?? null,
	storageCompareAndSet: async (input) => {
		const name = key(input);
		if ((values.get(name) ?? null) !== (input.expected ?? null)) {
			return false;
		}
		if (input.value == null) {
			values.delete(name);
		} else {
			values.set(name, input.value);
		}
		return true;
	},
	cryptoSeal: async ({ value }) =>
		`verification:${btoa(unescape(encodeURIComponent(value)))}`,
	cryptoOpen: async ({ value }) =>
		decodeURIComponent(escape(atob(value.slice("verification:".length)))),
	modelComplete: async ({ prompt }) => {
		if (!(prompt.includes("Transcript") || prompt.includes("transcript"))) {
			throw new Error("Missing source transcript");
		}
		return "Review the mobile prototype on Thursday.\n\nNext steps\n• Bring the revised onboarding flow.\n• Ask Maya for the latest feedback.";
	},
	timelineTranscripts: async () => ({
		segments: [
			{
				id: "fixture-window",
				startedAt: new Date(Date.now() - 25_000).toISOString(),
				endedAt: new Date(Date.now() - 2000).toISOString(),
				text: fixtureSpeech,
				timing: "window",
			},
		],
		nextOffset: null,
	}),
	mediaRecording: (input) => browserRecordingHost.call(id, input),
	transcribeAudio: async ({ audio }) => {
		if (!audio.startsWith("data:audio/wav;base64,UklGR")) {
			throw new Error("Expected normalized WAV audio");
		}
		return {
			text: fixtureSpeech,
			segments: [{ startMs: 0, endMs: 4000, text: fixtureSpeech }],
		};
	},
};
const style = document.createElement("style");
style.textContent =
	"html,body,#root{margin:0;height:100%;font-family:system-ui}#root{display:flex;flex-direction:column}.proof-note{padding:8px 16px;background:#eef6ff;color:#26425e;font-size:12px}#root>div:last-child{flex:1;min-height:0}iframe{display:block;width:100%;height:100%;border:0}";
document.head.append(style);
const root = document.getElementById("root");
Object.assign(window, {
	island: {
		shadow: { getSpeechHistory: services.timelineTranscripts },
		core: { agents: async () => ({ available: true, agents: [] }) },
		plugins: {
			uiBundle: async () => ({ available: true, code: appHtml }),
			hostInvoke: async ({
				method,
				args,
			}: {
				method: string;
				args: unknown;
			}) => ({
				ok: true,
				result: await dispatchRpc(
					method,
					[args],
					capabilitiesFromGrants(manifest.permission_grants),
					services
				),
			}),
		},
	},
});
if (root) {
	createRoot(root).render(
		<I18nProvider>
			<div className="proof-note">
				Product verification · {island ? "real Island host" : "sandbox host"} ·
				fixture speech and model
			</div>
			{island ? (
				<IslandPluginHost
					companion={{
						id: "app__life-recorder-companion",
						pluginId: id,
						name: manifest.name,
						label: manifest.name,
						icon: null,
						shortcut: null,
						hasUi: true,
						approvedGrants: manifest.permission_grants,
					}}
				/>
			) : (
				<ExtensionHost
					granted={capabilitiesFromGrants(manifest.permission_grants)}
					nonce={nonce}
					services={services}
					srcdoc={htmlCompanionSrcdoc(nonce, appHtml, id)}
					title="Life Recorder"
				/>
			)}
		</I18nProvider>
	);
}
