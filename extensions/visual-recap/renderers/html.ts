// Render a RecapDocument as a polished, self-contained HTML review artifact.
import type {
	FileMapEntry,
	KeyChange,
	RecapDocument,
	RecapSection,
	ReviewRisk,
	SessionTimelineItem,
	SessionUsageSummary,
} from "../schemas.ts";

export function renderHtml(doc: RecapDocument): string {
	doc = {
		...doc,
		title: doc.title ?? "Visual recap",
		brief: doc.brief ?? "Review-ready recap of the selected target.",
		target: doc.target ?? "unknown target",
		generatedAt: doc.generatedAt ?? new Date().toISOString(),
		source: doc.source ?? "git",
		sections: doc.sections ?? [],
		fileMap: doc.fileMap ?? [],
		keyChanges: doc.keyChanges ?? [],
		risks: doc.risks ?? [],
		followUps: doc.followUps ?? [],
	};
	const stats = summarize(doc);
	const sections = [
		renderHero(doc, stats),
		renderSectionNav(doc),
		...doc.sections.map((section, index) => renderSection(section, index)),
		renderKeyChanges(doc.keyChanges),
		renderFollowUps(doc.followUps),
	].filter(Boolean);
	const json = JSON.stringify(doc, null, 2)
		.replace(/</g, "\\u003c")
		.replace(/>/g, "\\u003e")
		.replace(/&/g, "\\u0026");

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline' https://cdn.jsdelivr.net; connect-src https://cdn.jsdelivr.net; base-uri 'none'; form-action 'none'; object-src 'none'" />
<title>${escape(doc.title)} — Visual Recap</title>
<style>
  :root {
    color-scheme: light;
    --font-body: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, "Inter", "Helvetica Neue", Arial, sans-serif;
    --font-display: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, "Inter", "Helvetica Neue", Arial, sans-serif;
    --font-mono: ui-monospace, "SF Mono", "Cascadia Code", Menlo, Consolas, monospace;
    --bg: #ffffff;
    --bg-soft: #f8f9fa;
    --panel: #ffffff;
    --panel-strong: #ffffff;
    --panel-recessed: #f4f5f7;
    --fg: #0f172a;
    --muted: #64748b;
    --subtle: #94a3b8;
    --line: #e2e8f0;
    --line-strong: #cbd5e1;
    --accent: #2563eb;
    --accent-soft: #dbeafe;
    --accent-2: #059669;
    --accent-2-soft: #d1fae5;
    --accent-3: #7c3aed;
    --accent-3-soft: #ede9fe;
    --ok: #059669;
    --warn: #d97706;
    --danger: #dc2626;
    --shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    --radius: 10px;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      color-scheme: dark;
      --bg: #0a0a0b; --bg-soft: #111114; --panel: #16161a; --panel-strong: #1a1a1f; --panel-recessed: #1f1f25;
      --fg: #f1f5f9; --muted: #94a3b8; --subtle: #64748b; --line: #26262c; --line-strong: #36363d;
      --accent: #60a5fa; --accent-soft: rgba(96, 165, 250, 0.13); --accent-2: #34d399; --accent-2-soft: rgba(52, 211, 153, 0.13);
      --accent-3: #a78bfa; --accent-3-soft: rgba(167, 139, 250, 0.13); --ok: #34d399; --warn: #fbbf24; --danger: #f87171;
      --shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
    }
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    margin: 0;
    min-height: 100vh;
    background: var(--bg);
    color: var(--fg);
    font-family: var(--font-body);
    line-height: 1.55;
  }
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
  }
  a { color: inherit; }
  code, pre { font-family: var(--font-mono); }
  .shell { width: min(1180px, calc(100% - 32px)); margin: 0 auto; padding: 40px 0 84px; }
  .hero {
    position: relative;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 28px;
    padding: clamp(30px, 5vw, 58px);
    box-shadow: var(--shadow);
    background:
      linear-gradient(135deg, var(--accent-soft), transparent 42%),
      linear-gradient(180deg, var(--panel-strong), var(--panel));
    animation: fadeUp 0.42s ease-out both;
  }
  .hero::after {
    content: "";
    position: absolute; inset: auto -14% -55% 38%; height: 360px;
    background: radial-gradient(circle, var(--accent-3-soft), transparent 62%);
    pointer-events: none;
  }
  .eyebrow { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 20px; color: var(--muted); font-size: 0.86rem; }
  .pill { display: inline-flex; align-items: center; gap: 7px; border: 1px solid var(--line); border-radius: 999px; padding: 6px 11px; background: var(--panel-recessed); backdrop-filter: blur(10px); }
  .spark { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 4px var(--accent-soft); }
  h1 { max-width: 920px; margin: 0; font-family: var(--font-display); font-weight: 650; letter-spacing: -0.045em; font-size: clamp(2.45rem, 7vw, 5.6rem); line-height: 0.95; text-wrap: balance; }
  .brief { max-width: 850px; margin: 24px 0 0; color: var(--muted); font-size: clamp(1.02rem, 2vw, 1.28rem); }
  .stats { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; margin-top: 32px; }
  .stat { border: 1px solid var(--line); border-radius: 16px; padding: 16px; background: var(--panel-recessed); animation: fadeUp 0.42s ease-out both; }
  .stat strong { display: block; font-size: clamp(1.35rem, 3vw, 2.05rem); letter-spacing: -0.04em; }
  .stat span { display: block; color: var(--muted); font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.08em; }
  .nav { position: sticky; top: 12px; z-index: 2; display: flex; flex-wrap: wrap; gap: 8px; margin: 18px 0 24px; padding: 10px; border: 1px solid var(--line); border-radius: 999px; background: color-mix(in srgb, var(--panel-strong) 88%, transparent); backdrop-filter: blur(18px); box-shadow: 0 12px 34px rgba(69,45,25,0.10); }
  .nav a { text-decoration: none; color: var(--muted); border-radius: 999px; padding: 8px 12px; font-size: 0.88rem; }
  .nav a:hover { color: var(--fg); background: var(--accent-soft); }
  .section-card { margin: 24px 0; border: 1px solid var(--line); border-radius: var(--radius); background: var(--panel); box-shadow: 0 16px 44px rgba(69,45,25,0.10); overflow: hidden; animation: fadeUp 0.42s ease-out both; }
  .section-head { display: flex; justify-content: space-between; gap: 18px; align-items: flex-end; padding: 22px 24px 0; }
  .section-kicker { color: var(--accent-3); font-size: 0.76rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.12em; }
  h2 { margin: 4px 0 0; font-family: var(--font-display); font-size: clamp(1.45rem, 2.4vw, 2.15rem); letter-spacing: -0.025em; }
  h3 { margin: 0; font-size: 1.05rem; }
  .section-body { padding: 20px 24px 24px; }
  .prose { color: var(--muted); font-size: 1rem; }
  .prose p { margin: 0 0 1em; }
  .prose p:last-child { margin-bottom: 0; }
  .prose ul { margin: 0.6em 0 0.6em 1.2em; padding: 0; }
  .prose code { color: var(--fg); background: var(--panel-recessed); border: 1px solid var(--line); border-radius: 7px; padding: 0.08rem 0.34rem; }
  .diagram { display: grid; gap: 16px; }
  .diagram-grid { display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: 16px; }
  .diagram-shell { min-height: 420px; border: 1px solid var(--line); border-radius: 18px; background: var(--panel-recessed); overflow: hidden; }
  .diagram-toolbar { display: flex; justify-content: space-between; gap: 10px; align-items: center; padding: 10px 12px; border-bottom: 1px solid var(--line); color: var(--muted); font-size: 0.82rem; }
  .diagram-title { margin: 0; font-family: var(--font-body); font-size: 0.82rem; font-weight: 700; color: var(--muted); }
  .zoom-controls { display: flex; flex-wrap: wrap; gap: 6px; }
  .zoom-controls button { border: 1px solid var(--line); color: var(--fg); background: var(--panel); border-radius: 10px; padding: 7px 10px; cursor: pointer; }
  .zoom-controls button:hover { border-color: var(--accent); }
  .mermaid-viewport { min-height: 366px; overflow: hidden; cursor: grab; display: grid; place-items: center; }
  .mermaid-viewport:active { cursor: grabbing; }
  .mermaid-canvas { transform-origin: 50% 50%; transition: transform 120ms ease; padding: 26px; }
  .mermaid-canvas svg { max-width: none; height: auto; display: block; }
  .mermaid-canvas svg text, .mermaid-canvas svg .label, .mermaid-canvas svg .label span { fill: var(--fg) !important; color: var(--fg) !important; }
  .mermaid-canvas svg .node rect, .mermaid-canvas svg .node polygon, .mermaid-canvas svg .node circle, .mermaid-canvas svg .node ellipse { fill: var(--panel-strong) !important; stroke: var(--line-strong) !important; }
  .mermaid-canvas svg .edgePath path, .mermaid-canvas svg path.flowchart-link { stroke: var(--accent) !important; }
  .diagram-fallback { padding: 16px; }
  noscript .diagram-source { margin: 12px; }
  .diagram-source { max-height: 260px; }
  .diagram-pre, .json-pre { margin: 0; padding: 18px; overflow: auto; border: 1px solid var(--line); border-radius: 18px; background: var(--panel-recessed); color: var(--fg); font-size: 0.86rem; }
  .mini-panel { border: 1px solid var(--line); border-radius: 18px; background: var(--panel-recessed); padding: 16px; color: var(--muted); }
  .copy { border: 1px solid var(--line-strong); color: var(--fg); background: var(--panel); border-radius: 12px; padding: 9px 12px; cursor: pointer; }
  .copy:hover { border-color: var(--accent); }
  .file-toolbar { display: flex; gap: 12px; align-items: center; justify-content: space-between; margin-bottom: 12px; }
  .file-tabs { display: flex; flex-wrap: wrap; gap: 0; border: 1px solid var(--line); border-radius: 10px 10px 0 0; border-bottom: 0; background: var(--panel-recessed); overflow: hidden; }
  .file-tab { display: flex; align-items: center; gap: 8px; padding: 9px 14px; border: 0; border-right: 1px solid var(--line); background: transparent; color: var(--muted); font-family: var(--font-mono); font-size: 0.78rem; cursor: pointer; white-space: nowrap; }
  .file-tab:hover { background: var(--panel); color: var(--fg); }
  .file-tab.active { background: var(--panel); color: var(--fg); border-bottom: 2px solid var(--accent); margin-bottom: -1px; }
  .file-tab-path { overflow: hidden; text-overflow: ellipsis; max-width: 360px; }
  .file-tab-meta { display: inline-flex; align-items: center; gap: 6px; }
  .file-tab-delta { font-family: var(--font-mono); font-size: 0.72rem; display: inline-flex; gap: 4px; }
  .file-tab-delta .add { color: var(--ok); }
  .file-tab-delta .del { color: var(--danger); }
  .file-tab-panels { border: 1px solid var(--line); border-radius: 0 0 10px 10px; background: var(--panel); overflow: hidden; }
  .file-diff-panel { display: none; }
  .file-diff-panel.active { display: block; }
  .file-diff-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px; border-bottom: 1px solid var(--line); background: var(--panel-recessed); }
  .file-diff-path { display: inline-flex; align-items: center; gap: 8px; font-family: var(--font-mono); font-size: 0.8rem; color: var(--fg); }
  .file-diff-stats { display: inline-flex; gap: 8px; font-family: var(--font-mono); font-size: 0.75rem; }
  .file-diff-stats .add { color: var(--ok); }
  .file-diff-stats .del { color: var(--danger); }
  .diff-pre { max-height: 520px; margin: 0; padding: 14px; overflow: auto; background: var(--bg-soft); color: var(--fg); font-size: 0.78rem; line-height: 1.55; white-space: pre; }
  .other-files { margin-top: 18px; }
  .other-files h3 { margin-bottom: 10px; }
  .search { width: min(360px, 100%); border: 1px solid var(--line); border-radius: 10px; background: var(--panel-recessed); color: var(--fg); padding: 9px 12px; outline: none; }
  .file-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(270px, 1fr)); gap: 10px; }
  .file-card { position: relative; min-height: 120px; border: 1px solid var(--line); border-radius: 10px; padding: 14px; background: var(--panel); transition: border-color 160ms ease; }
  .file-card:hover { border-color: var(--line-strong); }
  .file-card[data-hidden="true"] { display: none; }
  .file-top { display: flex; gap: 10px; align-items: flex-start; justify-content: space-between; }
  .path { word-break: break-word; color: var(--fg); font-size: 0.9rem; font-family: var(--font-mono); }
  .note { margin-top: 8px; color: var(--muted); font-size: 0.85rem; }
  .delta { display: flex; align-items: center; gap: 10px; margin-top: 12px; color: var(--muted); font-size: 0.85rem; }
  .bar { flex: 1; height: 6px; overflow: hidden; border-radius: 999px; background: var(--panel-recessed); display: flex; }
  .bar-add { background: var(--ok); }
  .bar-del { background: var(--danger); }
  .badge { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; min-width: 32px; height: 22px; padding: 0 8px; border-radius: 999px; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.03em; border: 1px solid transparent; }
  .badge-added { color: var(--ok); background: var(--accent-2-soft); border-color: color-mix(in srgb, var(--ok) 30%, transparent); }
  .badge-modified { color: var(--warn); background: color-mix(in srgb, var(--warn) 12%, transparent); border-color: color-mix(in srgb, var(--warn) 30%, transparent); }
  .badge-deleted { color: var(--danger); background: color-mix(in srgb, var(--danger) 12%, transparent); border-color: color-mix(in srgb, var(--danger) 30%, transparent); }
  .badge-renamed, .badge-copied { color: var(--accent-3); background: var(--accent-3-soft); border-color: color-mix(in srgb, var(--accent-3) 30%, transparent); }
  .badge-touched, .badge-read, .badge-unknown { color: var(--muted); background: var(--panel-recessed); border-color: var(--line); }
  .risk-grid, .change-grid { display: grid; gap: 10px; }
  .risk { border: 1px solid var(--line); border-left-width: 4px; border-radius: 8px; padding: 12px 14px; background: var(--panel-recessed); }
  .risk-high { border-left-color: var(--danger); }
  .risk-medium { border-left-color: var(--warn); }
  .risk-low { border-left-color: var(--ok); }
  .risk-info { border-left-color: var(--accent); }
  .risk p, .change p { margin: 6px 0 0; color: var(--muted); }
  .change { border: 1px solid var(--line); border-radius: 10px; background: var(--panel-recessed); overflow: hidden; }
  .change-main { padding: 14px; }
  .change-path { color: var(--accent); font-weight: 700; word-break: break-word; font-family: var(--font-mono); }
  .annotations { margin: 10px 0 0; padding: 0; list-style: none; display: grid; gap: 6px; }
  .annotations li { display: grid; grid-template-columns: auto 1fr; gap: 8px; align-items: start; color: var(--muted); }
  .line-range { color: var(--accent-3); border: 1px solid var(--line); border-radius: 999px; padding: 1px 6px; font-size: 0.72rem; }
  .timeline { position: relative; display: grid; gap: 8px; }
  .timeline-item { display: grid; grid-template-columns: 84px 1fr; gap: 12px; align-items: start; }
  .timeline-role { color: var(--accent); font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; padding-top: 4px; }
  .timeline-body { border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; background: var(--panel-recessed); }
  .timeline-body p { margin: 4px 0 0; color: var(--muted); }
  .usage-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; margin-bottom: 14px; }
  .usage-card { border: 1px solid var(--line); border-radius: 8px; background: var(--panel-recessed); padding: 12px 14px; }
  .usage-card strong { display: block; font-size: 1.3rem; letter-spacing: -0.02em; }
  .usage-card span { color: var(--muted); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em; }
  .tool-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; }
  .tool-list li { display: grid; grid-template-columns: 1fr auto; gap: 10px; border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; background: var(--panel-recessed); color: var(--muted); }
  .tool-list code { color: var(--fg); overflow-wrap: anywhere; font-size: 0.85rem; }
  .followups { margin: 0; padding: 0; list-style: none; display: grid; gap: 8px; }
  .followups li { border: 1px solid var(--line); border-radius: 8px; padding: 10px 14px 10px 38px; background: var(--panel-recessed); position: relative; color: var(--muted); }
  .followups li::before { content: "□"; position: absolute; left: 14px; color: var(--accent); }
  details.raw { margin-top: 24px; border: 1px solid var(--line); border-radius: 10px; background: var(--panel); }
  details.raw summary { cursor: pointer; padding: 12px 16px; color: var(--muted); }
  details.raw .json-pre { border: 0; border-top: 1px solid var(--line); border-radius: 0 0 10px 10px; }
  .footer { margin-top: 24px; color: var(--subtle); font-size: 0.82rem; text-align: center; }
  @media (max-width: 850px) {
    .shell { width: min(100% - 20px, 1180px); padding-top: 10px; }
    .hero { border-radius: 10px; }
    .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .nav { position: static; }
    .diagram-grid { grid-template-columns: 1fr; }
    .timeline-item { grid-template-columns: 1fr; gap: 4px; }
    .file-tab-path { max-width: 200px; }
  }
