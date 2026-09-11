import { ArrowLeft, Boxes } from "lucide-react";
import { Link } from "react-router-dom";

export function NotFoundPage() {
	return (
		<main className="screen-center">
			<section className="status-panel wide not-found-panel">
				<span className="brand-mark" aria-hidden="true"><Boxes size={19} /></span>
				<span className="error-code">404</span>
				<h1>That page is off the canvas</h1>
				<p className="muted-copy">The workspace route may have moved, or the link is no longer available.</p>
				<Link className="primary-button" to="/">
					<ArrowLeft size={16} /> Back to dashboard
				</Link>
			</section>
		</main>
	);
}
