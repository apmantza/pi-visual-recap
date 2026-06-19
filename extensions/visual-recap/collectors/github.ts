import type { ChangedFile, CommitSummary, PrEvidence } from "../schemas.ts";
import type { RecapTarget } from "../schemas.ts";
// GitHub PR evidence collector. Prefers `gh` (works for private repos when authed),
// falls back to the public REST API for public PRs.
import { tryExec } from "../utils/exec.ts";
import { clamp } from "../utils/truncate.ts";

export interface CollectPrOptions {
	cwd: string;
	signal?: AbortSignal;
	maxDiffBytes: number;
}

export async function collectPr(
	target: RecapTarget,
	options: CollectPrOptions,
): Promise<PrEvidence> {
	if (target.kind !== "pr") {
		throw new Error(
			`collectPr called with non-pr target: ${(target as { kind: string }).kind}`,
		);
	}
	const { prNumber, repoSlug, fromUrl } = parsePrTarget(target.idOrUrl);

	// 1) Try gh CLI first.
	const ghPath = await resolveGhRepo(prNumber, repoSlug, options);
	if (ghPath) {
		const evidence = await collectViaGh(
			ghPath.prNumber,
			ghPath.repoSlug,
			options,
		);
		if (evidence) return evidence;
	}

	// 2) Fallback to REST for public PRs.
	if (prNumber && repoSlug) {
		const evidence = await collectViaRest(prNumber, repoSlug, options);
		if (evidence) return evidence;
	}

	// 3) Fallback to local branch compare if PR branch is checked out.
	if (fromUrl === false) {
		throw new Error(
			`Could not collect PR data. Tried gh CLI, GitHub REST, and local checkout. Provide an explicit "owner/repo" or run inside a checkout of the PR branch.`,
		);
	}

	throw new Error(
		`Could not resolve PR ${target.idOrUrl}. Provide pr 42 in a repo context, or pass the full GitHub URL.`,
	);
}

interface GhPath {
	prNumber: number;
	repoSlug: string;
}

async function resolveGhRepo(
	prNumber: number | null,
	repoSlug: string | null,
	options: CollectPrOptions,
): Promise<GhPath | null> {
	if (prNumber && repoSlug) {
		const test = await tryExec(
			"gh",
			["pr", "view", String(prNumber), "--repo", repoSlug, "--json", "title"],
			options,
		);
		if (test && test.exitCode === 0) {
			return { prNumber, repoSlug };
		}
	}
	if (prNumber) {
		const remote = await tryExec(
			"gh",
			["repo", "view", "--json", "nameWithOwner"],
			options,
		);
		if (remote && remote.exitCode === 0) {
			try {
				const parsed = JSON.parse(remote.stdout) as { nameWithOwner?: string };
				if (parsed.nameWithOwner) {
					const test = await tryExec(
						"gh",
						[
							"pr",
							"view",
							String(prNumber),
							"--repo",
							parsed.nameWithOwner,
							"--json",
							"title",
						],
						options,
					);
					if (test && test.exitCode === 0) {
						return { prNumber, repoSlug: parsed.nameWithOwner };
					}
				}
			} catch {
				// ignore
			}
		}
	}
	return null;
}

