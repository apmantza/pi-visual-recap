import type { ChangedFile, CommitSummary, GitEvidence } from "../schemas.ts";
import type { RecapTarget } from "../schemas.ts";
// Git evidence collector.
import { exec, tryExec } from "../utils/exec.ts";

export interface CollectGitOptions {
	cwd: string;
	signal?: AbortSignal;
	maxDiffBytes: number;
}

export async function collectGit(
	target: RecapTarget,
	options: CollectGitOptions,
): Promise<GitEvidence> {
	const { cwd, signal, maxDiffBytes } = options;

	// Ensure we are in a git repo.
	const toplevel = await tryExec("git", ["rev-parse", "--show-toplevel"], {
		cwd,
		signal,
	});
	if (!toplevel || toplevel.exitCode !== 0) {
		throw new Error("Not a git repository (or no git available)");
	}
	const repoRoot = toplevel.stdout.trim();

	const { baseRef, headRef, rangeArgs, label, singleRef } = resolveRefs(target);

	const evidence: GitEvidence = {
		repoRoot,
		targetLabel: label,
		baseRef,
		headRef,
		commits: [],
		files: [],
		diffText: "",
	};

	if (singleRef) {
		const show = await exec(
			"git",
			[
				"show",
				"--find-renames",
				"--find-copies",
				"--format=",
				"--unified=80",
				singleRef,
				"--",
			],
			{ cwd, signal },
		);
		if (show.exitCode === 0) {
			evidence.diffText = clamp(show.stdout, maxDiffBytes);
		} else {
			console.warn(
				`[pi-visual-recap] git show ${singleRef} failed: ${show.stderr || "no stderr"}`,
			);
		}
	} else if (rangeArgs) {
		const log = await tryExec(
			"git",
			[
				"log",
				"--no-color",
				"--pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%ad",
				"--date=short",
				...rangeArgs,
			],
			{ cwd, signal },
		);
		if (log && log.exitCode === 0 && log.stdout.trim()) {
			evidence.commits = parseCommits(log.stdout);
		} else if (log && log.exitCode !== 0) {
			console.warn(
				`[pi-visual-recap] git log failed: ${log.stderr || "no stderr"}`,
			);
		}

		const diff = await exec(
			"git",
			[
				"diff",
				"--no-color",
				"--find-renames",
				"--find-copies",
				"--unified=80",
				...rangeArgs,
				"--",
			],
			{ cwd, signal },
		);
		if (diff.exitCode === 0) {
			evidence.diffText = clamp(diff.stdout, maxDiffBytes);
		} else {
			console.warn(
				`[pi-visual-recap] git diff failed: ${diff.stderr || "no stderr"}`,
			);
		}
	} else {
		// Working tree: collect staged + unstaged diffs against a base (or HEAD).
		const base =
			target.kind === "working-tree" && target.base
				? sanitizeRangeArg(target.base)
				: "HEAD";
		const staged = await tryExec(
			"git",
			[
				"diff",
				"--no-color",
				"--find-renames",
				"--find-copies",
				"--unified=80",
				"--cached",
				base,
				"--",
			],
			{ cwd, signal },
		);
		const unstaged = await tryExec(
			"git",
			[
				"diff",
				"--no-color",
				"--find-renames",
				"--find-copies",
				"--unified=80",
				base,
				"--",
			],
			{ cwd, signal },
		);
		if (staged && staged.exitCode !== 0) {
			console.warn(
				`[pi-visual-recap] git diff --cached ${base} failed: ${staged.stderr || "no stderr"}`,
			);
		}
		if (unstaged && unstaged.exitCode !== 0) {
			console.warn(
				`[pi-visual-recap] git diff ${base} failed: ${unstaged.stderr || "no stderr"}`,
			);
		}
		const combined = [staged?.stdout ?? "", unstaged?.stdout ?? ""]
			.filter((s) => s.length > 0)
			.join("\n");
		if (combined.length > 0) {
			evidence.diffText = clamp(combined, maxDiffBytes);
		}
	}

	// numstat for accurate additions/deletions, --name-status for accurate
	// per-file status (additions/deletions alone can't tell us added vs modified).
	const numstatArgs = singleRef
		? [
				"show",
				"--numstat",
				"--find-renames",
				"--find-copies",
				"--format=",
				singleRef,
				"--",
			]
		: rangeArgs
			? [
					"diff",
					"--numstat",
					"--find-renames",
					"--find-copies",
					...rangeArgs,
					"--",
				]
			: [
					// Working-tree case: combine staged and unstaged numstat.
					"diff",
					"--numstat",
					"--find-renames",
					"--find-copies",
					"HEAD",
					"--",
				];

	const numstat = await tryExec("git", numstatArgs, { cwd, signal });
	const nameStatusArgs = singleRef
		? [
				"show",
				"--name-status",
				"--find-renames",
				"--find-copies",
				"--format=",
				singleRef,
				"--",
			]
		: rangeArgs
			? [
					"diff",
					"--name-status",
					"--find-renames",
					"--find-copies",
					...rangeArgs,
					"--",
				]
			: [
					"diff",
					"--name-status",
					"--find-renames",
					"--find-copies",
					"HEAD",
					"--",
				];
	const nameStatus = await tryExec("git", nameStatusArgs, { cwd, signal });

	if (numstat && numstat.exitCode === 0) {
		const statusMap = parseNameStatus(nameStatus?.stdout ?? "");
		evidence.files = mergeNumstatWithStatus(numstat.stdout, statusMap);
	}

	return evidence;
}

