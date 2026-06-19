// Helpers for sanitizing error messages before logging. Shared between
// resume-marker and the session_start handler so the path-stripping
// behaviour stays consistent.

/** Matches Windows drive-letter paths (C:\foo\bar). */
const WINDOWS_PATH = /[A-Za-z]:\\[^\s)]+/g;
/**
 * Matches Unix absolute paths but only when they look like filesystem
 * paths — i.e. the leading `/` is preceded by start-of-string, whitespace,
 * or an opening bracket/quote. This avoids mangling relative paths like
 * "foo/bar.ts" or embedded slashes inside a word. Path characters are
 * conservative: letters, digits, and the common path punctuation
 * (`_.-@~+`). The regex stops at any character that usually delimits
 * a path in an error message (whitespace, quotes, brackets, parens,
 * backticks).
 */
const UNIX_PATH = /(?:^|[\s(>'"`])\/[A-Za-z0-9_.@~+-][^\s'"`)]*/g;

/**
 * Matches home-relative paths (e.g. `~/foo`, `~user/.ssh`) that don't
 * start with a `/`. Same character class and stop conditions as
 * `UNIX_PATH`. The `~` may be followed by a username, then a slash, then
 * the rest of the path.
 */
const TILDE_PATH = /(?:^|[\s(>'"`])~[A-Za-z0-9_.-]*(?:\/[^\s'"`)]*)?/g;

export function sanitizeErrorMessage(message: string): string {
	if (typeof message !== "string") return String(message);
	return (
		message
			// Windows first (C:\...) — never want to leak.
			.replace(WINDOWS_PATH, "<path>")
			// Unix absolute paths (start with `/`).
			.replace(UNIX_PATH, (match) => {
				const leading = match.match(/^[\s(>'"`]/) ? match[0] : "";
				return `${leading}<path>`;
			})
			// Home-relative paths (start with `~`).
			.replace(TILDE_PATH, (match) => {
				const leading = match.match(/^[\s(>'"`]/) ? match[0] : "";
				return `${leading}<path>`;
			})
	);
}
