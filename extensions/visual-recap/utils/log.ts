// Helpers for sanitising error messages before logging. Shared between
// resume-marker and the session_start handler so the path-stripping
// behaviour stays consistent.

/** Matches Windows drive-letter paths (C:\foo\bar). */
const WINDOWS_PATH = /[A-Za-z]:\\[^\s)]+/g;
/**
 * Matches Unix absolute paths but only when they look like filesystem
 * paths — i.e. the leading `/` is preceded by start-of-string, whitespace,
 * or an opening bracket/quote. This avoids mangling relative paths like
 * "foo/bar.ts" or embedded slashes inside a word.
 */
const UNIX_PATH = /(?:^|[\s(>'"`])\/[A-Za-z0-9_.-][^\s'"`)]*/g;

export function sanitizeErrorMessage(message: string): string {
	return (
		message
			// Windows first (C:\...) — never want to leak.
			.replace(WINDOWS_PATH, "<path>")
			// Unix absolute paths only.
			.replace(UNIX_PATH, (match) => {
				// Preserve the leading separator character (whitespace, `(`, etc.)
				// and only replace the path body.
				const leading = match.match(/^[\s(>'"`]/) ? match[0] : "";
				return `${leading}<path>`;
			})
	);
}
