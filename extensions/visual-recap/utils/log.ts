// Helpers for sanitising error messages before logging. Shared between
// resume-marker and the session_start handler so the path-stripping
// behaviour stays consistent.

/** Matches Windows drive-letter paths (C:\...) — high signal, replace. */
const WINDOWS_PATH = /[A-Za-z]:\\[^\s)]+/g;
/** Matches Unix absolute paths (/foo/bar) but preserves protocol-relative URLs (//host). */
const UNIX_PATH = /(?<!\/)\/[^\s)]+/g;

export function sanitizeErrorMessage(message: string): string {
	return message
		.replace(WINDOWS_PATH, "<path>")
		.replace(UNIX_PATH, (m) => (m.startsWith("//") ? m : "<path>"));
}
