import type { RyuAppBridge } from "@ryu/app-host/app-bridge";
import type {
	MediaRecordingInput,
	MediaRecordingResult,
} from "@ryu/app-host/media-recording";
import { downsample, encodeWav } from "@ryu/blocks/companion/audio-pcm";
import { createResourceId } from "@ryuhq/core-client/ids";
import type {
	SpeechHistory,
	SpeechHistoryInput,
} from "@ryuhq/core-client/shadow";
import { parseTranscriptionDetail } from "@ryuhq/core-client/voice";
import { type Moment, newMoment, segmentSchema } from "./model.ts";
import { MomentRepository, type PrivateStorage } from "./repository.ts";

interface RecorderBridge extends RyuAppBridge, PrivateStorage {
	media?: {
		recording?(input: MediaRecordingInput): Promise<MediaRecordingResult>;
		transcribe(input: {
			audio: string;
			filename: string;
			detailed: boolean;
		}): Promise<unknown>;
	};
	shell?: { openTab(input: { path: string }): Promise<void> };
	timeline?: {
		transcripts(input: SpeechHistoryInput): Promise<SpeechHistory>;
	};
}
declare global {
	interface Window {
		ryu?: RecorderBridge;
	}
}

export function host(): RecorderBridge {
	if (!window.ryu) {
		throw new Error(
			"Open Life Recorder in Ryu to connect your private library."
		);
	}
	return window.ryu;
}
export function repository(): MomentRepository {
	return new MomentRepository(host());
}

export function recording(
	input: MediaRecordingInput
): Promise<MediaRecordingResult> {
	const capture = host().media?.recording;
	return capture
		? capture(input)
		: Promise.resolve({ available: false, background: false, state: "idle" });
}

export function transcribedMoment(
	result: unknown,
	source: "import" | "microphone",
	title: string,
	startedAt: string,
	durationMs = 0
): Moment {
	const transcript = parseTranscriptionDetail(
		typeof result === "string" ? { text: result } : result
	);
	if (!transcript.text && source === "import") {
		throw new Error(
			"No speech was returned. Your audio is still available to retry."
		);
	}
	const start = Date.parse(startedAt);
	const timed =
		transcript.segments.length > 0 &&
		transcript.segments.every(
			(segment) => durationMs <= 0 || segment.endMs <= durationMs + 500
		);
	const segments = transcript.text
		? timed
			? transcript.segments
					.filter((part) => part.text)
					.map((part) => ({
						id: createResourceId(),
						text: part.text,
						startedAt: new Date(start + part.startMs).toISOString(),
						endedAt: new Date(start + part.endMs).toISOString(),
						timing: "segment" as const,
					}))
			: [
					{
						id: createResourceId(),
						text: transcript.text,
						startedAt,
						endedAt: new Date(start + durationMs).toISOString(),
						timing: "window" as const,
					},
				]
		: [];
	return newMoment(source, title, segments, new Date(start));
}

export async function transcribeRecording(
	clip: MediaRecordingResult
): Promise<Moment> {
	if (!(clip.id && clip.startedAt)) {
		throw new Error("No pending recording was returned.");
	}
	const pending = clip.audio
		? clip
		: await recording({ action: "read", id: clip.id });
	if (!pending.audio) {
		throw new Error("The recording audio is unavailable.");
	}
	const media = host().media;
	if (!media) {
		throw new Error("Transcription is unavailable.");
	}
	const result = await media.transcribe({
		audio: pending.audio,
		filename: pending.filename ?? "recording.wav",
		detailed: true,
	});
	const startedAt = pending.chunkStartedAt ?? clip.startedAt;
	const resultMoment = {
		...transcribedMoment(
			result,
			"microphone",
			"Recorded conversation",
			startedAt,
			pending.durationMs
		),
		captureId: pending.continuous
			? `${clip.id}:${Math.floor(Date.parse(startedAt) / 900_000)}`
			: clip.id,
		captureChunks: pending.chunkId ? [pending.chunkId] : [],
	};
	return resultMoment;
}

export async function readShadow(seconds: number): Promise<Moment> {
	const bridge = host().timeline;
	if (!bridge?.transcripts) {
		throw new Error(
			"Shadow speech history is unavailable on this surface. Import a recording instead."
		);
	}
	const end = new Date();
	const start = new Date(end.getTime() - seconds * 1000);
	const result = await bridge.transcripts({
		start: start.toISOString(),
		end: end.toISOString(),
		limit: 500,
	});
	if (result.nextOffset !== null || result.truncated) {
		throw new Error(
			"This range contains too much speech. Choose a shorter rewind."
		);
	}
	const segments = result.segments.map((segment) =>
		segmentSchema.parse(segment)
	);
	return newMoment(
		"shadow",
		seconds <= 60 ? "What was just said" : "Recent conversation",
		segments
	);
}

export async function importAudio(file: File): Promise<Moment> {
	if (file.size > 20 * 1024 * 1024 || file.size === 0) {
		throw new Error("Choose an audio recording smaller than 20 MB.");
	}
	if (!/\.(wav|mp3|m4a|aac|ogg|webm|flac)$/i.test(file.name)) {
		throw new Error(
			"Choose a WAV, MP3, M4A, AAC, OGG, WebM, or FLAC recording."
		);
	}
	const media = host().media;
	if (!media) {
		throw new Error("Transcription is unavailable on this surface.");
	}
	// Normalize browser-decodable imports to the WAV contract used by every Ryu STT engine.
	const context = new AudioContext();
	let wav: Blob;
	let durationMs: number;
	try {
		const decoded = await context.decodeAudioData(await file.arrayBuffer());
		if (decoded.duration > 600) {
			throw new Error("Import up to 10 minutes at a time.");
		}
		durationMs = Math.round(decoded.duration * 1000);
		const mono = new Float32Array(decoded.length);
		for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
			const samples = decoded.getChannelData(channel);
			for (let index = 0; index < samples.length; index += 1) {
				mono[index] =
					(mono[index] ?? 0) + (samples[index] ?? 0) / decoded.numberOfChannels;
			}
		}
		wav = encodeWav(downsample(mono, decoded.sampleRate, 16_000), 16_000);
	} finally {
		await context.close();
	}
	const bytes = new Uint8Array(await wav.arrayBuffer());
	let binary = "";
	for (let offset = 0; offset < bytes.length; offset += 8192) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
	}
	const result = await media.transcribe({
		audio: `data:audio/wav;base64,${btoa(binary)}`,
		filename: "import.wav",
		detailed: true,
	});
	return transcribedMoment(
		result,
		"import",
		file.name.replace(/\.[^.]+$/, ""),
		new Date().toISOString(),
		durationMs
	);
}
