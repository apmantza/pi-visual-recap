import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
	basenameOf,
	safeJoin,
} from "../../extensions/visual-recap/utils/paths.ts";

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

describe("basenameOf", () => {
	it("returns the last segment of a forward-slash path", () => {
		expect(basenameOf("/home/user/pi-visual-recap")).toBe("pi-visual-recap");
	});

	it("returns the last segment of a back-slash path", () => {
		expect(basenameOf("C:\\Users\\me\\project")).toBe("project");
	});

	it("strips trailing slashes before slicing", () => {
		expect(basenameOf("/home/user/project/")).toBe("project");
		expect(basenameOf("/home/user/project\\")).toBe("project");
	});

	it("returns the input when there is no separator", () => {
		expect(basenameOf("standalone")).toBe("standalone");
	});

	it("returns an empty string for a root path", () => {
		expect(basenameOf("/")).toBe("");
		expect(basenameOf("")).toBe("");
	});
});
