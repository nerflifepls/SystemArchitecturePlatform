import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LogIn } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { authApi } from "../api/endpoints";
import { sessionQueryKey } from "../hooks/useAuth";
import { getErrorMessage } from "../utils/errors";

type GoogleCredentialResponse = {
	credential?: string;
	select_by?: string;
};

type GoogleAccountsApi = {
	accounts: {
		id: {
			initialize: (options: {
				client_id: string;
				callback: (response: GoogleCredentialResponse) => void;
				ux_mode?: "popup" | "redirect";
				auto_select?: boolean;
			}) => void;
			renderButton: (
				parent: HTMLElement,
				options: {
					theme?: "outline" | "filled_blue" | "filled_black";
					size?: "large" | "medium" | "small";
					shape?: "rectangular" | "pill" | "circle" | "square";
					text?: "signin_with" | "signup_with" | "continue_with" | "signin";
					width?: string;
				},
			) => void;
		};
	};
};

declare global {
	interface Window {
		google?: GoogleAccountsApi;
	}
}

const GOOGLE_SCRIPT_ID = "google-identity-services";

function loadGoogleScript() {
	const existingScript = document.querySelector<HTMLScriptElement>(`#${GOOGLE_SCRIPT_ID}`);

	if (existingScript) {
		return Promise.resolve();
	}

	return new Promise<void>((resolve, reject) => {
		const script = document.createElement("script");
		script.id = GOOGLE_SCRIPT_ID;
		script.src = "https://accounts.google.com/gsi/client";
		script.async = true;
		script.defer = true;
		script.addEventListener("load", () => resolve());
		script.addEventListener("error", () => reject(new Error("Google Identity Services could not be loaded.")));
		document.head.appendChild(script);
	});
}

export function GoogleSignInButton() {
	const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim();
	const containerRef = useRef<HTMLDivElement | null>(null);
	const [scriptError, setScriptError] = useState<string | null>(null);
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	const signInMutation = useMutation({
		mutationFn: (credential: string) => authApi.signInWithGoogle({ idToken: credential }),
		onSuccess: (session) => {
			queryClient.setQueryData(sessionQueryKey, session);
			navigate("/");
		},
	});

	useEffect(() => {
		if (!googleClientId) {
			return;
		}

		let cancelled = false;

		void loadGoogleScript()
			.then(() => {
				if (cancelled || !containerRef.current || !window.google) {
					return;
				}

				window.google.accounts.id.initialize({
					client_id: googleClientId,
					ux_mode: "popup",
					callback: (response) => {
						if (!response.credential) {
							setScriptError("Google did not return a credential token.");
							return;
						}

						signInMutation.mutate(response.credential);
					},
				});

				containerRef.current.innerHTML = "";
				window.google.accounts.id.renderButton(containerRef.current, {
					theme: "outline",
					size: "large",
					shape: "rectangular",
					text: "signin_with",
					width: "320",
				});
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					setScriptError(getErrorMessage(error));
				}
			});

		return () => {
			cancelled = true;
		};
	}, [googleClientId, signInMutation]);

	if (!googleClientId) {
		return (
			<div className="config-state">
				<LogIn size={18} />
				<div>
					<strong>Google sign-in is not configured.</strong>
					<span>Add VITE_GOOGLE_CLIENT_ID to the frontend environment and restart Vite.</span>
				</div>
			</div>
		);
	}

	return (
		<div className="google-signin">
			<div ref={containerRef} />
			{scriptError ?
				<p className="form-error">{scriptError}</p>
			:	null}
			{signInMutation.isError ?
				<p className="form-error">{getErrorMessage(signInMutation.error)}</p>
			:	null}
		</div>
	);
}
