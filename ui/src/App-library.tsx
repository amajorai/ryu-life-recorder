import {
	RyuAppActions,
	RyuAppEmpty,
	RyuAppList,
	RyuAppListItem,
	RyuAppSection,
} from "@ryu/blocks/companion/app-ui";
import { Badge, Button, Input } from "@ryu/blocks/companion/controls";
import type { QueryResult } from "@ryu/ui/hooks/use-query.ts";
import { formatDate, formatTime } from "@ryu/ui/lib/timezone.ts";
import type { Moment } from "./model.ts";
import type { StoredMoment } from "./repository.ts";

export function LibrarySection({
	busy,
	library,
	moment,
	moments,
	query,
	savedOnly,
	selectedId,
	setDraft,
	setError,
	setQuery,
	setSavedOnly,
	setSelectedId,
}: {
	busy: string | null;
	library: QueryResult<StoredMoment[]>;
	moment: Moment | undefined;
	moments: Moment[];
	query: string;
	savedOnly: boolean;
	selectedId: string | null;
	setDraft: (draft: Moment | null) => void;
	setError: (error: string | null) => void;
	setQuery: (query: string) => void;
	setSavedOnly: (savedOnly: boolean) => void;
	setSelectedId: (id: string | null) => void;
}) {
	return (
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
								item.saved ? <Badge variant="secondary">Saved</Badge> : null
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
				Unsaved moments expire after 7 days and are removed when you next open
				the library. Saved moments stay until you delete them.
			</p>
		</RyuAppSection>
	);
}