interface ResolvedRefs {
	baseRef?: string;
	headRef?: string;
	rangeArgs?: string[] | null;
	label: string;
	singleRef?: string;
}

function resolveRefs(target: RecapTarget): ResolvedRefs {
	switch (target.kind) {
		case "working-tree": {
			if (target.base) {
				return {
					baseRef: target.base,
					headRef: "working-tree",
					// Use a "fake merge base" via git's three-dot diff: base..working-tree
					// won't work, so we use the index as a virtual right side via
					// `git diff base` (compare working tree to base) and `git diff --cached base`
					// (compare index to base). The collector concatenates both via a
					// pseudo range "base + staged + unstaged".
					rangeArgs: null,
					label: `working tree vs ${target.base}`,
				};
			}
			return {
				headRef: "working-tree",
				rangeArgs: null,
				label: "working tree",
			};
		}
		case "commit":
			return { label: target.ref, singleRef: target.ref };
		case "range":
			return {
				rangeArgs: [sanitizeRangeArg(target.range)],
				label: target.range,
			};
		case "branch":
			return {
				baseRef: target.base,
				headRef: target.head,
				rangeArgs: [
					sanitizeRangeArg(target.base),
					sanitizeRangeArg(target.head ?? "HEAD"),
				],
				label: `${target.base}..${target.head ?? "HEAD"}`,
			};
		case "pr":
		case "session":
			// PR / session handled by their own collectors; this should not be called.
			throw new Error(`Unsupported git target: ${target.kind}`);
	}
}

// Git revisions can include up to two dot-separated refs. We pass the entire
// range as a single argument rather than splitting on whitespace so the caller
// cannot inject arbitrary git flags through a crafted target.
function sanitizeRangeArg(input: string): string {
	const trimmed = input.trim();
	if (!trimmed) {
		throw new Error("Empty git revision");
	}
	// Reject anything that looks like a git option (starts with "-") to avoid
	// flag injection. Reject newlines to keep the command line clean.
	if (trimmed.startsWith("-") || /[\r\n]/.test(trimmed)) {
		throw new Error(`Invalid git revision: ${JSON.stringify(trimmed)}`);
	}
	return trimmed;
}

function parseCommits(raw: string): CommitSummary[] {
	return raw
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			const [sha, shortSha, subject, author, date] = line.split("\x1f");
			return {
				sha: sha ?? "",
				shortSha: shortSha ?? (sha ? sha.slice(0, 7) : ""),
				subject: subject ?? "",
				author: author ?? "",
				date: date || undefined,
			};
		});
}

// Parse `git diff --name-status` output into a map keyed by the post-rename
// file path. Each line is "<status>\t<path>" or for renames/copies
// "<status>\t<oldPath>\t<newPath>".
function parseNameStatus(raw: string): Map<string, ChangedFile["status"]> {
	const map = new Map<string, ChangedFile["status"]>();
	for (const rawLine of raw.split("\n")) {
		const line = rawLine.trim();
		if (!line) continue;
		const parts = line.split("\t");
		const status = parts[0] ?? "";
		// For renames/copies we use the new path (last segment) as the key so it
		// lines up with the path emitted by --numstat.
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
}

// Combine numstat (additions/deletions/binary) with name-status (status
// letter) into ChangedFile[]. Tolerant of path-renames by normalising the
// "{old => new}" rename syntax that --numstat emits.
function mergeNumstatWithStatus(
	numstat: string,
	statusMap: Map<string, ChangedFile["status"]>,
): ChangedFile[] {
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
}

function clamp(text: string, maxBytes: number): string {
	if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
	const headBytes = Math.floor(maxBytes * 0.6);
	const tailBytes = maxBytes - headBytes;
	const head = text.slice(0, headBytes);
	const tail = text.slice(text.length - tailBytes);
	const omitted = Buffer.byteLength(text, "utf8") - headBytes - tailBytes;
	return `${head}\n\n[... ${omitted} bytes of diff omitted for context budget ...]\n\n${tail}`;
}
