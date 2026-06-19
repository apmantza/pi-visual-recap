// Unit tests for the log sanitizer. Run with `npx vitest run`.
// These guard against regressions in the path-redaction regexes —
// a silent bug here would either leak absolute paths in logs or
// mangle legitimate error messages.

import { describe, expect, it } from "vitest";
import { sanitizeErrorMessage } from "../../extensions/visual-recap/utils/log.ts";

describe("sanitizeErrorMessage", () => {
	it.each([
		["C:\\Users\\me\\file.ts: not found", "<path> not found"],
		[
			"ENOENT: no such file or directory, open '/Users/me/x.json'",
			"ENOENT: no such file or directory, open '<path>'",
		],
		[
			"https://api.example.com/v1/chat failed",
			"https://api.example.com/v1/chat failed",
		],
		[
			"protocol-relative //host.example.com/x should pass",
			"protocol-relative //host.example.com/x should pass",
		],
		[
			"relative path foo/bar.ts should pass",
			"relative path foo/bar.ts should pass",
		],
		["at /home/user/proj/src/foo.ts:42:5", "at <path>"],
		[
			"at Object.<anonymous> (/home/user/proj/src/foo.js:10:5)",
			"at Object.<anonymous> (<path>)",
		],
		[
			"Error: EACCES, scandir '/var/log/pi/'",
			"Error: EACCES, scandir '<path>'",
		],
		["open('/tmp/x').", "open('<path>')."],
		[
			"Error: ENOENT at /Users/me/x: not a directory",
			"Error: ENOENT at <path> not a directory",
		],
		[
			"mixed Windows + Unix: C:\\foo and /bar leak neither",
			"mixed Windows + Unix: <path> and <path> leak neither",
		],
		// Home-relative paths. Tilde must be followed by a `/` (with an
		// optional username prefix) to be considered a path, so a bare
		// tilde in prose like "home directory ~ expansion" passes through.
		["~/.pi/agent/auth.json", "<path>"],
		[
			"~ expansion failed for ~/.pi/agent/auth.json",
			"~ expansion failed for <path>",
		],
		["config at ~/.pi/agent/x: parse error", "config at <path> parse error"],
		["open ~/.bashrc", "open <path>"],
		["'~/.ssh/id_rsa'", "'<path>'"],
		// Tilde user prefix (rare but real: ~alice/foo).
		["~user/.ssh is 700", "<path> is 700"],
		// Standalone tilde in prose should pass through.
		["home directory ~ expansion failed", "home directory ~ expansion failed"],
		// Non-string inputs: must not throw.
		["", ""],
		["no path here", "no path here"],
	])("sanitises %j", (input, expected) => {
		expect(sanitizeErrorMessage(input)).toBe(expected);
	});

	it.each([
		[null as unknown as string, "null"],
		[undefined as unknown as string, "undefined"],
		[123 as unknown as string, "123"],
		[true as unknown as string, "true"],
	])("does not throw on non-string %p", (input, expected) => {
		expect(sanitizeErrorMessage(input)).toBe(expected);
	});
});
