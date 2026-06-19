// Helpers for sanitizing error messages before logging. Shared between
// resume-marker and the session_start handler so the path-stripping
// behaviour stays consistent.

/** Shared log prefix for the extension. */
export const LOG_PREFIX = "[pi-visual-recap]";

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
 * Matches home-relative paths (`~/foo`, `~user/.ssh`) that don't start
 * with a leading `/`. We require a `/` after the tilde to avoid
 * matching standalone tildes used in prose (e.g. "home directory ~
 * expansion failed"). Same stop conditions as `UNIX_PATH`.
 */
const TILDE_PATH = /(?:^|[\s(>'"`])~[A-Za-z0-9_.-]*\/[^\s'"`)]*/g;

/**
 * Shared replacement for the UNIX and TILDE regexes. Both match a
 * leading context character (whitespace, bracket, quote, or backtick)
 * which we want to preserve, with the path body itself replaced by
 * `<path>`. The callback handles both the captured leading character
 * case and a bare match (no leading context char) uniformly.
 */
function redactPath(match: string): string {
	const leading = match.match(/^[\s(>'"`]/) ? match[0] : "";
	return `${leading}<path>`;
}

export function sanitizeErrorMessage(message: string): string {
	if (typeof message !== "string") return String(message);
	return (
		message
			// Windows first (C:\...) — never want to leak.
			.replace(WINDOWS_PATH, "<path>")
			// Unix absolute paths (start with `/`).
			.replace(UNIX_PATH, redactPath)
			// Home-relative paths (start with `~`).
			.replace(TILDE_PATH, redactPath)
	);
}
