import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { NODE_KIND_ICON_NAMES, NodeKindIcon, normalizeNodeKindIconName } from "./NodeKindIcon";

describe("node kind icons", () => {
	afterEach(cleanup);

	it.each(NODE_KIND_ICON_NAMES)("renders a dedicated inline SVG for %s nodes", (kind) => {
		const { container } = render(<NodeKindIcon kind={kind} />);
		const icon = container.querySelector(`svg[data-node-kind-icon="${kind}"]`);

		expect(icon).not.toBeNull();
		expect(icon?.getAttribute("viewBox")).toBe("0 0 24 24");
		expect(icon?.children.length).toBeGreaterThan(0);
	});

	it("uses the component symbol for custom or unknown kinds", () => {
		expect(normalizeNodeKindIconName(" Custom thesis node ")).toBe("component");
	});
});
