// Atomic writer for the recap artifact directory.
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

export interface WriteArtifactOptions {
	baseDir: string;
	slug: string;
	files: Record<string, string>;
	evidenceFiles?: Record<string, string>;
	overwrite?: boolean;
}

export interface WriteArtifactResult {
	dir: string;
	written: string[];
}

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;
const MAX_NAME_LENGTH = 100;

function assertSafeSegment(value: string, label: string): void {
	if (!value || value.length > MAX_NAME_LENGTH) {
		throw new Error(`${label} must be 1-${MAX_NAME_LENGTH} chars`);
	}
	if (!SAFE_SEGMENT.test(value) || value === "." || value === "..") {
		throw new Error(
			`${label} contains unsafe characters: ${JSON.stringify(value)}`,
		);
	}
}

function safeJoinUnder(base: string, ...parts: string[]): string {
	const normalizedBase = path.resolve(base);
	const target = path.resolve(normalizedBase, ...parts);
	const relative = path.relative(normalizedBase, target);
	if (relative.startsWith("..") || path.isAbsolute(relative)) {
		throw new Error(`Path escapes base directory: ${parts.join("/")}`);
	}
	return target;
}

function errorCode(err: unknown): unknown {
	return typeof err === "object" && err !== null && "code" in err
		? (err as { code?: unknown }).code
		: undefined;
}

function isAlreadyExistsError(err: unknown): boolean {
	return errorCode(err) === "EEXIST";
}

function isNotFoundError(err: unknown): boolean {
	return errorCode(err) === "ENOENT";
}

async function replaceDirectory(preparedDir: string, finalDir: string): Promise<void> {
	const backupDir = `${finalDir}.bak-${process.pid}-${Date.now()}-${randomUUID()}`;
	let movedExisting = false;
	try {
		await fs.rename(finalDir, backupDir);
		movedExisting = true;
	} catch (err) {
		if (!isNotFoundError(err)) throw err;
	}

	try {
		await fs.rename(preparedDir, finalDir);
	} catch (err) {
		if (movedExisting) {
			try {
				await fs.rename(backupDir, finalDir);
			} catch (restoreErr) {
				throw new Error(
					`Failed to publish ${finalDir} and restore previous artifact: ${String(restoreErr)}`,
					{ cause: err },
				);
			}
		}
		throw err;
	}

	if (movedExisting) {
		await fs.rm(backupDir, { recursive: true, force: true }).catch((err) => {
			console.warn(`Failed to remove old recap artifact backup ${backupDir}`, err);
		});
	}
}

export async function writeArtifact(
	options: WriteArtifactOptions,
): Promise<WriteArtifactResult> {
	const { baseDir, slug, files, evidenceFiles, overwrite } = options;
	assertSafeSegment(slug, "slug");
	const baseAbs = path.resolve(baseDir);
	await fs.mkdir(baseAbs, { recursive: true });
	let finalDir = safeJoinUnder(baseAbs, slug);
	let writeDir = finalDir;

	if (overwrite) {
		writeDir = await fs.mkdtemp(safeJoinUnder(baseAbs, `${slug}.tmp-`));
	} else {
		let counter = 0;
		while (counter < 1000) {
			const candidateSlug = counter === 0 ? slug : `${slug}-${counter}`;
			const candidate = safeJoinUnder(baseAbs, candidateSlug);
			try {
				await fs.mkdir(candidate);
				finalDir = candidate;
				writeDir = candidate;
				break;
			} catch (err) {
				if (!isAlreadyExistsError(err)) {
					throw err;
				}
				counter += 1;
			}
		}
		if (counter >= 1000) {
			throw new Error(`Too many recap artifacts with slug ${slug}`);
		}
	}

	const writtenRelative: string[] = [];
	let published = false;
	try {
		if (evidenceFiles && Object.keys(evidenceFiles).length > 0) {
			const evidenceDir = safeJoinUnder(writeDir, "evidence");
			await fs.mkdir(evidenceDir, { recursive: true });
			for (const [name, content] of Object.entries(evidenceFiles)) {
				assertSafeSegment(name, "evidence filename");
				const filePath = safeJoinUnder(evidenceDir, name);
				await fs.writeFile(filePath, content, "utf8");
				writtenRelative.push(`evidence/${name}`);
			}
		}

		for (const [name, content] of Object.entries(files)) {
			assertSafeSegment(name, "output filename");
			const filePath = safeJoinUnder(writeDir, name);
			await fs.writeFile(filePath, content, "utf8");
			writtenRelative.push(name);
		}

		if (overwrite) {
			await replaceDirectory(writeDir, finalDir);
			published = true;
		}
	} catch (err) {
		if (overwrite && !published) {
			await fs.rm(writeDir, { recursive: true, force: true }).catch(() => undefined);
		}
		throw err;
	}

	const written = writtenRelative.map((name) =>
		safeJoinUnder(finalDir, ...name.split("/")),
	);
	return { dir: finalDir, written };
}
