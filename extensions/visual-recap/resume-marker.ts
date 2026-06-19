// Writes a tiny "visual-recap:resume-from" custom entry into the *current*
// session so that a later `/visual-recap session current` can locate the
// session that was resumed.
//
// This must be called from `session_start` BEFORE the user has done any work
// in the resumed session. We use `pi.appendEntry` (no LLM roundtrip) so the
// marker is durable and ignored by pi's context builder (custom entries do
// not participate in LLM context by design — see session-format.md).

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { RESUME_MARKER_TYPE } from "./collectors/pi-session.ts";
import { sanitizeErrorMessage } from "./utils/log.ts";

export function writeResumeMarker(
	pi: ExtensionAPI,
	previousSessionFile: string,
	timestamp: string = new Date().toISOString(),
): void {
	try {
		pi.appendEntry(RESUME_MARKER_TYPE, {
			previousSessionFile,
			recordedAt: timestamp,
			note: "Auto-written by pi-visual-recap. Enables pre/post-resume split in /visual-recap session current.",
		});
	} catch (err) {
		// Marker write is best-effort — never crash session_start over it.
		const raw = err instanceof Error ? err.message : String(err);
		console.warn(`[pi-visual-recap] Failed to write resume marker: ${sanitizeErrorMessage(raw)}`);
	}
}
