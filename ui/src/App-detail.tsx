import {
	RyuAppActions,
	RyuAppEmpty,
	RyuAppSection,
} from "@ryu/blocks/companion/app-ui";
import { Badge, Button } from "@ryu/blocks/companion/controls";
import { formatDate, formatTime } from "@ryu/ui/lib/timezone.ts";
import type { Moment } from "./model.ts";
import type { StoredMoment } from "./repository.ts";

export function MomentDetail({
	busy,
	draft,
	moment,
	persist,
	recap,
	run,
	selected,
	setDeleteOpen,
	setDraft,
	setExportOpen,
	setNotice,
	setSelectedId,
}: {
	busy: string | null;
	draft: Moment | null;
	moment: Moment | undefined;
	persist: (next: Moment, prior?: StoredMoment) => Promise<void>;
	recap: () => Promise<void>;
	run: (label: string, action: () => Promise<void>) => Promise<void>;
	selected: StoredMoment | undefined;
	setDeleteOpen: (open: boolean) => void;
	setDraft: (draft: Moment | null) => void;
	setExportOpen: (open: boolean) => void;
	setNotice: (notice: string) => void;
	setSelectedId: (id: string | null) => void;
}) {
	return moment ? (
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
						{formatDate(moment.createdAt)} · {formatTime(moment.createdAt)}
					</p>
				</div>
				<Button
					disabled={!!busy || !moment.segments.length}
					onClick={() =>
						run("Saving…", async () => {
							await persist({ ...moment, saved: !moment.saved }, selected);
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
										<span className="font-sans"> · capture window</span>
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
	);
}
