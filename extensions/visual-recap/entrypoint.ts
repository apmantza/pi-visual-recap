// Pi visual recap extension — entrypoint.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	registerVisualRecapCommand,
	registerVisualRecapTool,
} from "./index.ts";

export default function (pi: ExtensionAPI) {
	registerVisualRecapCommand(pi);
	registerVisualRecapTool(pi);
}
