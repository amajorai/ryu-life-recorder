import {
	RyuAppActions,
	RyuAppEmpty,
	RyuAppField,
	RyuAppList,
	RyuAppListItem,
	RyuAppMain,
	RyuAppSection,
	RyuAppToolbar,
} from "@ryu/blocks/companion/app-ui";
import {
	Badge,
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Input,
	Textarea,
} from "@ryu/blocks/companion/controls";
import { useQuery } from "@ryu/ui/hooks/use-query.ts";
import { formatDate, formatTime } from "@ryu/ui/lib/timezone.ts";
import { createResourceId } from "@ryuhq/core-client/ids";
import { useRef, useState } from "react";
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
	momentMarkdown,
	newMoment,
	recapPrompt,
	rewindSegments,
	searchMoments,
} from "./model.ts";
import type { StoredMoment } from "./repository.ts";

function message(error: unknown): string {
	return error instanceof Error
		? error.message
		: "Something went wrong. Try again.";
}

export function App() {
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
			setError(message(reason));
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
							`Transcript saved. ${clip.pendingChunks ?? 0} audio chunks remaining.`
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
			<Dialog
				onOpenChange={setDiscardRecordingOpen}
				open={discardRecordingOpen}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Discard this recording?</DialogTitle>
						<DialogDescription>
							The microphone will stop and the temporary audio will be deleted.
							Saved moments stay in your library.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							onClick={() => setDiscardRecordingOpen(false)}
							variant="ghost"
						>
							Cancel
						</Button>
						<Button
							disabled={!!busy}
							onClick={() =>
								run("Discarding recording…", async () => {
									if (capture.data?.id) {
										await recording({ action: "discard", id: capture.data.id });
										await capture.refetch();
									}
									setDiscardRecordingOpen(false);
								})
							}
							variant="destructive"
						>
							Discard recording
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
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
					className="recorder-intro"
					data-detail={!!moment && capture.data?.state === "idle"}
				>
					<h2 className="font-heading text-2xl">Stay in the conversation.</h2>
					<p className="mt-2 text-muted-foreground text-sm">
						Catch something you missed, or turn a conversation into a moment you
						can return to.
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
									? `Microphone on · ${Math.floor((capture.data.durationMs ?? 0) / 1000)} seconds`
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
						<span>{error ?? message(library.error)}</span>
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
					<RyuAppSection
						className="recorder-library"
						data-detail={!!moment}
						title="Your moments"
					>
						<Input
							aria-label="Search moments"
							onChange={(event) => setQuery(event.target.value)}
							placeholder="Search a conversation or detail…"
							value={query}
						/>
						<RyuAppActions className="my-3">
							<Button
								aria-pressed={!savedOnly}
								onClick={() => setSavedOnly(false)}
								size="sm"
								variant={savedOnly ? "ghost" : "secondary"}
							>
								Recent
							</Button>
							<Button
								aria-pressed={savedOnly}
								onClick={() => setSavedOnly(true)}
								size="sm"
								variant={savedOnly ? "secondary" : "ghost"}
							>
								Saved
							</Button>
							<span className="ml-auto font-mono text-muted-foreground text-xs">
								{moments.length}
							</span>
						</RyuAppActions>
						{library.isLoading ? (
							<p className="p-4 text-muted-foreground text-sm" role="status">
								Opening your private library…
							</p>
						) : moments.length ? (
							<RyuAppList aria-label="Moments">
								{moments.map((item) => (
									<RyuAppListItem
										accessories={
											item.saved ? (
												<Badge variant="secondary">Saved</Badge>
											) : null
										}
										disabled={!!busy}
										key={item.id}
										onClick={() => {
											setSelectedId(item.id);
											setDraft(null);
											setError(null);
										}}
										selected={selectedId === item.id}
										subtitle={`${formatDate(item.createdAt)} · ${formatTime(item.createdAt)}`}
										title={<span data-ryu-i18n="off">{item.title}</span>}
									/>
								))}
							</RyuAppList>
						) : (
							<RyuAppEmpty
								description={
									query
										? "Try another word from the conversation."
										: savedOnly
											? "Save a moment to keep it beyond seven days."
											: "Import a recording, rewind Shadow, or add a note."
								}
								title={
									query
										? "No matching moments"
										: savedOnly
											? "Keep what matters"
											: "Your day starts here"
								}
							/>
						)}
						<p className="mt-4 text-muted-foreground text-xs">
							Unsaved moments expire after 7 days and are removed when you next
							open the library. Saved moments stay until you delete them.
						</p>
					</RyuAppSection>
					<div className="recorder-detail">
						{moment ? (
							<>
								<Button
									className="mb-3 min-[721px]:hidden"
									onClick={() => {
										setSelectedId(null);
										setDraft(null);
									}}
									variant="ghost"
								>
									Back to moments
								</Button>
								<div className="flex flex-wrap items-start justify-between gap-3">
									<div>
										<div className="mb-2 flex items-center gap-2">
											<Badge variant="secondary">
												{moment.source === "shadow"
													? "Shadow"
													: moment.source === "import"
														? "Audio import"
														: moment.source === "note"
															? "Personal note"
															: "Microphone"}
											</Badge>
											{draft && (
												<span className="text-muted-foreground text-xs">
													Preview · not saved
												</span>
											)}
										</div>
										<h2 className="font-heading text-xl" data-ryu-i18n="off">
											{moment.title}
										</h2>
										<p className="mt-1 font-mono text-muted-foreground text-xs">
											{formatDate(moment.createdAt)} ·{" "}
											{formatTime(moment.createdAt)}
										</p>
									</div>
									<Button
										disabled={!!busy || !moment.segments.length}
										onClick={() =>
											run("Saving…", async () => {
												await persist(
													{ ...moment, saved: !moment.saved },
													selected
												);
												setNotice(
													moment.saved
														? "Moment returned to seven-day retention."
														: "Moment saved. It will stay until you delete it."
												);
											})
										}
										variant={moment.saved ? "secondary" : "outline"}
									>
										{moment.saved ? "Unsave moment" : "Save moment"}
									</Button>
								</div>
								<RyuAppSection className="mt-6" title="Recap">
									{moment.recap ? (
										<p
											className="whitespace-pre-wrap text-sm leading-relaxed"
											data-ryu-i18n="off"
										>
											{moment.recap.text}
										</p>
									) : (
										<p className="text-muted-foreground text-sm">
											A few lines to bring this conversation back.
										</p>
									)}
									<RyuAppActions className="mt-3">
										<Button
											disabled={!!busy || !moment.segments.length}
											onClick={recap}
											variant="secondary"
										>
											{moment.recap ? "Regenerate recap" : "Create recap"}
										</Button>
										<span className="text-muted-foreground text-xs">
											Uses your configured Ryu model
										</span>
									</RyuAppActions>
								</RyuAppSection>
								<RyuAppSection
									className="mt-6"
									title={moment.source === "note" ? "Note" : "Transcript"}
								>
									{moment.segments.length ? (
										<div className="recorder-timeline">
											{moment.segments.map((segment) => (
												<div className="recorder-segment" key={segment.id}>
													<div className="mb-1 font-mono text-muted-foreground text-xs">
														{formatTime(segment.startedAt)}
														{segment.timing === "window" && (
															<span className="font-sans">
																{" "}
																· capture window
															</span>
														)}
													</div>
													<p
														className="whitespace-pre-wrap text-sm leading-relaxed"
														data-ryu-i18n="off"
													>
														{segment.text}
													</p>
												</div>
											))}
										</div>
									) : (
										<RyuAppEmpty
											description="Try a wider time range once Shadow has processed the audio."
											title="Nothing transcribed yet"
										/>
									)}
								</RyuAppSection>
								<RyuAppActions className="mt-5 flex-wrap">
									<Button
										disabled={!moment.segments.length}
										onClick={() => setExportOpen(true)}
										variant="outline"
									>
										Export text
									</Button>
									{selected && (
										<Button
											disabled={!!busy}
											onClick={() => setDeleteOpen(true)}
											variant="ghost"
										>
											Delete moment
										</Button>
									)}
								</RyuAppActions>
							</>
						) : (
							<RyuAppEmpty
								className="min-h-64"
								description="Open a moment to read the transcript, create a recap, or keep a detail for later."
								title="A little help remembering"
							/>
						)}
					</div>
				</div>
			</RyuAppMain>
			<Dialog onOpenChange={setNoteOpen} open={noteOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Add a moment</DialogTitle>
						<DialogDescription>
							Write something you want to remember. It stays in your private app
							library.
						</DialogDescription>
					</DialogHeader>
					<RyuAppField label="Title">
						<Input
							aria-label="Moment title"
							maxLength={160}
							onChange={(event) => setNoteTitle(event.target.value)}
							placeholder="Coffee with the team"
							value={noteTitle}
						/>
					</RyuAppField>
					<RyuAppField label="What happened">
						<Textarea
							aria-label="What happened"
							maxLength={16_000}
							onChange={(event) => setNoteText(event.target.value)}
							placeholder="The detail you want to come back to…"
							value={noteText}
						/>
					</RyuAppField>
					<DialogFooter>
						<Button
							disabled={!!busy}
							onClick={() => setNoteOpen(false)}
							variant="ghost"
						>
							Cancel
						</Button>
						<Button disabled={!!busy || !noteText.trim()} onClick={saveNote}>
							Add moment
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
			<Dialog onOpenChange={setDeleteOpen} open={deleteOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete this moment?</DialogTitle>
						<DialogDescription>
							This removes its transcript and recap from Life Recorder. The
							original recording and Shadow history are separate.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							disabled={!!busy}
							onClick={() => setDeleteOpen(false)}
							variant="ghost"
						>
							Cancel
						</Button>
						<Button
							disabled={!!busy}
							onClick={() =>
								run("Deleting…", async () => {
									if (selected) {
										await repository().remove(selected);
										setSelectedId(null);
										setDeleteOpen(false);
										await library.refetch();
										setNotice("Moment deleted.");
									}
								})
							}
							variant="destructive"
						>
							Delete moment
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
			<Dialog onOpenChange={setExportOpen} open={exportOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Export moment</DialogTitle>
						<DialogDescription>
							Select and copy this Markdown text into Notes, Journal, or another
							app.
						</DialogDescription>
					</DialogHeader>
					<Textarea
						aria-label="Exported moment"
						className="min-h-64"
						onFocus={(event) => event.target.select()}
						readOnly
						value={moment ? momentMarkdown(moment) : ""}
					/>
					<DialogFooter>
						<Button onClick={() => setExportOpen(false)}>Done</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
