import {
	RyuAppActions,
	RyuAppMain,
	RyuAppToolbar,
} from "@ryu/blocks/companion/app-ui";
import { Button } from "@ryu/blocks/companion/controls";
import { useLiteralMessages } from "@ryu/i18n/react";
import { useQuery } from "@ryu/ui/hooks/use-query.ts";
import { createResourceId } from "@ryuhq/core-client/ids";
import { useRef, useState } from "react";
import { MomentDetail } from "./App-detail.tsx";
import {
	DeleteMomentDialog,
	DiscardRecordingDialog,
	ExportMomentDialog,
	NoteDialog,
} from "./App-dialogs.tsx";
import { LibrarySection } from "./App-library.tsx";
import {
	host,
	importAudio,
	readShadow,
	recording,
	repository,
	transcribeRecording,
} from "./bridge.ts";
import {
	type Moment,
	newMoment,
	recapPrompt,
	rewindSegments,
	searchMoments,
} from "./model.ts";
import type { StoredMoment } from "./repository.ts";

function message(error: Error | null): string {
	return error === null ? "Something went wrong. Try again." : error.message;
}

export function App() {
	const tl = useLiteralMessages();
	const library = useQuery({
		queryKey: ["life-recorder"],
		queryFn: () => repository().list(),
	});
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [draft, setDraft] = useState<Moment | null>(null);
	const [query, setQuery] = useState("");
	const [savedOnly, setSavedOnly] = useState(false);
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState("");
	const [noteOpen, setNoteOpen] = useState(false);
	const [noteTitle, setNoteTitle] = useState("");
	const [noteText, setNoteText] = useState("");
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [exportOpen, setExportOpen] = useState(false);
	const [discardRecordingOpen, setDiscardRecordingOpen] = useState(false);
	const capture = useQuery({
		queryKey: ["microphone"],
		queryFn: () => recording({ action: "status" }),
		refetchInterval: 3000,
	});
	const fileInput = useRef<HTMLInputElement>(null);
	const selected = library.data?.find(
		(record) => record.moment.id === selectedId
	);
	const moment = draft ?? selected?.moment;
	const moments = searchMoments(
		library.data?.map((record) => record.moment) ?? [],
		query,
		savedOnly
	);

	async function run(label: string, action: () => Promise<void>) {
		if (busy) {
			return;
		}
		setBusy(label);
		setError(null);
		setNotice("");
		try {
			await action();
		} catch (reason) {
			setError(message(reason instanceof Error ? reason : null));
		} finally {
			setBusy(null);
		}
	}
	async function persist(next: Moment, prior?: StoredMoment) {
		await repository().write(
			{ ...next, updatedAt: new Date().toISOString() },
			prior?.envelope ?? null
		);
		setSelectedId(next.id);
		setDraft(null);
		await library.refetch();
	}
	function rewind(seconds: number) {
		return run("Reading Shadow…", async () => {
			let result: Moment;
			if (capture.data?.background && capture.data.continuous) {
				if (capture.data.id) {
					const audio = await recording({
						action: "rewind",
						id: capture.data.id,
						seconds: seconds === 15 ? 15 : 300,
					});
					result = newMoment(
						"microphone",
						"What was just said",
						audio.audio ? (await transcribeRecording(audio)).segments : []
					);
				} else {
					result = newMoment(
						"microphone",
						"What was just said",
						rewindSegments(
							(library.data ?? []).flatMap((record) =>
								record.moment.source === "microphone"
									? record.moment.segments
									: []
							),
							seconds
						)
					);
				}
			} else {
				result = await readShadow(seconds);
			}
			setDraft(result);
			setSelectedId(null);
			if (!result.segments.length) {
				setNotice(
					"No speech is available in this window yet. Start capture or try a wider range."
				);
			}
		});
	}
	function recap() {
		return run("Writing recap…", async () => {
			if (!moment) {
				return;
			}
			const model = host().model;
			if (!model) {
				throw new Error("Choose a model in Ryu before generating a recap.");
			}
			const text = await model.complete(recapPrompt(moment));
			if (!text.trim()) {
				throw new Error(
					"The model returned an empty recap. Your transcript is unchanged."
				);
			}
			await persist(
				{ ...moment, recap: { text, createdAt: new Date().toISOString() } },
				selected
			);
			setNotice("Recap added to your moment.");
		});
	}
	function saveNote() {
		return run("Saving moment…", async () => {
			const now = new Date().toISOString();
			await persist(
				newMoment("note", noteTitle.trim() || "A moment to remember", [
					{
						id: createResourceId(),
						startedAt: now,
						endedAt: now,
						text: noteText,
						timing: "window",
					},
				])
			);
			setNoteOpen(false);
			setNoteText("");
			setNoteTitle("");
			setNotice("Moment added.");
		});
	}

	function microphone() {
		return run(
			capture.data?.state === "idle"
				? "Opening microphone…"
				: "Transcribing recording…",
			async () => {
				try {
					let clip = await recording({ action: "status" });
					if (!clip.available) {
						throw new Error(
							clip.message ??
								"Microphone capture is unavailable on this surface."
						);
					}
					if (clip.state === "idle") {
						await recording({ action: "start" });
						return;
					}
					if (!clip.id) {
						throw new Error("The recording identity is unavailable.");
					}
					const id = clip.id;
					if (clip.state === "recording") {
						clip = await recording({ action: "stop", id });
					}
					const current = await repository().list();
					for (;;) {
						const pending = await recording({ action: "read", id });
						if (!pending.audio) {
							break;
						}
						const receipt = current.find((record) =>
							pending.chunkId
								? record.moment.captureChunks?.includes(pending.chunkId)
								: record.moment.captureId === id
						);
						if (!receipt) {
							const incoming = await transcribeRecording(pending);
							const previous = current.find(
								(record) => record.moment.captureId === incoming.captureId
							);
							const saved = await repository().write(
								previous
									? {
											...previous.moment,
											updatedAt: new Date().toISOString(),
											recap: null,
											segments: [
												...previous.moment.segments,
												...incoming.segments,
											],
											captureChunks: [
												...(previous.moment.captureChunks ?? []),
												...(incoming.captureChunks ?? []),
											],
										}
									: incoming,
								previous?.envelope ?? null
							);
							const oldIndex = current.findIndex(
								(record) => record.moment.id === saved.moment.id
							);
							if (oldIndex >= 0) {
								current[oldIndex] = saved;
							} else {
								current.push(saved);
							}
							setSelectedId(saved.moment.id);
							setDraft(null);
						}
						if (pending.continuous && pending.chunkId) {
							clip = await recording({ action: "ack", id: pending.chunkId });
						} else {
							clip = await recording({ action: "discard", id });
						}
						setNotice(
							tl("Transcript saved. {count} audio chunks remaining.", {
								count: String(clip.pendingChunks ?? 0),
							})
						);
						if (clip.state === "idle") {
							break;
						}
					}
					setNotice(
						"Transcript saved. The temporary microphone recording was removed."
					);
				} finally {
					await library.refetch();
					await capture.refetch();
				}
			}
		);
	}

	return (
		<>
			<DiscardRecordingDialog
				busy={busy}
				capture={capture}
				discardRecordingOpen={discardRecordingOpen}
				run={run}
				setDiscardRecordingOpen={setDiscardRecordingOpen}
			/>
			<RyuAppToolbar
				actions={
					<Button
						disabled={!!busy}
						onClick={() => fileInput.current?.click()}
						variant="outline"
					>
						Import audio
					</Button>
				}
				title="Life Recorder"
			>
				<span className="hidden text-muted-foreground text-xs sm:inline">
					Your conversations, remembered
				</span>
			</RyuAppToolbar>
			<input
				accept="audio/*,.m4a,.wav,.mp3,.webm,.flac"
				aria-label="Import audio recording"
				hidden
				onChange={(event) => {
					const file = event.target.files?.[0];
					event.target.value = "";
					if (file) {
						run("Transcribing recording…", async () => {
							const imported = await importAudio(file);
							await persist(imported);
							setNotice(
								"Recording transcribed. Your audio has not been stored in Life Recorder."
							);
						});
					}
				}}
				ref={fileInput}
				type="file"
			/>
			<RyuAppMain>
				<div
					className="recorder-start"
					data-detail={!!moment && capture.data?.state === "idle"}
				>
					<h2 className="font-heading text-2xl">Record a conversation</h2>
					<p className="mt-2 text-muted-foreground text-sm">
						Capture audio, transcribe it locally, and review the latest moment.
					</p>
					<RyuAppActions className="mt-4 flex-wrap">
						{capture.data?.available && (
							<Button
								disabled={!!busy}
								onClick={microphone}
								variant={
									capture.data.state === "recording" ? "destructive" : "default"
								}
							>
								{capture.data.state === "recording"
									? "Stop and transcribe"
									: capture.data.state === "pending"
										? "Retry transcription"
										: "Record conversation"}
							</Button>
						)}
						<Button disabled={!!busy} onClick={() => rewind(15)}>
							Rewind 15 seconds
						</Button>
						<Button
							disabled={!!busy}
							onClick={() => rewind(300)}
							variant="outline"
						>
							Last 5 minutes
						</Button>
						<Button
							disabled={!!busy}
							onClick={() => setNoteOpen(true)}
							variant="ghost"
						>
							Add a note
						</Button>
					</RyuAppActions>
					{capture.data?.available && (
						<div className="mt-3 flex flex-wrap items-center gap-3 text-muted-foreground text-xs">
							<span role="status">
								{capture.data.state === "recording"
									? tl("Microphone on · {seconds} seconds", {
											seconds: String(
												Math.floor((capture.data.durationMs ?? 0) / 1000)
											),
										})
									: capture.data.state === "pending"
										? "Audio is waiting for transcription on this device."
										: capture.data.background
											? "Capture continues while your iPhone is locked. Minute-long recordings stay on this device until you return to transcribe them."
											: "Record up to 5 minutes. Keep Ryu open until the transcript is saved."}
							</span>
							{capture.data.state !== "idle" && (
								<Button
									disabled={!!busy}
									onClick={() => setDiscardRecordingOpen(true)}
									size="sm"
									variant="ghost"
								>
									Discard recording
								</Button>
							)}
						</div>
					)}
					<p className="mt-3 text-muted-foreground text-xs">
						{capture.data?.background
							? "Rewind uses recordings you started on this iPhone. Nothing is captured before you press Record."
							: "Shadow rewind uses this computer’s speech history. Capture must already be on. Transcript windows can include speech just outside the selected time."}
					</p>
				</div>
				{busy && (
					<p className="py-2 text-sm" role="status">
						{busy}
					</p>
				)}
				{notice && (
					<p className="py-2 text-muted-foreground text-sm" role="status">
						{notice}
					</p>
				)}
				{(error || library.isError) && (
					<div
						className="mb-4 flex flex-wrap items-center gap-3 text-sm text-status-destructive"
						role="alert"
					>
						<span>
							{error ??
								message(library.error instanceof Error ? library.error : null)}
						</span>
						<Button
							disabled={!!busy}
							onClick={() => {
								setError(null);
								library.refetch();
							}}
							variant="outline"
						>
							Reload library
						</Button>
					</div>
				)}
				<div className="recorder-layout">
					<LibrarySection
						busy={busy}
						library={library}
						moment={moment}
						moments={moments}
						query={query}
						savedOnly={savedOnly}
						selectedId={selectedId}
						setDraft={setDraft}
						setError={setError}
						setQuery={setQuery}
						setSavedOnly={setSavedOnly}
						setSelectedId={setSelectedId}
					/>
					<div className="recorder-detail">
						<MomentDetail
							busy={busy}
							draft={draft}
							moment={moment}
							persist={persist}
							recap={recap}
							run={run}
							selected={selected}
							setDeleteOpen={setDeleteOpen}
							setDraft={setDraft}
							setExportOpen={setExportOpen}
							setNotice={setNotice}
							setSelectedId={setSelectedId}
						/>
					</div>
				</div>
			</RyuAppMain>
			<NoteDialog
				busy={busy}
				noteOpen={noteOpen}
				noteText={noteText}
				noteTitle={noteTitle}
				saveNote={saveNote}
				setNoteOpen={setNoteOpen}
				setNoteText={setNoteText}
				setNoteTitle={setNoteTitle}
			/>
			<DeleteMomentDialog
				busy={busy}
				deleteOpen={deleteOpen}
				library={library}
				run={run}
				selected={selected}
				setDeleteOpen={setDeleteOpen}
				setNotice={setNotice}
				setSelectedId={setSelectedId}
			/>
			<ExportMomentDialog
				exportOpen={exportOpen}
				moment={moment}
				setExportOpen={setExportOpen}
			/>
		</>
	);
}