</style>
</head>
<body>
<main class="shell">
${sections.join("\n")}
<details class="raw"><summary>Raw recap data</summary><pre class="json-pre">${escape(json)}</pre></details>
<p class="footer">Generated locally by <code>pi-visual-recap</code>. The Markdown, JSON, MDX, HTML, and evidence files stay in this artifact directory.</p>
</main>
<script>
(() => {
  const MERMAID_URL = 'https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js';
  const MERMAID_INTEGRITY = 'sha384-WmdflGW9aGfoBdHc4rRyWzYuAjEmDwMdGdiPNacbwfGKxBW/SO6guzuQ76qjnSlr';
  const MERMAID_TIMEOUT_MS = 8000;

  for (const button of document.querySelectorAll('[data-copy-target]')) {
    button.addEventListener('click', async () => {
      const target = document.getElementById(button.getAttribute('data-copy-target'));
      if (!target) {
        button.textContent = 'Copy target missing';
        return;
      }
      try {
        await navigator.clipboard.writeText(target.textContent || '');
        const old = button.textContent;
        button.textContent = 'Copied';
        setTimeout(() => { button.textContent = old; }, 1200);
      } catch (err) {
        console.warn('Copy failed', err);
        const old = button.textContent;
        button.textContent = 'Select text to copy';
        setTimeout(() => { button.textContent = old; }, 1600);
      }
    });
  }

  const shells = Array.from(document.querySelectorAll('[data-mermaid-shell]'));
  if (shells.length > 0) {
    loadMermaid()
      .then(renderMermaidDiagrams)
      .catch(() => showMermaidSources('Mermaid could not load. Showing source instead.'));
  }

  function loadMermaid() {
    if (window.mermaid) return Promise.resolve(window.mermaid);
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timeout = window.setTimeout(() => reject(new Error('Mermaid load timed out')), MERMAID_TIMEOUT_MS);
      script.src = MERMAID_URL;
      script.async = true;
      script.integrity = MERMAID_INTEGRITY;
      script.crossOrigin = 'anonymous';
      script.onload = () => {
        window.clearTimeout(timeout);
        window.mermaid ? resolve(window.mermaid) : reject(new Error('Mermaid unavailable'));
      };
      script.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error('Mermaid failed to load'));
      };
      document.head.appendChild(script);
    });
  }

  async function renderMermaidDiagrams() {
    const styles = getComputedStyle(document.documentElement);
    window.mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      themeVariables: {
        background: css(styles, '--panel-recessed'),
        primaryColor: css(styles, '--panel-strong'),
        primaryTextColor: css(styles, '--fg'),
        primaryBorderColor: css(styles, '--line-strong'),
        lineColor: css(styles, '--accent'),
        secondaryColor: css(styles, '--accent-soft'),
        tertiaryColor: css(styles, '--accent-3-soft'),
        fontFamily: css(styles, '--font-body'),
        fontSize: '17px'
      }
    });

    for (const shell of shells) {
      const source = shell.querySelector('[data-mermaid-source]');
      const canvas = shell.querySelector('[data-mermaid-canvas]');
      if (!source || !canvas) continue;
      const renderId = 'mermaid-' + Math.random().toString(36).slice(2);
      try {
        const result = await window.mermaid.render(renderId, source.textContent || '');
        canvas.innerHTML = sanitizeSvg(result.svg);
        setupDiagramControls(shell);
      } catch (err) {
        showSource(shell, 'Mermaid render failed. Showing source instead.');
      }
    }
  }

  function setupDiagramControls(shell) {
    const viewport = shell.querySelector('[data-mermaid-viewport]');
    const canvas = shell.querySelector('[data-mermaid-canvas]');
    if (!viewport || !canvas) return;
    const state = { zoom: 1, x: 0, y: 0, dragging: false, startX: 0, startY: 0 };
    const apply = () => {
      canvas.style.transform = 'translate(' + state.x + 'px, ' + state.y + 'px) scale(' + state.zoom + ')';
    };

    shell.addEventListener('click', (event) => {
      const button = event.target.closest('[data-zoom]');
      if (!button) return;
      const action = button.getAttribute('data-zoom');
      if (action === 'in') state.zoom = Math.min(3, state.zoom + 0.18);
      if (action === 'out') state.zoom = Math.max(0.35, state.zoom - 0.18);
      if (action === 'reset') { state.zoom = 1; state.x = 0; state.y = 0; }
      if (action === 'expand' && !openDiagramSvg(canvas)) {
        const old = button.textContent;
        button.textContent = 'Popup blocked';
        setTimeout(() => { button.textContent = old; }, 1600);
      }
      apply();
    });

    viewport.addEventListener('pointerdown', (event) => {
      state.dragging = true;
      state.startX = event.clientX - state.x;
      state.startY = event.clientY - state.y;
      viewport.setPointerCapture(event.pointerId);
    });
    viewport.addEventListener('pointermove', (event) => {
      if (!state.dragging) return;
      state.x = event.clientX - state.startX;
      state.y = event.clientY - state.startY;
      apply();
    });
    viewport.addEventListener('pointerup', () => { state.dragging = false; });
    viewport.addEventListener('pointercancel', () => { state.dragging = false; });
    viewport.addEventListener('wheel', (event) => {
      event.preventDefault();
      const delta = event.deltaY > 0 ? -0.12 : 0.12;
      state.zoom = Math.min(3, Math.max(0.35, state.zoom + delta));
      apply();
    }, { passive: false });
    apply();
  }

  function openDiagramSvg(canvas) {
    const svg = canvas.querySelector('svg');
    if (!svg) return false;
    const blob = new Blob([sanitizeSvg(svg.outerHTML)], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank', 'noopener,noreferrer');
    if (!win) {
      URL.revokeObjectURL(url);
      return false;
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    return true;
  }

  function showMermaidSources(message) {
    for (const shell of shells) showSource(shell, message);
  }

  function showSource(shell, message) {
    const source = shell.querySelector('[data-mermaid-source]');
    const canvas = shell.querySelector('[data-mermaid-canvas]');
    if (!source || !canvas) return;
    canvas.innerHTML = '<div class="diagram-fallback"><p>' + escapeHtml(message) + '</p><pre class="diagram-pre">' + escapeHtml(source.textContent || '') + '</pre></div>';
    source.hidden = true;
  }

  function sanitizeSvg(svg) {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const blocked = 'script, foreignObject, iframe, object, embed, link, style, image, audio, video, animate, animateMotion, animateTransform, set';
    for (const node of Array.from(doc.querySelectorAll(blocked))) {
      node.remove();
    }
    for (const element of Array.from(doc.querySelectorAll('*'))) {
      for (const attr of Array.from(element.attributes)) {
        const name = attr.name.toLowerCase();
        const value = attr.value.trim().toLowerCase();
        const isHref = name === 'href' || name === 'xlink:href';
        if (
          name.startsWith('on') ||
          name === 'style' ||
          value.includes('javascript:') ||
          value.includes('data:text/html') ||
          (isHref && !value.startsWith('#'))
        ) {
          element.removeAttribute(attr.name);
        }
      }
    }
    return new XMLSerializer().serializeToString(doc.documentElement);
  }

  function css(styles, name) {
    return styles.getPropertyValue(name).trim();
  }

  // File-tab switching: clicking or arrowing through a tablist reveals the
  // selected panel and hides the others in the same group. WAI-ARIA tablist
  // semantics: Arrow keys move focus, Home/End jump to the ends, and the
  // focused tab is the active one (roving tabindex).
  function selectTab(group, target) {
    let didActivate = false;
    for (const sibling of document.querySelectorAll('.file-tab[data-group="' + group + '"]')) {
      const isActive = sibling.getAttribute('data-target') === target;
      sibling.classList.toggle('active', isActive);
      sibling.setAttribute('aria-selected', isActive ? 'true' : 'false');
      sibling.setAttribute('tabindex', isActive ? '0' : '-1');
      if (isActive) didActivate = true;
    }
    for (const panel of document.querySelectorAll('.file-diff-panel[data-group="' + group + '"]')) {
      const isActive = panel.id === target;
      panel.classList.toggle('active', isActive);
      panel.setAttribute('aria-hidden', isActive ? 'false' : 'true');
    }
    if (!didActivate) {
      console.warn('Visual recap: tab target panel missing for', target);
    }
  }

  function focusTab(tab, offset) {
    const group = tab.getAttribute('data-group');
    if (!group) return;
    const tabs = Array.from(
      document.querySelectorAll('.file-tab[data-group="' + group + '"]'),
    );
    if (tabs.length === 0) return;
    const currentIndex = tabs.indexOf(tab);
    const nextIndex = (currentIndex + offset + tabs.length) % tabs.length;
    const next = tabs[nextIndex];
    selectTab(group, next.getAttribute('data-target'));
    next.focus();
  }

  for (const tab of document.querySelectorAll('[data-group][data-target]')) {
    tab.addEventListener('click', () => {
      const group = tab.getAttribute('data-group');
      const target = tab.getAttribute('data-target');
      if (!group || !target) return;
      selectTab(group, target);
    });
    tab.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault();
        focusTab(tab, 1);
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault();
        focusTab(tab, -1);
      } else if (event.key === 'Home') {
        event.preventDefault();
        focusTab(tab, -tabs.length);
      } else if (event.key === 'End') {
        event.preventDefault();
        focusTab(tab, tabs.length - 1);
      }
    });
  }
})();
</script>
</body>
</html>
`;
}

interface RecapStats {
	additions: number;
	deletions: number;
	files: number;
	keyChanges: number;
	risks: number;
}

function summarize(doc: RecapDocument): RecapStats {
	const totals = doc.fileMap.reduce(
		(acc, file) => ({
			additions: acc.additions + file.additions,
			deletions: acc.deletions + file.deletions,
		}),
		{ additions: 0, deletions: 0 },
	);
	return {
		...totals,
		files: doc.fileMap.length,
		keyChanges: doc.keyChanges.length,
		risks: doc.risks.length,
	};
}

function renderHero(doc: RecapDocument, stats: RecapStats): string {
	const model = doc.model
		? `${doc.model.provider}/${doc.model.id}`
		: "model unavailable";
	return `<header class="hero" id="overview">
  <div class="eyebrow">
    <span class="pill"><span class="spark"></span>Visual recap</span>
    <span class="pill">${escape(sourceLabel(doc.source))}</span>
    <span class="pill"><code>${escape(doc.target)}</code></span>
    <span class="pill">${escape(formatDate(doc.generatedAt))}</span>
    <span class="pill">${escape(model)}</span>
  </div>
  <h1>${escape(doc.title)}</h1>
  <p class="brief">${escape(doc.brief)}</p>
  <div class="stats" aria-label="Recap statistics">
    ${renderStat(String(stats.files), "Files mapped")}
    ${renderStat(`+${stats.additions}`, "Additions")}
    ${renderStat(`−${stats.deletions}`, "Deletions")}
    ${renderStat(String(stats.keyChanges), "Key changes")}
    ${renderStat(String(stats.risks), "Review notes")}
  </div>
