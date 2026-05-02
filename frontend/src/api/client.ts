export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL?.trim() || "http://localhost:8081").replace(/\/$/, "");

type RequestOptions = {
	method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
	body?: unknown;
	headers?: HeadersInit;
	signal?: AbortSignal;
};

type BinaryRequestOptions = Omit<RequestOptions, "body"> & {
	body?: Uint8Array;
};

export class ApiError extends Error {
	readonly status: number;
	readonly details: unknown;

	constructor(message: string, status: number, details: unknown) {
		super(message);
		this.name = "ApiError";
		this.status = status;
		this.details = details;
	}
}

function resolveUrl(path: string) {
	const normalizedPath = path.startsWith("/") ? path : `/${path}`;
	return `${API_BASE_URL}${normalizedPath}`;
}

function toArrayBuffer(bytes: Uint8Array) {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy.buffer;
}

function getErrorMessage(status: number, payload: unknown) {
	if (payload && typeof payload === "object") {
		const record = payload as Record<string, unknown>;
		const nestedError = record.error;
		if (nestedError && typeof nestedError === "object") {
			const nestedMessage = (nestedError as Record<string, unknown>).message;
			if (typeof nestedMessage === "string" && nestedMessage.trim()) {
				return nestedMessage;
			}
		}

		const message = record.message ?? record.error ?? record.title;

		if (typeof message === "string" && message.trim()) {
			return message;
		}
	}

	return `Request failed with status ${status}`;
}

async function parseResponse(response: Response) {
	if (response.status === 204) {
		return undefined;
	}

	const contentType = response.headers.get("content-type") ?? "";

	if (contentType.includes("application/json")) {
		return response.json();
	}

	const text = await response.text();
	return text || undefined;
}

export async function requestJson<TResponse>(path: string, options: RequestOptions = {}): Promise<TResponse> {
	const response = await fetch(resolveUrl(path), {
		method: options.method ?? "GET",
		credentials: "include",
		headers: {
			Accept: "application/json",
			...(options.body === undefined ? undefined : { "Content-Type": "application/json" }),
			...options.headers,
		},
		body: options.body === undefined ? undefined : JSON.stringify(options.body),
		signal: options.signal,
	});

	const payload = await parseResponse(response);

	if (!response.ok) {
		throw new ApiError(getErrorMessage(response.status, payload), response.status, payload);
	}

	return payload as TResponse;
}

export async function requestBinary(path: string, options: RequestOptions = {}): Promise<Uint8Array> {
	const response = await fetch(resolveUrl(path), {
		method: options.method ?? "GET",
		credentials: "include",
		headers: {
			Accept: "application/octet-stream",
			...options.headers,
		},
		signal: options.signal,
	});

	if (!response.ok) {
		const payload = await parseResponse(response);
		throw new ApiError(getErrorMessage(response.status, payload), response.status, payload);
	}

	if (response.status === 204) {
		return new Uint8Array();
	}

	return new Uint8Array(await response.arrayBuffer());
}

export async function sendBinary<TResponse>(
	path: string,
	body: Uint8Array,
	options: BinaryRequestOptions = {},
): Promise<TResponse> {
	const response = await fetch(resolveUrl(path), {
		method: options.method ?? "POST",
		credentials: "include",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/octet-stream",
			...options.headers,
		},
		body: toArrayBuffer(body),
		signal: options.signal,
	});

	const payload = await parseResponse(response);

	if (!response.ok) {
		throw new ApiError(getErrorMessage(response.status, payload), response.status, payload);
	}

	return payload as TResponse;
}
