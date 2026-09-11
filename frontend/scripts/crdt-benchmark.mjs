import { performance } from "node:perf_hooks";
import process from "node:process";
import * as Y from "yjs";

function percentile(values, value) {
	if (!values.length) return 0;
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * value))];
}

function deterministicShuffle(values, seed) {
	let state = seed >>> 0;
	const next = [...values];
	for (let index = next.length - 1; index > 0; index -= 1) {
		state = (state * 1664525 + 1013904223) >>> 0;
		const target = state % (index + 1);
		[next[index], next[target]] = [next[target], next[index]];
	}
	return next;
}

function runCase(clientCount, operationsPerClient) {
	const clients = Array.from({ length: clientCount }, (_, index) => new Y.Doc({ guid: `benchmark-client-${index}` }));
	const clientUpdates = clients.map(() => []);
	const generationStartedAt = performance.now();

	clients.forEach((doc, clientIndex) => {
		const captureUpdate = (update) => clientUpdates[clientIndex].push(new Uint8Array(update));
		doc.on("update", captureUpdate);
		const nodes = doc.getMap("nodes");
		for (let operation = 0; operation < operationsPerClient; operation += 1) {
			doc.transact(() => {
				const id = `client-${clientIndex}-node-${operation}`;
				nodes.set(id, {
					id,
					position: { x: operation * 11, y: clientIndex * 17 },
					data: { label: `Component ${operation}`, kind: operation % 3 === 0 ? "service" : "component" },
				});
			});
		}
		doc.off("update", captureUpdate);
	});

	const generationMs = performance.now() - generationStartedAt;
	const generatedUpdateCount = clientUpdates.reduce((total, updates) => total + updates.length, 0);
	const deliveryBatches = clientUpdates.flatMap((updates) => {
		const batches = [];
		for (let offset = 0; offset < updates.length; offset += 10) {
			batches.push(Y.mergeUpdates(updates.slice(offset, offset + 10)));
		}
		return batches;
	});
	const reorderedUpdates = deterministicShuffle(deliveryBatches, clientCount * 7919 + operationsPerClient);
	const mergeSamples = [];
	const mergeStartedAt = performance.now();
	for (const doc of clients) {
		for (const update of reorderedUpdates) {
			const startedAt = performance.now();
			Y.applyUpdate(doc, update, "benchmark-remote");
			mergeSamples.push(performance.now() - startedAt);
		}
	}
	const mergeMs = performance.now() - mergeStartedAt;
	const encodedStates = clients.map((doc) => Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64"));
	const result = {
		clients: clientCount,
		operationsPerClient,
		totalLogicalOperations: clientCount * operationsPerClient,
		generatedUpdates: generatedUpdateCount,
		deliveredBatches: deliveryBatches.length,
		generationMs: Number(generationMs.toFixed(2)),
		mergeMs: Number(mergeMs.toFixed(2)),
		mergeP50Ms: Number(percentile(mergeSamples, 0.5).toFixed(4)),
		mergeP95Ms: Number(percentile(mergeSamples, 0.95).toFixed(4)),
		updatesPerSecond: Math.round((generatedUpdateCount * clients.length * 1000) / Math.max(mergeMs, 0.001)),
		finalDocumentBytes: Buffer.byteLength(encodedStates[0] ?? "", "base64"),
		converged: encodedStates.every((state) => state === encodedStates[0]),
	};
	clients.forEach((doc) => doc.destroy());
	return result;
}

const operationsPerClient = Math.max(1, Number.parseInt(process.env.CRDT_BENCHMARK_OPERATIONS ?? "100", 10));
const cases = [2, 5, 10, 25].map((clientCount) => runCase(clientCount, operationsPerClient));
const report = {
	benchmark: "Yjs shuffled-delivery convergence",
	generatedAt: new Date().toISOString(),
	nodeVersion: process.version,
	operationsPerClient,
	allCasesConverged: cases.every((item) => item.converged),
	cases,
};

console.log(JSON.stringify(report, null, 2));
if (!report.allCasesConverged) process.exitCode = 1;
