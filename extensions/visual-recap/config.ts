// Project config (loaded only when the project is trusted).
import type { VisualRecapOptions } from "./schemas.ts";

export interface VisualRecapConfig {
	outputDir?: string;
	format?: VisualRecapOptions["format"];
	model?: VisualRecapOptions["model"];
	maxDiffBytes?: number;
	openAfterGenerate?: boolean;
	includeEvidence?: boolean;
}

export const DEFAULTS: Required<
	Pick<
		VisualRecapConfig,
		| "outputDir"
		| "format"
		| "maxDiffBytes"
		| "openAfterGenerate"
		| "includeEvidence"
	>
> = {
	outputDir: ".visual-recaps",
	format: "all",
	maxDiffBytes: 750_000,
	openAfterGenerate: false,
	includeEvidence: true,
};

export function mergeConfig(
	fileConfig: VisualRecapConfig | undefined,
	cliOptions: VisualRecapOptions,
): Required<
	Pick<
		VisualRecapConfig,
		| "outputDir"
		| "format"
		| "maxDiffBytes"
		| "openAfterGenerate"
		| "includeEvidence"
	>
> &
	Pick<VisualRecapConfig, "model"> {
	return {
		outputDir:
			cliOptions.outputDir ?? fileConfig?.outputDir ?? DEFAULTS.outputDir,
		format: cliOptions.format ?? fileConfig?.format ?? DEFAULTS.format,
		maxDiffBytes:
			cliOptions.maxDiffBytes ??
			fileConfig?.maxDiffBytes ??
			DEFAULTS.maxDiffBytes,
		openAfterGenerate:
			cliOptions.openAfterGenerate ??
			fileConfig?.openAfterGenerate ??
			DEFAULTS.openAfterGenerate,
		includeEvidence:
			cliOptions.includeEvidence ??
			fileConfig?.includeEvidence ??
			DEFAULTS.includeEvidence,
		model: cliOptions.model ?? fileConfig?.model,
	};
}
