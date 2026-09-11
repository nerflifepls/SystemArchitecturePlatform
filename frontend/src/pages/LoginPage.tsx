import { Navigate, useLocation } from "react-router-dom";
import { Boxes, GitBranch, MousePointer2, UsersRound } from "lucide-react";

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
			<section className="login-showcase" aria-label="Product overview">
				<div className="showcase-copy">
					<span className="showcase-pill"><span /> Collaborative system design</span>
					<h1>Architecture is clearer when the whole team can see it.</h1>
					<p>Map services, explain decisions, and evolve complex systems together on one focused canvas.</p>
				</div>
				<div className="showcase-canvas" aria-hidden="true">
					<div className="canvas-toolbar"><span /><span /><span /></div>
					<div className="canvas-node node-client"><MousePointer2 size={15} /><span>Client</span></div>
					<div className="canvas-node node-api"><GitBranch size={15} /><span>API Gateway</span></div>
					<div className="canvas-node node-service"><Boxes size={15} /><span>Services</span></div>
					<div className="canvas-line line-one" />
					<div className="canvas-line line-two" />
					<div className="canvas-collaborator"><UsersRound size={14} /> 3 designing</div>
				</div>
				<div className="showcase-proof">
					<span>Realtime collaboration</span>
					<span>Versioned snapshots</span>
					<span>Focused canvas</span>
				</div>
			</section>
			<section className="login-panel" aria-labelledby="login-title">
				<div className="brand-block login-brand">
					<span className="brand-mark" aria-hidden="true"><Boxes size={19} /></span>
					<div>
						<strong>System Design</strong>
						<span>Visual architecture workspace</span>
					</div>
				</div>
				<div className="login-heading">
					<span className="eyebrow">Welcome back</span>
					<h2 id="login-title">Continue designing</h2>
					<p className="muted-copy">Sign in with Google to open your workspaces and diagrams.</p>
				</div>
				<GoogleSignInButton />
				{sessionQuery.isError ?
					<p className="form-error">Session check failed: {getErrorMessage(sessionQuery.error)}</p>
				:	null}
				<div className="config-state compact login-endpoint">
					<span><i /> Secure connection</span>
					<strong>{API_BASE_URL}</strong>
				</div>
			</section>
		</main>
	);
}
