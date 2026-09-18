import { isExpired, type Moment, momentSchema } from "./model.ts";

export interface PrivateStorage {
	crypto: {
		seal(input: { value: string }): Promise<string>;
		open(input: { value: string }): Promise<string>;
	};
	storage: {
		keys(input: { namespace: string }): Promise<string[]>;
		get(input: { namespace: string; key: string }): Promise<string | null>;
		compareAndSet(input: {
			namespace: string;
			key: string;
			expected: string | null;
			value: string | null;
		}): Promise<boolean>;
	};
}
const namespace = "life-recorder.v1";
export interface StoredMoment {
	envelope: string;
	moment: Moment;
}

/** One sealed record per moment. CAS prevents a second surface overwriting edits. */
export class MomentRepository {
	constructor(private readonly host: PrivateStorage) {}
	async list(): Promise<StoredMoment[]> {
		const keys = await this.host.storage.keys({ namespace });
		const result: StoredMoment[] = [];
		for (const key of keys) {
			const envelope = await this.host.storage.get({ namespace, key });
			if (envelope === null) {
				continue;
			}
			const value = await this.host.crypto.open({ value: envelope });
			const moment = momentSchema.parse(JSON.parse(value));
			if (moment.id !== key) {
				throw new Error("A stored moment has an invalid identity.");
			}
			if (isExpired(moment)) {
				await this.host.storage.compareAndSet({
					namespace,
					key,
					expected: envelope,
					value: null,
				});
			} else {
				result.push({ moment, envelope });
			}
		}
		return result.sort((left, right) =>
			right.moment.createdAt.localeCompare(left.moment.createdAt)
		);
	}
	async write(moment: Moment, expected: string | null): Promise<StoredMoment> {
		const checked = momentSchema.parse(moment);
		const value = JSON.stringify(checked);
		if (value.length > 180_000) {
			throw new Error(
				"This moment is full. Start another recording before adding more speech."
			);
		}
		const envelope = await this.host.crypto.seal({ value });
		if (
			!(await this.host.storage.compareAndSet({
				namespace,
				key: moment.id,
				expected,
				value: envelope,
			}))
		) {
			throw new Error(
				"This moment changed on another surface. Reload before editing it."
			);
		}
		return { moment: checked, envelope };
	}
	async remove(record: StoredMoment): Promise<void> {
		if (
			!(await this.host.storage.compareAndSet({
				namespace,
				key: record.moment.id,
				expected: record.envelope,
				value: null,
			}))
		) {
			throw new Error(
				"This moment changed on another surface. Reload before deleting it."
			);
		}
	}
}
