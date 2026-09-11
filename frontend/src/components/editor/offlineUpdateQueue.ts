export type QueuedDiagramUpdate = {
	updateId: string;
	bytes: Uint8Array;
	broadcasted: boolean;
};

type SerializedQueuedUpdate = {
	updateId: string;
	bytes: string;
	broadcasted: boolean;
};

export function pendingQueueKey(diagramId: string) {
	return `system-design:pending-updates:${diagramId}`;
}

function bytesToBase64(bytes: Uint8Array) {
	let binary = "";
	for (let offset = 0; offset < bytes.length; offset += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
	}
	return btoa(binary);
}

function base64ToBytes(value: string) {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
	return bytes;
}

export function serializePendingQueue(queue: QueuedDiagramUpdate[]) {
	return JSON.stringify(
		queue.map(
			(item): SerializedQueuedUpdate => ({
				updateId: item.updateId,
				bytes: bytesToBase64(item.bytes),
				broadcasted: item.broadcasted,
			}),
		),
	);
}

export function deserializePendingQueue(value: string): QueuedDiagramUpdate[] {
	try {
		const parsed = JSON.parse(value) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed.flatMap((item) => {
			if (!item || typeof item !== "object") return [];
			const record = item as Record<string, unknown>;
			if (typeof record.updateId !== "string" || typeof record.bytes !== "string") return [];
			try {
				return [
					{
						updateId: record.updateId,
						bytes: base64ToBytes(record.bytes),
						broadcasted: record.broadcasted === true,
					},
				];
			} catch {
				return [];
			}
		});
	} catch {
		return [];
	}
}

export function readPendingQueue(diagramId: string): QueuedDiagramUpdate[] {
	try {
		return deserializePendingQueue(localStorage.getItem(pendingQueueKey(diagramId)) ?? "[]");
	} catch {
		return [];
	}
}

export function writePendingQueue(diagramId: string, queue: QueuedDiagramUpdate[]) {
	try {
		if (queue.length === 0) {
			localStorage.removeItem(pendingQueueKey(diagramId));
			return;
		}
		localStorage.setItem(pendingQueueKey(diagramId), serializePendingQueue(queue));
	} catch {
		// A full or disabled storage area must not interrupt the live editing path.
	}
}
