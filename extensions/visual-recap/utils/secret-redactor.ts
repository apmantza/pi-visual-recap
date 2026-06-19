// Best-effort secret redactor for tool-arg diff text. Strips credentials that
// appear in key/value or Authorization-style contexts so they do not leak
// into the recap artifact. Heuristic only — callers that need strong
// guarantees should layer their own scrubbing on top.
export function redactSecrets(value: string): string {
	return value
		.replace(
			/((?:api[_-]?key|token|secret|password)\s*[:=]\s*)[^\s'"]+/gi,
			"$1<redacted>",
		)
		.replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1<redacted>")
		.replace(/(sk-[A-Za-z0-9]{12})[A-Za-z0-9]+/g, "$1<redacted>");
}
