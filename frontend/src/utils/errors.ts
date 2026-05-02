import { ApiError } from "../api/client";

export function getErrorMessage(error: unknown) {
	if (error instanceof ApiError) {
		return error.message;
	}

	if (error instanceof Error) {
		return error.message;
	}

	return "Something went wrong.";
}
