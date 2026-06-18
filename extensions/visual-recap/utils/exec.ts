// Small shell helper. Prefer not to use pi.exec directly here so the
// collector stays easy to test in isolation.
import { spawn } from "node:child_process";

export interface ExecResult {
	exitCode: number;
	stdout: string;
	stderr: string;
	signal?: AbortSignal;
}

export async function exec(
	command: string,
	args: string[],
	options: { cwd?: string; signal?: AbortSignal; maxBuffer?: number } = {},
): Promise<ExecResult> {
	return await new Promise<ExecResult>((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: options.cwd,
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});

		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		const maxBuffer = options.maxBuffer ?? 64 * 1024 * 1024;
		let stdoutLen = 0;
		let stderrLen = 0;
		let killed = false;

		const onAbort = () => {
			killed = true;
			try {
				child.kill();
			} catch {
				// ignore
			}
		};
		options.signal?.addEventListener("abort", onAbort, { once: true });

		child.stdout.on("data", (chunk: Buffer) => {
			stdoutLen += chunk.length;
			if (stdoutLen > maxBuffer) {
				killed = true;
				child.kill();
				reject(new Error(`stdout exceeded maxBuffer (${maxBuffer} bytes)`));
				return;
			}
			stdoutChunks.push(chunk);
		});

		child.stderr.on("data", (chunk: Buffer) => {
			stderrLen += chunk.length;
			if (stderrLen > maxBuffer) {
				killed = true;
				child.kill();
				reject(new Error(`stderr exceeded maxBuffer (${maxBuffer} bytes)`));
				return;
			}
			stderrChunks.push(chunk);
		});

		child.on("error", (err) => {
			options.signal?.removeEventListener("abort", onAbort);
			reject(err);
		});

		child.on("close", (code) => {
			options.signal?.removeEventListener("abort", onAbort);
			if (killed && options.signal?.aborted) {
				const err = new Error(`aborted: ${command} ${args.join(" ")}`);
				err.name = "AbortError";
				reject(err);
				return;
			}
			resolve({
				exitCode: code ?? 0,
				stdout: Buffer.concat(stdoutChunks).toString("utf8"),
				stderr: Buffer.concat(stderrChunks).toString("utf8"),
				signal: options.signal,
			});
		});
	});
}

export async function tryExec(
	command: string,
	args: string[],
	options: { cwd?: string; signal?: AbortSignal } = {},
): Promise<ExecResult | undefined> {
	try {
		return await exec(command, args, options);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") {
			return undefined;
		}
		throw err;
	}
}
