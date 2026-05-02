import { Navigate, useLocation } from "react-router-dom";

import { API_BASE_URL } from "../api/client";
import { GoogleSignInButton } from "../components/GoogleSignInButton";
import { useSession } from "../hooks/useAuth";
import { getErrorMessage } from "../utils/errors";

type LoginLocationState = {
	from?: string;
};

export function LoginPage() {
	const location = useLocation();
	const sessionQuery = useSession();
	const state = location.state as LoginLocationState | null;

	if (sessionQuery.data?.user) {
		return <Navigate to={state?.from ?? "/"} replace />;
	}

	return (
		<main className="login-layout">
			<section className="login-panel" aria-labelledby="login-title">
				<div className="brand-block login-brand">
					<span className="brand-mark">SD</span>
					<div>
						<strong>System Design</strong>
						<span>Collaborative MVP</span>
					</div>
				</div>
				<h1 id="login-title">Sign in</h1>
				<p className="muted-copy">Use a Google account connected to the backend session service.</p>
				<GoogleSignInButton />
				{sessionQuery.isError ?
					<p className="form-error">Session check failed: {getErrorMessage(sessionQuery.error)}</p>
				:	null}
				<div className="config-state compact">
					<span>Backend</span>
					<strong>{API_BASE_URL}</strong>
				</div>
			</section>
		</main>
	);
}
