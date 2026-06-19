// Render a RecapDocument as a polished, self-contained HTML review artifact.
import type {
	FileMapEntry,
	KeyChange,
	RecapDocument,
	RecapSection,
	ReviewRisk,
	SessionTimelineItem,
} from "../schemas.ts";

export function renderHtml(doc: RecapDocument): string {
	doc = {
		...doc,
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
    --font-body: "Aptos", "IBM Plex Sans", "Segoe UI", system-ui, sans-serif;
    --font-display: Georgia, "Iowan Old Style", "Times New Roman", serif;
    --font-mono: "Cascadia Code", "SFMono-Regular", ui-monospace, Menlo, Consolas, monospace;
    --bg: #faf7f2;
    --bg-soft: #f2ebe2;
    --panel: rgba(255, 252, 247, 0.86);
    --panel-strong: rgba(255, 249, 241, 0.96);
    --panel-recessed: rgba(235, 225, 211, 0.54);
    --fg: #2a2118;
    --muted: #706456;
    --subtle: #9b8d7d;
    --line: rgba(66, 44, 28, 0.12);
    --line-strong: rgba(66, 44, 28, 0.22);
    --accent: #c2410c;
    --accent-soft: rgba(194, 65, 12, 0.10);
    --accent-2: #4d7c0f;
    --accent-2-soft: rgba(77, 124, 15, 0.10);
    --accent-3: #0f766e;
    --accent-3-soft: rgba(15, 118, 110, 0.10);
    --ok: #4d7c0f;
    --warn: #b45309;
    --danger: #be123c;
    --shadow: 0 22px 60px rgba(69, 45, 25, 0.12);
    --radius: 18px;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      color-scheme: dark;
      --bg: #1a1412; --bg-soft: #231b18; --panel: rgba(35, 29, 26, 0.86); --panel-strong: rgba(53, 45, 40, 0.96); --panel-recessed: rgba(24, 19, 17, 0.68);
      --fg: #ede5dd; --muted: #b7a99a; --subtle: #8c7d6f; --line: rgba(255, 255, 255, 0.08); --line-strong: rgba(255, 255, 255, 0.16);
      --accent: #fb923c; --accent-soft: rgba(251, 146, 60, 0.13); --accent-2: #a3e635; --accent-2-soft: rgba(163, 230, 53, 0.10);
      --accent-3: #5eead4; --accent-3-soft: rgba(94, 234, 212, 0.10); --ok: #a3e635; --warn: #fbbf24; --danger: #fda4af;
      --shadow: 0 24px 70px rgba(0, 0, 0, 0.34);
    }
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    margin: 0;
    min-height: 100vh;
    background:
      radial-gradient(ellipse at 18% 0%, var(--accent-soft) 0%, transparent 46%),
      radial-gradient(ellipse at 82% 100%, var(--accent-2-soft) 0%, transparent 40%),
      linear-gradient(180deg, var(--bg), var(--bg-soft));
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
  .zoom-controls { display: flex; flex-wrap: wrap; gap: 6px; }
  .zoom-controls button { border: 1px solid var(--line); color: var(--fg); background: var(--panel); border-radius: 10px; padding: 7px 10px; cursor: pointer; }
  .zoom-controls button:hover { border-color: var(--accent); }
  .mermaid-viewport { min-height: 366px; overflow: hidden; cursor: grab; display: grid; place-items: center; }
  .mermaid-viewport:active { cursor: grabbing; }
  .mermaid-canvas { transform-origin: 50% 50%; transition: transform 120ms ease; padding: 26px; }
  .mermaid-canvas svg { max-width: none; height: auto; display: block; }
  .diagram-fallback { padding: 16px; }
  .diagram-source { max-height: 260px; }
  .diagram-pre, .json-pre { margin: 0; padding: 18px; overflow: auto; border: 1px solid var(--line); border-radius: 18px; background: var(--panel-recessed); color: var(--fg); font-size: 0.86rem; }
  .mini-panel { border: 1px solid var(--line); border-radius: 18px; background: var(--panel-recessed); padding: 16px; color: var(--muted); }
  .copy { border: 1px solid var(--line-strong); color: var(--fg); background: var(--panel); border-radius: 12px; padding: 9px 12px; cursor: pointer; }
  .copy:hover { border-color: var(--accent); }
  .file-toolbar { display: flex; gap: 12px; align-items: center; justify-content: space-between; margin-bottom: 14px; }
  .search { width: min(360px, 100%); border: 1px solid var(--line); border-radius: 14px; background: var(--panel-recessed); color: var(--fg); padding: 11px 13px; outline: none; }
  .file-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(270px, 1fr)); gap: 12px; }
  .file-card { position: relative; min-height: 136px; border: 1px solid var(--line); border-radius: 16px; padding: 15px; background: linear-gradient(180deg, var(--panel-strong), var(--panel)); transition: transform 160ms ease, border-color 160ms ease; }
  .file-card:hover { transform: translateY(-2px); border-color: var(--line-strong); }
  .file-card[data-hidden="true"] { display: none; }
  .file-top { display: flex; gap: 10px; align-items: flex-start; justify-content: space-between; }
  .path { word-break: break-word; color: var(--fg); font-size: 0.91rem; }
  .note { margin-top: 9px; color: var(--muted); font-size: 0.88rem; }
  .delta { display: flex; align-items: center; gap: 10px; margin-top: 14px; color: var(--muted); font-size: 0.85rem; }
  .bar { flex: 1; height: 8px; overflow: hidden; border-radius: 999px; background: var(--panel-recessed); display: flex; }
  .bar-add { background: var(--ok); }
  .bar-del { background: var(--danger); }
  .badge { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; min-width: 34px; height: 28px; padding: 0 9px; border-radius: 999px; font-size: 0.76rem; font-weight: 800; letter-spacing: 0.04em; border: 1px solid transparent; }
  .badge-added { color: var(--ok); background: var(--accent-2-soft); border-color: color-mix(in srgb, var(--ok) 30%, transparent); }
  .badge-modified { color: var(--warn); background: rgba(180, 83, 9, 0.10); border-color: color-mix(in srgb, var(--warn) 30%, transparent); }
  .badge-deleted { color: var(--danger); background: rgba(190, 18, 60, 0.10); border-color: color-mix(in srgb, var(--danger) 30%, transparent); }
  .badge-renamed, .badge-copied { color: var(--accent-3); background: var(--accent-3-soft); border-color: color-mix(in srgb, var(--accent-3) 30%, transparent); }
  .badge-touched, .badge-read, .badge-unknown { color: var(--muted); background: var(--panel-recessed); border-color: var(--line); }
  .risk-grid, .change-grid { display: grid; gap: 12px; }
  .risk { border: 1px solid var(--line); border-left-width: 5px; border-radius: 16px; padding: 16px; background: var(--panel-recessed); }
  .risk-high { border-left-color: var(--danger); }
  .risk-medium { border-left-color: var(--warn); }
  .risk-low { border-left-color: var(--ok); }
  .risk-info { border-left-color: var(--accent); }
  .risk p, .change p { margin: 8px 0 0; color: var(--muted); }
  .change { border: 1px solid var(--line); border-radius: 18px; background: var(--panel-recessed); overflow: hidden; }
  .change-main { padding: 18px; }
  .change-path { color: var(--accent); font-weight: 750; word-break: break-word; }
  .annotations { margin: 12px 0 0; padding: 0; list-style: none; display: grid; gap: 8px; }
  .annotations li { display: grid; grid-template-columns: auto 1fr; gap: 10px; align-items: start; color: var(--muted); }
  .line-range { color: var(--accent-3); border: 1px solid var(--line); border-radius: 999px; padding: 1px 7px; font-size: 0.76rem; }
  .timeline { position: relative; display: grid; gap: 10px; }
  .timeline-item { display: grid; grid-template-columns: 74px 1fr; gap: 14px; align-items: start; }
  .timeline-role { color: var(--accent-3); font-size: 0.76rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; padding-top: 4px; }
  .timeline-body { border: 1px solid var(--line); border-radius: 16px; padding: 13px 15px; background: var(--panel-recessed); }
  .timeline-body p { margin: 5px 0 0; color: var(--muted); }
  .followups { margin: 0; padding: 0; list-style: none; display: grid; gap: 10px; }
  .followups li { border: 1px solid var(--line); border-radius: 16px; padding: 13px 15px 13px 42px; background: var(--panel-recessed); position: relative; color: var(--muted); }
  .followups li::before { content: "□"; position: absolute; left: 16px; color: var(--accent-3); }
  details.raw { margin-top: 28px; border: 1px solid var(--line); border-radius: 18px; background: var(--panel); }
  details.raw summary { cursor: pointer; padding: 14px 18px; color: var(--muted); }
  details.raw .json-pre { border: 0; border-top: 1px solid var(--line); border-radius: 0 0 18px 18px; }
  .footer { margin-top: 28px; color: var(--subtle); font-size: 0.82rem; text-align: center; }
  @media (max-width: 850px) {
    .shell { width: min(100% - 20px, 1180px); padding-top: 10px; }
    .hero { border-radius: 24px; }
    .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .nav { border-radius: 22px; position: static; }
    .diagram-grid { grid-template-columns: 1fr; }
    .timeline-item { grid-template-columns: 1fr; gap: 6px; }
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

  const search = document.querySelector('[data-file-search]');
  if (search) {
    search.addEventListener('input', () => {
      const query = search.value.trim().toLowerCase();
      for (const card of document.querySelectorAll('[data-file-card]')) {
        const haystack = (card.getAttribute('data-file-card') || '').toLowerCase();
        card.setAttribute('data-hidden', query && !haystack.includes(query) ? 'true' : 'false');
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
    const blocked = 'script, foreignObject, iframe, object, embed, link, image, audio, video, animate, animateMotion, animateTransform, set';
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

  function escapeHtml(value) {
    return String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
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
	return {
		additions: doc.fileMap.reduce((sum, file) => sum + file.additions, 0),
		deletions: doc.fileMap.reduce((sum, file) => sum + file.deletions, 0),
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
		doc.keyChanges.length > 0 ? (["#key-changes", "Key changes"] as const) : undefined,
		doc.followUps.length > 0 ? (["#follow-ups", "Follow-ups"] as const) : undefined,
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
      <span>Interactive Mermaid diagram</span>
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

function renderFileGallery(entries: FileMapEntry[]): string {
	if (entries.length === 0)
		return `<p class="prose">No changed files were captured.</p>`;
	const search =
		entries.length > 6
			? `<input class="search" type="search" placeholder="Filter files…" data-file-search aria-label="Filter files" />`
			: "";
	return `<div class="file-toolbar"><div class="prose">${entries.length} file${entries.length === 1 ? "" : "s"} in this recap.</div>${search}</div>
<div class="file-grid">${entries.map(renderFileCard).join("")}</div>`;
}

function renderFileCard(entry: FileMapEntry): string {
	const badge = badgeFor(entry.status);
	const total = entry.additions + entry.deletions;
	const addPct = total === 0 ? 0 : Math.round((entry.additions / total) * 100);
	const delPct = total === 0 ? 0 : 100 - addPct;
	const searchText = `${entry.path} ${entry.status} ${entry.note ?? ""}`;
	return `<article class="file-card" data-file-card="${escapeAttr(searchText)}">
  <div class="file-top"><code class="path">${escape(entry.path)}</code><span class="badge ${badge.className}">${escape(badge.label)}</span></div>
  ${entry.note ? `<div class="note">${escape(entry.note)}</div>` : ""}
  <div class="delta"><span>+${entry.additions}</span><div class="bar"><span class="bar-add" style="width:${addPct}%"></span><span class="bar-del" style="width:${delPct}%"></span></div><span>−${entry.deletions}</span></div>
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
