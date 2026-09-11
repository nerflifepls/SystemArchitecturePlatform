import { describe, expect, it } from "vitest";

import { deserializePendingQueue, pendingQueueKey, readPendingQueue, serializePendingQueue, writePendingQueue } from "./offlineUpdateQueue";

describe("offline update queue", () => {
	it("round-trips binary updates and their idempotency ids", () => {
		const value = serializePendingQueue([{ updateId: "update-1", bytes: new Uint8Array([0, 1, 127, 255]), broadcasted: true }]);
		const result = deserializePendingQueue(value);
		expect(result[0].updateId).toBe("update-1");
		expect([...result[0].bytes]).toEqual([0, 1, 127, 255]);
		expect(result[0].broadcasted).toBe(true);
	});

	it("ignores malformed persisted entries", () => {
		expect(deserializePendingQueue("not json")).toEqual([]);
		expect(deserializePendingQueue('[{"updateId":3}]')).toEqual([]);
	});

	it("stores per diagram and removes the key when drained", () => {
		writePendingQueue("diagram-1", [{ updateId: "update-1", bytes: new Uint8Array([4, 2]), broadcasted: false }]);
		expect(readPendingQueue("diagram-1")[0].bytes).toEqual(new Uint8Array([4, 2]));
		writePendingQueue("diagram-1", []);
		expect(localStorage.getItem(pendingQueueKey("diagram-1"))).toBeNull();
	});
});
