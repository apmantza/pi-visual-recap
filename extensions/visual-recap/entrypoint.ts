// Pi visual recap extension — entrypoint.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	registerVisualRecapCommand,
	registerVisualRecapTool,
} from "./index.ts";
import { writeResumeMarker } from "./resume-marker.ts";
import { sanitizeErrorMessage } from "./utils/log.ts";

export default function (pi: ExtensionAPI) {
	registerVisualRecapCommand(pi);
	registerVisualRecapTool(pi);

	// On /resume (not on /new), record a tiny marker so a later
	// `/visual-recap session current` can split pre-resume vs post-resume.
	// No recap is auto-generated — the user must still type /visual-recap.
	pi.on("session_start", (event) => {
		try {
			if (event.reason !== "resume") return;
			if (!event.previousSessionFile) return;
			writeResumeMarker(pi, event.previousSessionFile);
		} catch (err) {
			// Belt-and-braces for any synchronous throw from writeResumeMarker
			// or the guard checks above. Note: this try/catch does NOT catch
			// unhandled promise rejections — if a future change in
			// pi.appendEntry returns a promise, that needs explicit .catch
			// handling inside writeResumeMarker. For now, writeResumeMarker
			// already catches and logs its own errors, so this outer block
			// only protects against unexpected sync throws.
			const raw = err instanceof Error ? err.message : String(err);
			console.warn(`[pi-visual-recap] session_start handler failed: ${sanitizeErrorMessage(raw)}`);
		}
	});
}