</header>`;
}

function renderStat(value: string, label: string): string {
	return `<div class="stat"><strong>${escape(value)}</strong><span>${escape(label)}</span></div>`;
}

type NavLink = readonly [href: string, label: string];

function renderSectionNav(doc: RecapDocument): string {
	const sectionLinks = doc.sections
		.map((section, index): NavLink | undefined =>
			sectionHasContent(section)
				? [`#section-${index}`, sectionTitle(section)]
				: undefined,
		)
		.filter((link): link is NavLink => Boolean(link));
	const links = [
		["#overview", "Overview"] as const,
		...sectionLinks,
		doc.keyChanges.length > 0
			? (["#key-changes", "Key changes"] as const)
			: undefined,
		doc.followUps.length > 0
			? (["#follow-ups", "Follow-ups"] as const)
			: undefined,
	].filter((link): link is NavLink => Boolean(link));
	return `<nav class="nav" aria-label="Recap sections">${links
		.map(([href, label]) => `<a href="${href}">${escape(label)}</a>`)
		.join("")}</nav>`;
}

function renderSection(section: RecapSection, index: number): string {
	switch (section.type) {
		case "outcome":
			return renderCard(
				index,
				"Outcome",
				"Summary",
				markdownToHtml(section.markdown),
			);
		case "diagram":
			return renderCard(
				index,
				"Architecture",
				section.title,
				renderDiagram(section.mermaid, section.summary, index),
			);
		case "session-usage":
			return renderCard(
				index,
				"Session",
				"Tool and token usage",
				renderSessionUsage(section.usage),
			);
		case "file-tree":
			return renderCard(
				index,
				"Footprint",
				section.title ?? "Changed files",
				renderFileGallery(section.entries),
			);
		case "session-timeline":
			return renderCard(
				index,
				"Session",
				"Timeline",
				renderTimeline(section.items),
			);
		case "review-notes":
			if (section.risks.length === 0) return "";
			return renderCard(
				index,
				"Review",
				"Review notes",
				renderRisks(section.risks),
			);
		default: {
			const _exhaustive: never = section;
			throw new Error(`Unsupported recap section: ${String(_exhaustive)}`);
		}
	}
}

