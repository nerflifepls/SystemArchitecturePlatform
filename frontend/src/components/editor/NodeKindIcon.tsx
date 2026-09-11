import type { ReactNode } from "react";

type NodeKindIconProps = {
	className?: string;
	kind: string;
};

export const NODE_KIND_ICON_NAMES = [
	"component",
	"client",
	"service",
	"database",
	"cache",
	"queue",
	"gateway",
	"worker",
	"external",
	"boundary",
] as const;

export type NodeKindIconName = (typeof NODE_KIND_ICON_NAMES)[number];

export function normalizeNodeKindIconName(kind: string): NodeKindIconName {
	const normalizedKind = kind.trim().toLowerCase();
	return NODE_KIND_ICON_NAMES.includes(normalizedKind as NodeKindIconName) ?
		(normalizedKind as NodeKindIconName)
	: "component";
}

function iconArtwork(kind: NodeKindIconName): ReactNode {
	switch (kind) {
		case "client":
			return (
				<>
					<rect x="3.5" y="4" width="17" height="12.5" rx="2.25" />
					<path d="M8 20h8M12 16.5V20" />
					<path d="M7 8h5" opacity="0.7" />
				</>
			);
		case "service":
			return (
				<>
					<path d="m12 2.8 7.5 4.35v8.7L12 20.2l-7.5-4.35v-8.7L12 2.8Z" />
					<circle cx="12" cy="11.5" r="2.5" />
					<path d="M12 7.4v1.6M12 14v1.6M7.9 9.15l1.4.8M14.7 13.05l1.4.8M7.9 13.85l1.4-.8M14.7 9.95l1.4-.8" />
				</>
			);
		case "database":
			return (
				<>
					<ellipse cx="12" cy="5.5" rx="7.5" ry="3" />
					<path d="M4.5 5.5v6c0 1.65 3.36 3 7.5 3s7.5-1.35 7.5-3v-6" />
					<path d="M4.5 11.5v6c0 1.65 3.36 3 7.5 3s7.5-1.35 7.5-3v-6" />
			</>
			);
		case "cache":
			return (
				<>
					<rect x="3.5" y="4" width="17" height="16" rx="3" />
					<path d="m13 6.8-5 6.1h4.25L11 17.2l5-6.1h-4.25L13 6.8Z" />
				</>
			);
		case "queue":
			return (
				<>
					<circle cx="5" cy="6" r="1.5" />
					<circle cx="5" cy="12" r="1.5" />
					<circle cx="5" cy="18" r="1.5" />
					<path d="M9 6h10M9 12h7M9 18h10" />
					<path d="m16 9 3 3-3 3" />
				</>
			);
		case "gateway":
			return (
				<>
					<path d="m12 2.7 9.3 9.3-9.3 9.3L2.7 12 12 2.7Z" />
					<path d="M7.4 9.2h8.1l-2.1-2.1M16.6 14.8H8.5l2.1 2.1" />
				</>
			);
		case "worker":
			return (
				<>
					<circle cx="12" cy="12" r="3.25" />
					<path d="M9.6 3.7 10.2 2h3.6l.6 1.7 1.75 1 1.8-.35 1.8 3.1-1.2 1.4v2l1.2 1.4-1.8 3.1-1.8-.35-1.75 1-.6 1.7h-3.6l-.6-1.7-1.75-1-1.8.35-1.8-3.1 1.2-1.4v-2l-1.2-1.4 1.8-3.1 1.8.35 1.75-1Z" transform="translate(0 2.15) scale(1 .82)" />
				</>
			);
		case "external":
			return (
				<>
					<circle cx="10.5" cy="13.5" r="7.5" />
					<path d="M3.3 13.5h14.4M10.5 6c2 2.05 3 4.55 3 7.5s-1 5.45-3 7.5c-2-2.05-3-4.55-3-7.5s1-5.45 3-7.5Z" />
					<path d="M15 3h6v6M20.5 3.5l-6 6" />
				</>
			);
		case "boundary":
			return (
				<>
					<rect x="3" y="4" width="18" height="16" rx="2.5" strokeDasharray="3 2.5" />
					<path d="M3 9V6.5A2.5 2.5 0 0 1 5.5 4H8M16 4h2.5A2.5 2.5 0 0 1 21 6.5V9M21 15v2.5a2.5 2.5 0 0 1-2.5 2.5H16M8 20H5.5A2.5 2.5 0 0 1 3 17.5V15" />
				</>
			);
		case "component":
		default:
			return (
				<>
					<rect x="4" y="4" width="10.5" height="10.5" rx="2" />
					<rect x="9.5" y="9.5" width="10.5" height="10.5" rx="2" />
					<path d="M7.5 17.5H6A2 2 0 0 1 4 15.5V14M16.5 6.5H18a2 2 0 0 1 2 2V10" />
				</>
			);
	}
}

export function NodeKindIcon({ className, kind }: NodeKindIconProps) {
	const iconKind = normalizeNodeKindIconName(kind);

	return (
		<svg
			className={className}
			data-node-kind-icon={iconKind}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.8"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			focusable="false"
		>
			{iconArtwork(iconKind)}
		</svg>
	);
}