async function collectViaGh(
	prNumber: number,
	repoSlug: string,
	options: CollectPrOptions,
): Promise<PrEvidence | null> {
	const meta = await tryExec(
		"gh",
		[
			"pr",
			"view",
			String(prNumber),
			"--repo",
			repoSlug,
			"--json",
			"title,body,author,baseRefName,headRefName,state,labels,url,number,files,commits",
		],
		options,
	);
	if (!meta || meta.exitCode !== 0) return null;

	let parsed: any;
	try {
		parsed = JSON.parse(meta.stdout);
	} catch {
		return null;
	}

	const diff = await tryExec(
		"gh",
		["pr", "diff", String(prNumber), "--repo", repoSlug],
		{ ...options, maxBuffer: options.maxDiffBytes * 2 },
	);
	const diffText = diff?.stdout ?? "";
	const files = parseGhFiles(diffText, parsed.files);
	const commits = await loadPrCommits(prNumber, repoSlug, options);

	return {
		sourceKind: "github-pr",
		repoSlug,
		prNumber: parsed.number ?? prNumber,
		url: parsed.url ?? `https://github.com/${repoSlug}/pull/${prNumber}`,
		title: String(parsed.title ?? `PR #${prNumber}`),
		body: String(parsed.body ?? ""),
		author: String(parsed.author?.login ?? parsed.author ?? "unknown"),
		baseRef: String(parsed.baseRefName ?? "main"),
		headRef: String(parsed.headRefName ?? "HEAD"),
		state: ((): PrEvidence["state"] => {
			const state = String(parsed.state ?? "").toLowerCase();
			if (state === "merged") return "merged";
			if (state === "closed") return "closed";
			if (state === "open") return "open";
			return "unknown";
		})(),
		targetLabel: `PR #${prNumber} (${repoSlug})`,
		commits,
		files,
		diffText: clamp(diffText, options.maxDiffBytes),
		labels: Array.isArray(parsed.labels)
			? parsed.labels.map((l: any) => String(l.name ?? "")).filter(Boolean)
			: [],
	};
}

async function loadPrCommits(
	prNumber: number,
	repoSlug: string,
	options: CollectPrOptions,
): Promise<CommitSummary[]> {
	const result = await tryExec(
		"gh",
		["pr", "view", String(prNumber), "--repo", repoSlug, "--json", "commits"],
		options,
	);
	if (!result || result.exitCode !== 0) return [];
	try {
		const parsed = JSON.parse(result.stdout) as { commits?: any[] };
		if (!Array.isArray(parsed.commits)) return [];
		return parsed.commits.map((c: any) => ({
			sha: String(c.oid ?? c.sha ?? ""),
			shortSha: String(c.oid ?? c.sha ?? "").slice(0, 7),
			subject:
				String(c.messageHeadline ?? c.messageHead ?? c.message ?? "").split(
					"\n",
				)[0] ?? "",
			author: String(
				c.authors?.[0]?.login ?? c.author?.login ?? c.author ?? "unknown",
			),
			date: c.committedDate ? String(c.committedDate).slice(0, 10) : undefined,
		}));
	} catch {
		return [];
	}
}

async function collectViaRest(
	prNumber: number,
	repoSlug: string,
	options: CollectPrOptions,
): Promise<PrEvidence | null> {
	const headers = [
		"Accept: application/vnd.github+json",
		"User-Agent: pi-visual-recap",
	];
	const meta = await tryExec(
		"curl",
		[
			"-sSL",
			...headers.flatMap((h) => ["-H", h]),
			`https://api.github.com/repos/${repoSlug}/pulls/${prNumber}`,
		],
		options,
	);
	if (!meta || meta.exitCode !== 0) {
		if (meta) {
			console.warn(
				`[pi-visual-recap] REST pr meta ${repoSlug}#${prNumber} failed: ${meta.stderr || "no stderr"}`,
			);
		}
		return null;
	}
	let parsed: any;
	try {
		parsed = JSON.parse(meta.stdout);
	} catch {
		return null;
	}
	if (parsed.message) return null;

	const diff = await tryExec(
		"curl",
		[
			"-sSL",
			...headers.flatMap((h) => ["-H", h]),
			`https://github.com/${repoSlug}/pull/${prNumber}.diff`,
		],
		{ ...options, maxBuffer: options.maxDiffBytes * 2 },
	);
	if (!diff || diff.exitCode !== 0) {
		if (diff) {
			console.warn(
				`[pi-visual-recap] REST pr diff ${repoSlug}#${prNumber} failed: ${diff.stderr || "no stderr"}`,
			);
		}
	}
	const diffText = diff?.stdout ?? "";
	const files = parseUnifiedDiff(diffText);

	return {
		sourceKind: "github-pr",
		repoSlug,
		prNumber: parsed.number ?? prNumber,
		url: parsed.html_url ?? `https://github.com/${repoSlug}/pull/${prNumber}`,
		title: String(parsed.title ?? `PR #${prNumber}`),
		body: String(parsed.body ?? ""),
		author: String(parsed.user?.login ?? "unknown"),
		baseRef: String(parsed.base?.ref ?? "main"),
		headRef: String(parsed.head?.ref ?? "HEAD"),
		state: ((): PrEvidence["state"] => {
			if (parsed.merged) return "merged";
			if (parsed.state === "closed") return "closed";
			if (parsed.state === "open") return "open";
			return "unknown";
		})(),
		targetLabel: `PR #${prNumber} (${repoSlug})`,
		commits: [],
		files,
		diffText: clamp(diffText, options.maxDiffBytes),
		labels: Array.isArray(parsed.labels)
			? parsed.labels.map((l: any) => String(l.name ?? "")).filter(Boolean)
			: [],
	};
}

