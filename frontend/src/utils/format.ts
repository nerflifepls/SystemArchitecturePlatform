export function formatUpdatedAt(value?: string) {
	if (!value) {
		return "Recently active";
	}

	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return "Recently active";
	}

	return `Updated ${new Intl.DateTimeFormat("en", {
		month: "short",
		day: "numeric",
		year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
	}).format(date)}`;
}