function sectionHasContent(section: RecapSection): boolean {
	switch (section.type) {
		case "outcome":
			return section.markdown.trim().length > 0;
		case "diagram":
			return section.mermaid.trim().length > 0;
		case "session-usage":
			return section.usage.totalToolCalls > 0 || section.usage.userPrompts > 0;
		case "file-tree":
			return section.entries.length > 0;
		case "session-timeline":
			return section.items.length > 0;
		case "review-notes":
			return section.risks.length > 0;
		default: {
			const _exhaustive: never = section;
			throw new Error(`Unsupported recap section: ${String(_exhaustive)}`);
		}
	}
}

function renderCard(
	index: number,
	kicker: string,
	title: string,
	body: string,
): string {
	return `<section class="section-card" id="section-${index}">
  <div class="section-head"><div><div class="section-kicker">${escape(kicker)}</div><h2>${escape(title)}</h2></div></div>
  <div class="section-body">${body}</div>
</section>`;
}

function renderDiagram(
	mermaid: string,
	summary: string | undefined,
	index: number,
): string {
	const id = `diagram-${index}`;
	const sourceId = `${id}-source`;
	return `<div class="diagram-grid">
  <div class="diagram-shell" data-mermaid-shell="${id}">
    <div class="diagram-toolbar">
      <h3 class="diagram-title">Interactive Mermaid diagram</h3>
      <div class="zoom-controls" aria-label="Diagram zoom controls">
        <button type="button" data-zoom="out" aria-label="Zoom out">−</button>
        <button type="button" data-zoom="reset" aria-label="Reset diagram zoom">Reset</button>
        <button type="button" data-zoom="in" aria-label="Zoom in">+</button>
        <button type="button" data-zoom="expand" aria-label="Open rendered diagram SVG">Open SVG</button>
      </div>
    </div>
    <div class="mermaid-viewport" data-mermaid-viewport>
      <div class="mermaid-canvas" data-mermaid-canvas>
        <div class="diagram-fallback">Loading diagram…</div>
      </div>
    </div>
    <pre class="diagram-pre diagram-source" id="${sourceId}" data-mermaid-source hidden>${escape(mermaid.trim())}</pre>
    <noscript><pre class="diagram-pre diagram-source">${escape(mermaid.trim())}</pre></noscript>
  </div>
  <aside class="mini-panel">
    <h3>Diagram</h3>
    ${summary ? `<p>${escape(summary)}</p>` : "<p>Rendered from Mermaid with pan and zoom controls. The source remains available if rendering fails.</p>"}
    <button class="copy" type="button" data-copy-target="${sourceId}">Copy Mermaid</button>
  </aside>
</div>`;
}