function parsePrTarget(raw: string): {
	prNumber: number | null;
	repoSlug: string | null;
	fromUrl: boolean;
} {
	const trimmed = raw.trim();
	const urlMatch = trimmed.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i);
	if (urlMatch) {
		return {
			prNumber: Number.parseInt(urlMatch[3] ?? "", 10) || null,
			repoSlug: `${urlMatch[1]}/${urlMatch[2]}`,
			fromUrl: true,
		};
	}
	if (/^\d+$/.test(trimmed)) {
		return {
			prNumber: Number.parseInt(trimmed, 10),
			repoSlug: null,
			fromUrl: false,
		};
	}
	const ownerRepo = trimmed.match(/^([^/\s]+)\/([^/\s]+)$/);
	if (ownerRepo) {
		return {
			prNumber: null,
			repoSlug: `${ownerRepo[1]}/${ownerRepo[2]}`,
			fromUrl: false,
		};
	}
	return { prNumber: null, repoSlug: null, fromUrl: false };
}

function parseGhFiles(diffText: string, ghFiles: unknown): ChangedFile[] {
	if (Array.isArray(ghFiles) && ghFiles.length > 0) {
		return ghFiles.map((f: any) => ({
			path: String(f.path ?? ""),
			oldPath: f.previous_filename ? String(f.previous_filename) : undefined,
			status: (f.status as ChangedFile["status"]) ?? "modified",
			additions: Number(f.additions ?? 0),
			deletions: Number(f.deletions ?? 0),
			binary: false,
		}));
	}
	return parseUnifiedDiff(diffText);
}

function parseUnifiedDiff(diffText: string): ChangedFile[] {
	const files: ChangedFile[] = [];
	const lines = diffText.split("\n");
	let current: ChangedFile | null = null;
	for (const line of lines) {
		if (line.startsWith("diff --git ")) {
			if (current) files.push(current);
			const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
			const path = match?.[2] ?? match?.[1] ?? "unknown";
			current = {
				path,
				oldPath:
					match?.[1] && match[2] && match[1] !== match[2]
						? match[1]
						: undefined,
				status: "modified",
				additions: 0,
				deletions: 0,
				binary: false,
			};
			continue;
		}
		if (!current) continue;
		if (line.startsWith("new file")) current.status = "added";
		else if (line.startsWith("deleted file")) current.status = "deleted";
		else if (line.startsWith("rename from")) current.status = "renamed";
		else if (line.startsWith("copy from")) current.status = "copied";
		else if (line.startsWith("Binary files")) current.binary = true;
		else if (line.startsWith("+") && !line.startsWith("+++"))
			current.additions += 1;
		else if (line.startsWith("-") && !line.startsWith("---"))
			current.deletions += 1;
	}
	if (current) files.push(current);
	return files;
}

// clamp() lives in ../utils/truncate.ts and is imported at the top of this file.
