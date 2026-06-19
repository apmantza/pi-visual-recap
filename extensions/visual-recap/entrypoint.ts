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
			// Belt-and-braces: writeResumeMarker already catches and logs,
			// but if a future change in pi.appendEntry makes it async, a
			// floating promise rejection would crash session_start. This
			// outer catch keeps the extension failure-isolated.
			const raw = err instanceof Error ? err.message : String(err);
			console.warn(`[pi-visual-recap] session_start handler failed: ${sanitizeErrorMessage(raw)}`);
		}
	});
}