function renderSessionUsage(usage: SessionUsageSummary): string {
	const tokens = usage.tokens;
	const cards = [
		usageCard(String(usage.userPrompts), "User prompts"),
		usageCard(String(usage.totalToolCalls), "Tool calls"),
		usageCard(String(usage.assistantMessages), "Assistant turns"),
		usageCard(tokens ? tokens.total.toLocaleString() : "—", "Total tokens"),
		usageCard(
			tokens?.cost ? `$${tokens.cost.toFixed(4)}` : "—",
			"Estimated cost",
		),
	];
	const tools =
		usage.tools.length > 0
			? `<h3>Registered tools</h3><ul class="tool-list">${usage.tools
					.map(
						(tool) =>
							`<li><code>${escape(tool.name)}</code><strong>${tool.count}</strong></li>`,
					)
					.join("")}</ul>`
			: "";
	const bash =
		usage.bash.length > 0
			? `<h3>Bash commands</h3><ul class="tool-list">${usage.bash
					.slice(0, 12)
					.map(
						(cmd) =>
							`<li><code>${escape(cmd.command)}</code><strong>${cmd.count}</strong></li>`,
					)
					.join("")}</ul>`
			: "";
	const tokenDetail = tokens
		? `<p class="prose">Tokens: ${tokens.input.toLocaleString()} input, ${tokens.output.toLocaleString()} output, ${tokens.cacheRead.toLocaleString()} cache read, ${tokens.cacheWrite.toLocaleString()} cache write.</p>`
		: `<p class="prose">Token usage was not present in this session file.</p>`;
	return `<div class="usage-grid">${cards.join("")}</div>${tokenDetail}${tools}${bash}`;
}

