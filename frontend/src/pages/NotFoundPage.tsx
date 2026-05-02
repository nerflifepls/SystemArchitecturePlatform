import { Link } from "react-router-dom";

export function NotFoundPage() {
	return (
		<main className="screen-center">
			<section className="status-panel wide">
				<h1>Page not found</h1>
				<p className="muted-copy">The requested workspace route does not exist.</p>
				<Link className="primary-button" to="/">
					Dashboard
				</Link>
			</section>
		</main>
	);
}
