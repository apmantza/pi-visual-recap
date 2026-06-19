// Atomic writer for the recap artifact directory.
import * as fs from "node:fs/promises";
import * as path from "node:path";

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
		throw new Error(`${label} contains unsafe characters: ${JSON.stringify(value)}`);
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

export async function writeArtifact(
	options: WriteArtifactOptions,
): Promise<WriteArtifactResult> {
	const { baseDir, slug, files, evidenceFiles, overwrite } = options;
	assertSafeSegment(slug, "slug");
	const baseAbs = path.resolve(baseDir);
	const target = safeJoinUnder(baseAbs, slug);
	await fs.mkdir(target, { recursive: true });

	if (!overwrite) {
		try {
			await fs.access(target);
			let counter = 1;
			while (counter < 1000) {
				const candidate = safeJoinUnder(baseAbs, `${slug}-${counter}`);
				try {
					await fs.access(candidate);
					counter += 1;
				} catch {
					return await writeArtifact({
						...options,
						baseDir,
						slug: `${slug}-${counter}`,
					});
				}
			}
			throw new Error(`Too many recap artifacts with slug ${slug}`);
		} catch (err) {
			if (err instanceof Error && err.message.startsWith("Path escapes")) throw err;
			// target does not exist, proceed
		}
	}

	const written: string[] = [];

	if (evidenceFiles && Object.keys(evidenceFiles).length > 0) {
		const evidenceDir = safeJoinUnder(target, "evidence");
		await fs.mkdir(evidenceDir, { recursive: true });
		for (const [name, content] of Object.entries(evidenceFiles)) {
			assertSafeSegment(name, "evidence filename");
			const filePath = safeJoinUnder(evidenceDir, name);
			await fs.writeFile(filePath, content, "utf8");
			written.push(filePath);
		}
	}

	for (const [name, content] of Object.entries(files)) {
		assertSafeSegment(name, "output filename");
		const filePath = safeJoinUnder(target, name);
		await fs.writeFile(filePath, content, "utf8");
		written.push(filePath);
	}

	return { dir: target, written };
}