function usageCard(value: string, label: string): string {
	return `<div class="usage-card"><strong>${escape(value)}</strong><span>${escape(label)}</span></div>`;
}

function renderFileGallery(entries: FileMapEntry[]): string {
	if (entries.length === 0)
		return `<p class="prose">No changed files were captured.</p>`;
	const filesWithDiffs = entries.filter(
		(e) => typeof e.diff === "string" && e.diff.length > 0,
	);
	const otherFiles = entries.filter((e) => !filesWithDiffs.includes(e));
	const groupId = `files-${renderGroupCounter++}`;
	const tabButtons: string[] = [];
	const tabPanels: string[] = [];
	filesWithDiffs.forEach((entry, index) => {
		const badge = badgeFor(entry.status);
		const tabId = `${groupId}-tab-${index}`;
		const panelId = `${groupId}-panel-${index}`;
		const isActive = index === 0;
		tabButtons.push(
			`<button class="file-tab ${isActive ? "active" : ""}" role="tab" id="${tabId}" aria-selected="${isActive ? "true" : "false"}" aria-controls="${panelId}" data-target="${panelId}" data-group="${groupId}" tabindex="${isActive ? "0" : "-1"}">
				<span class="file-tab-path">${escape(entry.path)}</span>
				<span class="file-tab-meta">
					<span class="badge ${badge.className}">${escape(badge.label)}</span>
					<span class="file-tab-delta"><span class="add">+${entry.additions}</span><span class="del">−${entry.deletions}</span></span>
				</span>
			</button>`,
		);
		tabPanels.push(
			`<article class="file-diff-panel ${isActive ? "active" : ""}" role="tabpanel" id="${panelId}" aria-labelledby="${tabId}" data-group="${groupId}" aria-hidden="${isActive ? "false" : "true"}" tabindex="0">
				<header class="file-diff-head">
					<div class="file-diff-path">
						<code>${escape(entry.path)}</code>
						<span class="badge ${badge.className}">${escape(badge.label)}</span>
					</div>
					<div class="file-diff-stats">
						<span class="add">+${entry.additions}</span>
						<span class="del">−${entry.deletions}</span>
					</div>
				</header>
				<pre class="diff-pre"><code>${escape(entry.diff ?? "")}</code></pre>
			</article>`,
		);
	});
	const tabs =
		filesWithDiffs.length > 0
			? `<div class="file-tabs" role="tablist" aria-label="Changed files">
				${tabButtons.join("")}
			</div>
			<div class="file-tab-panels">
				${tabPanels.join("")}
			</div>`
			: "";
	const otherList =
		otherFiles.length > 0
			? `<div class="other-files">
				<h3>Other files</h3>
				<div class="file-grid">${otherFiles.map(renderFileCard).join("")}</div>
			</div>`
			: "";
	const header = `<div class="file-toolbar"><div class="prose">${entries.length} file${entries.length === 1 ? "" : "s"} changed.</div></div>`;
	return `${header}${tabs}${otherList}`;
}

