// PI-AI model wrapper. Always re-uses the user's active Pi model/auth.
import { complete, type Message } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface RunAiOptions {
	ctx: ExtensionContext;
	modelOverride?: { provider: string; id: string };
	messages: Message[];
	maxTokens?: number;
	signal?: AbortSignal;
}

export interface RunAiResult {
	text: string;
	model: { provider: string; id: string };
}

export async function runAi(options: RunAiOptions): Promise<RunAiResult> {
	const { ctx, modelOverride, messages, maxTokens, signal } = options;

	const model = modelOverride
		? ctx.modelRegistry.find(modelOverride.provider, modelOverride.id)
		: ctx.model;

	if (!model) {
		throw new Error(
			modelOverride
				? `Model ${modelOverride.provider}/${modelOverride.id} not found`
				: "No active Pi model — set one with /model or configure one in settings",
		);
	}

	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok) {
		throw new Error(`Auth error: ${auth.error}`);
	}
	if (!auth.apiKey) {
		throw new Error(
			`No API key for ${model.provider}/${model.id} — set one with /login or environment variable`,
		);
	}

	const response = await complete(
		model,
		{ messages },
		{
			apiKey: auth.apiKey,
			headers: auth.headers,
			...(maxTokens !== undefined ? { maxTokens } : {}),
			...(signal ? { signal } : {}),
		},
	);

	const text = response.content
		.filter(
			(part): part is { type: "text"; text: string } => part.type === "text",
		)
		.map((part) => part.text)
		.join("\n");

	return { text, model: { provider: model.provider, id: model.id } };
}
