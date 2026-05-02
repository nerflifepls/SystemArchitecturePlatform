import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { Button, ButtonLink } from "./Button";

describe("Button", () => {
	it("renders an accessible button and forwards click handlers", async () => {
		const handleClick = vi.fn();
		render(<Button onClick={handleClick}>Save</Button>);

		const button = screen.getByRole("button", { name: "Save" });
		button.click();

		expect(handleClick).toHaveBeenCalledTimes(1);
	});

	it("renders router links with button styling", () => {
		render(
			<MemoryRouter>
				<ButtonLink to="/workspaces/1" variant="primary">
					Open
				</ButtonLink>
			</MemoryRouter>,
		);

		expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute("href", "/workspaces/1");
	});
});