let renderGroupCounter = 0;

function renderFileCard(entry: FileMapEntry): string {
	const badge = badgeFor(entry.status);
	const total = entry.additions + entry.deletions;
	const addPct = total === 0 ? 0 : Math.round((entry.additions / total) * 100);
	const delPct = total === 0 ? 0 : 100 - addPct;
	const searchText = `${entry.path} ${entry.status} ${entry.note ?? ""}`;
	const diff = entry.diff
		? `<details class="file-diff"><summary>Show diff</summary><pre class="diff-pre"><code>${escape(entry.diff)}</code></pre></details>`
		: "";
	return `<article class="file-card" data-file-card="${escapeAttr(searchText)}">
  <div class="file-top"><code class="path">${escape(entry.path)}</code><span class="badge ${badge.className}">${escape(badge.label)}</span></div>
  ${entry.note ? `<div class="note">${escape(entry.note)}</div>` : ""}
  <div class="delta"><span>+${entry.additions}</span><div class="bar"><span class="bar-add" style="width:${addPct}%"></span><span class="bar-del" style="width:${delPct}%"></span></div><span>−${entry.deletions}</span></div>
  ${diff}
</article>`;
}

function renderTimeline(items: SessionTimelineItem[]): string {
	if (items.length === 0)
		return `<p class="prose">No timeline items were captured.</p>`;
	return `<div class="timeline">${items
		.map(
			(item) => `<div class="timeline-item">
  <div class="timeline-role">${escape(item.role)}</div>
  <div class="timeline-body"><strong>${escape(item.title)}</strong>${item.detail ? `<p>${escape(item.detail)}</p>` : ""}</div>
</div>`,
		)
		.join("")}</div>`;
}

