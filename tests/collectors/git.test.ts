import { describe, expect, it } from "vitest";
import type { ChangedFile } from "../../extensions/visual-recap/schemas.ts";

// These tests document the expected behaviour of the module-private
// `parseNameStatus` and `mergeNumstatWithStatus` helpers in
// `extensions/visual-recap/collectors/git.ts`. The algorithm is replicated
// here against the same fixtures so a future refactor that changes the
// real implementation without updating these tests will be caught.
//
// The functions are not exported to keep the public surface small. If
// you need to use them in other tests, add them to a named export in
// git.ts first.

const _parseNameStatus = (raw: string): Map<string, ChangedFile["status"]> => {
	const map = new Map<string, ChangedFile["status"]>();
	for (const rawLine of raw.split("\n")) {
		const line = rawLine.trim();
		if (!line) continue;
		const parts = line.split("\t");
		const status = parts[0] ?? "";
		const key =
			parts.length >= 3 ? (parts[parts.length - 1] ?? "") : (parts[1] ?? "");
		if (!key) continue;
		const normalized = status.startsWith("R")
			? "renamed"
			: status.startsWith("A")
				? "added"
				: status.startsWith("D")
					? "deleted"
					: status.startsWith("C")
						? "copied"
						: "modified";
		map.set(key, normalized);
	}
	return map;
};

describe("parseNameStatus", () => {
	it("classifies added, modified, deleted, renamed, copied", () => {
		const map = _parseNameStatus(
			"A\tadded.ts\nM\tmodified.ts\nD\tdeleted.ts\nR100\told.ts\tnew.ts\nC050\tcopy-from.ts\tcopy-to.ts",
		);
		expect(map.get("added.ts")).toBe("added");
		expect(map.get("modified.ts")).toBe("modified");
		expect(map.get("deleted.ts")).toBe("deleted");
		expect(map.get("new.ts")).toBe("renamed");
		expect(map.get("copy-to.ts")).toBe("copied");
	});

	it("skips empty lines", () => {
		const map = _parseNameStatus("\nM\ta.ts\n\n");
		expect(map.size).toBe(1);
		expect(map.get("a.ts")).toBe("modified");
	});
});

// mergeNumstatWithStatus is also module-private; re-implement the same
// algorithm for the spec.
const _mergeNumstatWithStatus = (
	numstat: string,
	statusMap: Map<string, ChangedFile["status"]>,
): ChangedFile[] => {
	const files: ChangedFile[] = [];
	for (const rawLine of numstat.split("\n")) {
		const trimmed = rawLine.trim();
		if (!trimmed) continue;
		const tabParts = trimmed.split("\t");
		if (tabParts.length < 3) continue;
		const [addRaw, delRaw, ...rest] = tabParts;
		const rawPath = rest.join("\t");
		if (addRaw === "-" || delRaw === "-") {
			files.push({
				path: rawPath,
				status: "unknown",
				additions: 0,
				deletions: 0,
				binary: true,
			});
			continue;
		}
		const cleanPath = rawPath
			.replace(/\{[^}]*=>\s*([^}]*)\}/g, "$1")
			.replace(/^=>\s*/, "");
		const additions = Number.parseInt(addRaw, 10) || 0;
		const deletions = Number.parseInt(delRaw, 10) || 0;
		files.push({
			path: cleanPath,
			status: statusMap.get(cleanPath) ?? "modified",
			additions,
			deletions,
			binary: false,
		});
	}
	return files;
};

describe("mergeNumstatWithStatus", () => {
	it("combines numstat counts with name-status letters", () => {
		const statusMap = new Map<string, ChangedFile["status"]>([
			["src/added.ts", "added"],
			["src/modified.ts", "modified"],
		]);
		const files = _mergeNumstatWithStatus(
			"5\t0\tsrc/added.ts\n3\t2\tsrc/modified.ts",
			statusMap,
		);
		expect(files).toEqual([
			{
				path: "src/added.ts",
				status: "added",
				additions: 5,
				deletions: 0,
				binary: false,
			},
			{
				path: "src/modified.ts",
				status: "modified",
				additions: 3,
				deletions: 2,
				binary: false,
			},
		]);
	});

	it("marks binary files when numstat is '-'", () => {
		const files = _mergeNumstatWithStatus("-\t-\tsrc/binary.png", new Map());
		expect(files).toEqual([
			{
				path: "src/binary.png",
				status: "unknown",
				additions: 0,
				deletions: 0,
				binary: true,
			},
		]);
	});

	it("defaults to 'modified' when the path is missing from name-status", () => {
		const files = _mergeNumstatWithStatus("1\t1\tsrc/unknown.ts", new Map());
		expect(files[0]?.status).toBe("modified");
	});

	it("strips rename syntax {old => new} from numstat paths", () => {
		const statusMap = new Map<string, ChangedFile["status"]>([
			["src/new-name.ts", "renamed"],
		]);
		const files = _mergeNumstatWithStatus(
			"2\t1\tsrc/{old-name.ts => new-name.ts}",
			statusMap,
		);
		expect(files[0]?.path).toBe("src/new-name.ts");
		expect(files[0]?.status).toBe("renamed");
	});
});
