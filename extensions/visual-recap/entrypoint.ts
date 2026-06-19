// Pi visual recap extension — entrypoint.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	registerVisualRecapCommand,
	registerVisualRecapTool,
} from "./index.ts";
import { writeResumeMarker } from "./resume-marker.ts";

export default function (pi: ExtensionAPI) {
	registerVisualRecapCommand(pi);
	registerVisualRecapTool(pi);

	// On /resume (not on /new), record a tiny marker so a later
	// `/visual-recap session current` can split pre-resume vs post-resume.
	// No recap is auto-generated — the user must still type /visual-recap.
	// writeResumeMarker is best-effort, but we wrap the call too so any
	// unexpected future async change in pi.appendEntry can't crash session_start.
	pi.on("session_start", (event) => {
		try {
			if (event.reason !== "resume") return;
			if (!event.previousSessionFile) return;
			writeResumeMarker(pi, event.previousSessionFile);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			const safe = message.replace(/[A-Za-z]:\\[^\s)]+/g, "<path>").replace(/\/[^\s)]+/g, (m) => (m.startsWith("//") ? m : "<path>"));
			console.warn(`[pi-visual-recap] session_start handler failed: ${safe}`);
		}
	});
}
