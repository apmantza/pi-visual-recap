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

export async function writeArtifact(
	options: WriteArtifactOptions,
): Promise<WriteArtifactResult> {
	const { baseDir, slug, files, evidenceFiles, overwrite } = options;
	const target = path.join(baseDir, slug);
	await fs.mkdir(target, { recursive: true });

	if (!overwrite) {
		try {
			await fs.access(target);
			// If it exists, append a numeric suffix.
			let counter = 1;
			while (true) {
				const candidate = path.join(baseDir, `${slug}-${counter}`);
				try {
					await fs.access(candidate);
					counter += 1;
				} catch {
					break;
				}
			}
			return await writeArtifact({
				...options,
				baseDir,
				slug: `${slug}-${counter}`,
			});
		} catch {
			// target does not exist, proceed
		}
	}

	const written: string[] = [];

	if (evidenceFiles && Object.keys(evidenceFiles).length > 0) {
		const evidenceDir = path.join(target, "evidence");
		await fs.mkdir(evidenceDir, { recursive: true });
		for (const [name, content] of Object.entries(evidenceFiles)) {
			const filePath = path.join(evidenceDir, name);
			await fs.writeFile(filePath, content, "utf8");
			written.push(filePath);
		}
	}

	for (const [name, content] of Object.entries(files)) {
		const filePath = path.join(target, name);
		await fs.writeFile(filePath, content, "utf8");
		written.push(filePath);
	}

	return { dir: target, written };
}
