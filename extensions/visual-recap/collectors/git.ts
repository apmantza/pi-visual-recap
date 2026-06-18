// Git evidence collector.
import { exec, tryExec } from "../utils/exec.ts";
import type { ChangedFile, CommitSummary, GitEvidence } from "../schemas.ts";
import type { RecapTarget } from "../schemas.ts";

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
				"--stat",
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
		}

		const diff = await exec(
			"git",
			[
				"diff",
				"--no-color",
				"--find-renames",
				"--find-copies",
				"--unified=80",
				"--stat",
				...rangeArgs,
				"--",
			],
			{ cwd, signal },
		);
		if (diff.exitCode === 0) {
			evidence.diffText = clamp(diff.stdout, maxDiffBytes);
		}
	}

	// numstat for accurate additions/deletions
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
		: [
				"diff",
				"--numstat",
				"--find-renames",
				"--find-copies",
				...(rangeArgs ?? []),
				"--",
			];

	const numstat = await tryExec("git", numstatArgs, { cwd, signal });
	if (numstat && numstat.exitCode === 0) {
		evidence.files = parseNumstat(numstat.stdout);
	}

	return evidence;
}

interface ResolvedRefs {
	baseRef?: string;
	headRef?: string;
	rangeArgs?: string[];
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
					rangeArgs: [target.base, "WORKING_TREE"],
					label: `working tree vs ${target.base}`,
				};
			}
			return {
				headRef: "working-tree",
				rangeArgs: ["HEAD", "WORKING_TREE"],
				label: "working tree",
			};
		}
		case "commit":
			return { label: target.ref, singleRef: target.ref };
		case "range":
			return {
				rangeArgs: target.range.split(/\s+/).filter(Boolean),
				label: target.range,
			};
		case "branch":
			return {
				baseRef: target.base,
				headRef: target.head,
				rangeArgs: [target.base, target.head ?? "HEAD"],
				label: `${target.base}..${target.head ?? "HEAD"}`,
			};
		case "pr":
		case "session":
			// PR / session handled by their own collectors; this should not be called.
			throw new Error(`Unsupported git target: ${target.kind}`);
	}
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

function parseNumstat(raw: string): ChangedFile[] {
	const lines = raw.split("\n");
	const files: ChangedFile[] = [];
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		// Format: "additions\tdeletions\tpath" with possible "old => new" in renamed paths.
		const tabParts = trimmed.split("\t");
		if (tabParts.length < 3) continue;
		const [addRaw, delRaw, ...rest] = tabParts;
		const path = rest.join("\t");
		if (addRaw === "-" || delRaw === "-") {
			files.push({
				path,
				status: "unknown",
				additions: 0,
				deletions: 0,
				binary: true,
			});
			continue;
		}
		const additions = Number.parseInt(addRaw, 10) || 0;
		const deletions = Number.parseInt(delRaw, 10) || 0;
		const status = path.includes(" => ")
			? "renamed"
			: classifyStatusFromLine(line);
		const cleanPath = path
			.replace(/\{[^}]*=>\s*([^}]*)\}/g, "$1")
			.replace(/^=>\s*/, "");
		files.push({
			path: cleanPath,
			status,
			additions,
			deletions,
			binary: false,
		});
	}
	return files;
}

function classifyStatusFromLine(line: string): ChangedFile["status"] {
	// Heuristic — only used when path has no " => " rename marker.
	if (line.startsWith("A\t")) return "added";
	if (line.startsWith("M\t")) return "modified";
	if (line.startsWith("D\t")) return "deleted";
	if (line.startsWith("C\t")) return "copied";
	if (line.startsWith("R\t")) return "renamed";
	return "modified";
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
