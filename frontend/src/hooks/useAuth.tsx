import { useQuery, useQueryClient } from "@tanstack/react-query";

import { authApi } from "../api/endpoints";
import type { AuthSessionDto } from "../api/types";

export const sessionQueryKey = ["auth", "me"] as const;

export function useSession() {
	return useQuery({
		queryKey: sessionQueryKey,
		queryFn: ({ signal }) => authApi.me(signal),
	});
}

export function useSetSession() {
	const queryClient = useQueryClient();

	return (session: AuthSessionDto) => {
		queryClient.setQueryData(sessionQueryKey, session);
	};
}
