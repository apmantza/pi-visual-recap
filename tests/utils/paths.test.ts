import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { safeJoin } from "../../extensions/visual-recap/utils/paths.ts";

describe("safeJoin", () => {
	const base = path.resolve("/tmp/safe-base");

	it("joins a relative path under the base", () => {
		const result = safeJoin(base, "sub", "file.txt");
		expect(result).toBe(path.join(base, "sub", "file.txt"));
	});

	it("throws when a part escapes the base via ..", () => {
		expect(() => safeJoin(base, "..", "outside.txt")).toThrow(
			/escapes base directory/,
		);
	});

	it("throws when a part is absolute and points outside the base", () => {
		expect(() => safeJoin(base, "/etc/passwd")).toThrow(
			/escapes base directory/,
		);
	});

	it("returns the base when parts is empty", () => {
		expect(safeJoin(base)).toBe(base);
	});
});
