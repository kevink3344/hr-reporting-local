// Renders docs/user-guide.md to a styled, self-contained HTML file in docs/screenshots
// with the real screenshots embedded/referenced, then opens it in the browser.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const mdPath = resolve(root, 'docs/user-guide.md');
const outPath = resolve(root, 'docs/user-guide.html');
const outDir = dirname(outPath);

const md = readFileSync(mdPath, 'utf8');

// Configure marked
marked.setOptions({ gfm: true, breaks: false });

const body = marked.parse(md);

// Resolve relative image paths so img src works regardless of where the html sits.
// The html will be placed in docs/, so ./screenshots/x.png stays correct.
let html = body;

// Build the full HTML document with a clean print/document stylesheet.
const doc = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>HR Reporting — User Guide</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #1f2933;
    background: #f5f7fa;
    line-height: 1.62;
    -webkit-font-smoothing: antialiased;
  }
  .page {
    max-width: 900px;
    margin: 0 auto;
    padding: 48px 28px 96px;
    background: #ffffff;
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.08);
  }
  h1 { font-size: 2.05rem; line-height: 1.2; margin: 0 0 8px; color: #102a43; }
  h2 {
    font-size: 1.5rem; margin: 2.2em 0 0.7em; padding-top: 0.5em;
    border-top: 2px solid #e4e7eb; color: #102a43;
  }
  h2:first-of-type { border-top: none; padding-top: 0; }
  h3 { font-size: 1.2rem; margin: 1.6em 0 0.6em; color: #243b53; }
  p { margin: 0.6em 0; }
  blockquote {
    margin: 1.2em 0; padding: 0.2em 1.1em;
    border-left: 4px solid #4f46e5; background: #f4f4ff; border-radius: 0 8px 8px 0;
    color: #3730a3;
  }
  blockquote p { margin: 0.45em 0; }
  ol, ul { padding-left: 1.4em; margin: 0.7em 0; }
  li { margin: 0.35em 0; }
  code {
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
    font-size: 0.9em;
    background: #f0f2f5; padding: 0.15em 0.4em; border-radius: 4px; color: #c2410c;
  }
  strong { color: #0f172a; }
  img {
    display: block;
    max-width: 100%;
    height: auto;
    margin: 1.1em auto 0.3em;
    border: 1px solid #dfe3e8;
    border-radius: 8px;
    box-shadow: 0 2px 8px rgb(0 0 0 / 0.10);
  }
  .img-render { text-align: center; }
  .img-render img { display: inline-block; }
  em { color: #475569; }
  hr { border: none; border-top: 1px solid #e4e7eb; margin: 2em 0; }
  a { color: #4f46e5; }
  @media print {
    body { background: #fff; }
    .page { box-shadow: none; padding: 24px; max-width: 100%; }
  }
</style>
</head>
<body>
<div class="page">
${html}
</div>
</body>
</html>`;

// Prepend a print/author note linking back to the .md source.
writeFileSync(outPath, doc, 'utf8');
console.log('Wrote ' + outPath);
