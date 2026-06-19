import { describe, expect, it } from "vitest";
import { redactSecrets } from "../../extensions/visual-recap/utils/secret-redactor.ts";

describe("redactSecrets", () => {
	it("redacts api_key/token/password key/value pairs", () => {
		expect(redactSecrets("api_key=sklive_1234567890abcdef")).toBe(
			"api_key=<redacted>",
		);
		expect(redactSecrets("password=hunter2")).toBe("password=<redacted>");
		expect(redactSecrets("token: abcdef123456")).toBe("token: <redacted>");
	});

	it("redacts Bearer headers and sk- keys", () => {
		expect(redactSecrets("Authorization: Bearer eyJabc.def.ghi")).toBe(
			"Authorization: Bearer <redacted>",
		);
		expect(redactSecrets("sk-abcdefghijklmnopqrstuvwxyz")).toBe(
			"sk-abcdefghijkl<redacted>",
		);
	});

	it("leaves unrelated content untouched", () => {
		expect(redactSecrets("const greeting = 'hello world'")).toBe(
			"const greeting = 'hello world'",
		);
	});
});