function renderRisks(risks: ReviewRisk[]): string {
	return `<div class="risk-grid">${risks
		.map(
			(risk) =>
				`<article class="risk risk-${escapeAttr(risk.severity)}"><h3>${escape(risk.severity.toUpperCase())} — ${escape(risk.title)}</h3><p>${escape(risk.description)}</p></article>`,
		)
		.join("")}</div>`;
}

function renderKeyChanges(changes: KeyChange[]): string {
	if (changes.length === 0) return "";
	return `<section class="section-card" id="key-changes">
  <div class="section-head"><div><div class="section-kicker">Evidence</div><h2>Key changes</h2></div></div>
  <div class="section-body"><div class="change-grid">${changes.map(renderKeyChange).join("")}</div></div>
</section>`;
}

function renderKeyChange(change: KeyChange): string {
	const annotations = renderAnnotations(change);
	return `<article class="change"><div class="change-main"><div class="change-path">${escape(change.path)}</div><h3>${escape(change.summary)}</h3>${change.rationale ? `<p>${escape(change.rationale)}</p>` : ""}${annotations}</div></article>`;
}

function renderAnnotations(change: KeyChange): string {
	if (!change.annotations || change.annotations.length === 0) return "";
	const items = change.annotations
		.map((annotation) => {
			const lineRange = annotation.lineRange
				? `<span class="line-range">${escape(annotation.lineRange)}</span>`
				: "<span></span>";
			return `<li>${lineRange}<span>${escape(annotation.note)}</span></li>`;
		})
		.join("");
	return `<ul class="annotations">${items}</ul>`;
}

function renderFollowUps(followUps: string[]): string {
	if (followUps.length === 0) return "";
	return `<section class="section-card" id="follow-ups">
  <div class="section-head"><div><div class="section-kicker">Next</div><h2>Follow-ups</h2></div></div>
  <div class="section-body"><ul class="followups">${followUps.map((item) => `<li>${escape(item)}</li>`).join("")}</ul></div>
</section>`;
}

function sectionTitle(section: RecapSection): string {
	switch (section.type) {
		case "outcome":
			return "Summary";
		case "diagram":
			return section.title;
		case "session-usage":
			return "Tool and token usage";
		case "file-tree":
			return section.title ?? "Changed files";
		case "session-timeline":
			return "Timeline";
		case "review-notes":
			return "Review notes";
		default: {
			const _exhaustive: never = section;
			return _exhaustive;
		}
	}
}

function badgeFor(status: FileMapEntry["status"]): {
	className: string;
	label: string;
} {
	switch (status) {
		case "added":
			return { className: "badge-added", label: "A" };
		case "modified":
			return { className: "badge-modified", label: "M" };
		case "deleted":
			return { className: "badge-deleted", label: "D" };
		case "renamed":
			return { className: "badge-renamed", label: "R" };
		case "copied":
			return { className: "badge-copied", label: "C" };
		case "touched":
			return { className: "badge-touched", label: "·" };
		case "read":
			return { className: "badge-read", label: "Read" };
		default:
			return { className: "badge-unknown", label: "?" };
	}
}

// Small, intentionally limited Markdown subset for AI summaries: paragraphs,
// bullet lists, inline code, and bold text. Full Markdown remains in recap.md.
function markdownToHtml(markdown: string): string {
	const blocks = markdown
		.trim()
		.split(/\n{2,}/)
		.filter(Boolean);
	if (blocks.length === 0) return "";
	return `<div class="prose">${blocks.map(renderMarkdownBlock).join("")}</div>`;
}

function renderMarkdownBlock(block: string): string {
	const lines = block
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	if (lines.length > 0 && lines.every((line) => /^[-*]\s+/.test(line))) {
		return `<ul>${lines.map((line) => `<li>${formatInline(line.replace(/^[-*]\s+/, ""))}</li>`).join("")}</ul>`;
	}
	return `<p>${formatInline(lines.join("\n"))}</p>`;
}

function formatInline(value: string): string {
	return escape(value)
		.replace(/`([^`]+)`/g, "<code>$1</code>")
		.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
		.replace(/\n/g, "<br />");
}

function sourceLabel(source: RecapDocument["source"]): string {
	switch (source) {
		case "git":
			return "Git diff";
		case "github-pr":
			return "GitHub PR";
		case "pi-session":
			return "Pi session";
		default: {
			const _exhaustive: never = source;
			return _exhaustive;
		}
	}
}

function formatDate(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return date.toLocaleString(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	});
}

// biome-ignore lint/suspicious/noShadowRestrictedNames: matches the existing renderer API
function escape(value: string): string {
	return value.replace(/[&<>"]/g, (char) => {
		switch (char) {
			case "&":
				return "&amp;";
			case "<":
				return "&lt;";
			case ">":
				return "&gt;";
			case '"':
				return "&quot;";
			default:
				return char;
		}
	});
}

function escapeAttr(value: string): string {
	return escape(value).replace(/'/g, "&#39;");
}
