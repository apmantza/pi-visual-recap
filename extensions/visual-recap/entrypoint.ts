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
	// writeResumeMarker handles its own errors and never throws.
	pi.on("session_start", (event) => {
		if (event.reason !== "resume") return;
		if (!event.previousSessionFile) return;
		writeResumeMarker(pi, event.previousSessionFile);
	});
}