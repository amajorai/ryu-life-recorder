import type { MediaRecordingResult } from "@ryu/app-host/media-recording";
import { RyuAppField } from "@ryu/blocks/companion/app-ui";
import {
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
import type { QueryResult } from "@ryu/ui/hooks/use-query.ts";
import { recording, repository } from "./bridge.ts";
import { type Moment, momentMarkdown } from "./model.ts";
import type { StoredMoment } from "./repository.ts";

type Run = (label: string, action: () => Promise<void>) => Promise<void>;

export function DiscardRecordingDialog({
	busy,
	capture,
	discardRecordingOpen,
	run,
	setDiscardRecordingOpen,
}: {
	busy: string | null;
	capture: QueryResult<MediaRecordingResult>;
	discardRecordingOpen: boolean;
	run: Run;
	setDiscardRecordingOpen: (open: boolean) => void;
}) {
	return (
		<Dialog onOpenChange={setDiscardRecordingOpen} open={discardRecordingOpen}>
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
	);
}

export function NoteDialog({
	busy,
	noteOpen,
	noteText,
	noteTitle,
	saveNote,
	setNoteOpen,
	setNoteText,
	setNoteTitle,
}: {
	busy: string | null;
	noteOpen: boolean;
	noteText: string;
	noteTitle: string;
	saveNote: () => Promise<void>;
	setNoteOpen: (open: boolean) => void;
	setNoteText: (text: string) => void;
	setNoteTitle: (title: string) => void;
}) {
	return (
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
	);
}

export function DeleteMomentDialog({
	busy,
	deleteOpen,
	library,
	run,
	selected,
	setDeleteOpen,
	setNotice,
	setSelectedId,
}: {
	busy: string | null;
	deleteOpen: boolean;
	library: QueryResult<StoredMoment[]>;
	run: Run;
	selected: StoredMoment | undefined;
	setDeleteOpen: (open: boolean) => void;
	setNotice: (notice: string) => void;
	setSelectedId: (id: string | null) => void;
}) {
	return (
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
	);
}

export function ExportMomentDialog({
	exportOpen,
	moment,
	setExportOpen,
}: {
	exportOpen: boolean;
	moment: Moment | undefined;
	setExportOpen: (open: boolean) => void;
}) {
	return (
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
	);
}
