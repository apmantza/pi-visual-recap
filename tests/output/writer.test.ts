import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeArtifact } from "../../extensions/visual-recap/output/writer.ts";

let tmpDir: string;

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "visual-recap-writer-"));
});

afterEach(async () => {
	await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("writeArtifact", () => {
	it("writes all requested recap formats and evidence files", async () => {
		const result = await writeArtifact({
			baseDir: tmpDir,
			slug: "head-1..head-20260619-144131",
			files: {
				"recap.md": "# Recap",
				"recap.json": "{}",
				"recap.mdx": "# Recap",
				"index.html": "<!doctype html>",
			},
			evidenceFiles: {
				"diff.patch": "diff --git a/x b/x",
				"files.json": "[]",
			},
		});

		expect(path.basename(result.dir)).toBe("head-1..head-20260619-144131");
		expect(
			result.written
				.map((p) => path.relative(result.dir, p).replace(/\\/g, "/"))
				.sort((a, b) => a.localeCompare(b)),
		).toEqual([
			"evidence/diff.patch",
			"evidence/files.json",
			"index.html",
			"recap.json",
			"recap.md",
			"recap.mdx",
		]);
		expect(await fs.readFile(path.join(result.dir, "index.html"), "utf8")).toBe(
			"<!doctype html>",
		);
	});

	it("chooses one numeric suffix instead of recursively creating -1 directories", async () => {
		await writeArtifact({
			baseDir: tmpDir,
			slug: "head-1..head-20260619-144131",
			files: { "recap.md": "first" },
		});

		const second = await writeArtifact({
			baseDir: tmpDir,
			slug: "head-1..head-20260619-144131",
			files: { "recap.md": "second" },
		});

		expect(path.basename(second.dir)).toBe("head-1..head-20260619-144131-1");
		expect(
			await fs
				.readdir(tmpDir)
				.then((entries) => entries.sort((a, b) => a.localeCompare(b))),
		).toEqual([
			"head-1..head-20260619-144131",
			"head-1..head-20260619-144131-1",
		]);
		expect(await fs.readFile(path.join(second.dir, "recap.md"), "utf8")).toBe(
			"second",
		);
	});

	it("rejects unsafe path segments", async () => {
		await expect(
			writeArtifact({
				baseDir: tmpDir,
				slug: "../escape",
				files: { "recap.md": "x" },
			}),
		).rejects.toThrow(/unsafe characters/);
	});
});
