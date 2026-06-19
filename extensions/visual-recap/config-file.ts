// Project-local config loader for visual recap. Read from the Pi project config
// directory when the project is trusted. Silent on any read/parse error.
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import type { VisualRecapConfig } from "./config.ts";

export async function readConfigFile(
	cwd: string,
): Promise<VisualRecapConfig | undefined> {
	const filePath = path.join(cwd, CONFIG_DIR_NAME, "visual-recap.json");
	try {
		const raw = await fs.readFile(filePath, "utf8");
		const parsed = JSON.parse(raw) as VisualRecapConfig;
		return parsed;
	} catch {
		return undefined;
	}
}
