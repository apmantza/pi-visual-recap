// Render a RecapDocument as JSON.
import type { RecapDocument } from "../schemas.ts";

export function renderJson(doc: RecapDocument): string {
	return JSON.stringify(doc, null, 2);
}
