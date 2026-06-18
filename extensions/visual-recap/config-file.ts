// Project-local config loader for visual recap. Read from .pi/visual-recap.json
// when the project is trusted. Silent on any read/parse error.
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { VisualRecapConfig } from "./config.ts";

export async function readConfigFile(
	cwd: string,
): Promise<VisualRecapConfig | undefined> {
	const filePath = path.join(cwd, ".pi", "visual-recap.json");
	try {
		const raw = await fs.readFile(filePath, "utf8");
		const parsed = JSON.parse(raw) as VisualRecapConfig;
		return parsed;
	} catch {
		return undefined;
	}
}
