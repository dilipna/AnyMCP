// Builds Chrome Web Store images from the REAL extension's screenshots.
//   npm run screenshots && npx tsx scripts/store-assets.ts
// Output: store/screenshots/01-*.png … (1280×800) and promo-small-440x280.png.
// Each image says what it is: a render of the extension's side-panel page with SYNTHETIC data. Playwright cannot
// capture Chrome's docked side panel, so these are not window captures and are labelled as renders.

import { chromium } from "@playwright/test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const raw = (n: string) => resolve(root, "store/screenshots/raw/light", n);
const b64 = (p: string) => `data:image/png;base64,${readFileSync(p).toString("base64")}`;
const icon = b64(resolve(root, "packages/extension/dist/prod/icons/icon-128.png"));

const slides = [
  { file: "01-review-before-you-enable.png", src: "03-tool-review.png", h: "Review what a tool can read and change", p: "A plain-language summary generated from what AnyMCP actually enforces: where it runs, what it reads, what it may change, when it asks, how success is checked." },
  { file: "02-approve-every-change.png", src: "05-approval-request.png", h: "Approve every change, one run at a time", p: "The exact action and the page values you were shown. If the page changes before the click, the approval is withdrawn and nothing happens." },
  { file: "03-honest-results.png", src: "07-run-timeline-unknown-outcome.png", h: "Honest results — even “unknown”", p: "A click is never proof. When AnyMCP can’t tell whether an action happened, it says so, tells you what to check, and never repeats it for you." },
  { file: "04-teach-once.png", src: "10-recording.png", h: "Teach a workflow once", p: "Do the task, pick the values to return and a message that proves it worked. Passwords and payment fields are never recorded." },
  { file: "05-stay-in-control.png", src: "08-settings.png", h: "You stay in control", p: "Allow sites one at a time, disconnect your assistant, delete local history, or revoke everything with one button." },
];

const frame = (s: (typeof slides)[number]) => `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box} body{margin:0;width:1280px;height:800px;font-family:system-ui,"Segoe UI",sans-serif;color:#fff;
background:linear-gradient(135deg,#0b57d0 0%,#14213d 100%);display:flex;align-items:center;gap:56px;padding:0 72px;overflow:hidden}
.t{flex:1} h1{font-size:46px;line-height:1.1;margin:0 0 18px;font-weight:800;letter-spacing:-.5px}
p{font-size:22px;line-height:1.45;margin:0;color:#dbe6ff;max-width:560px}
.brand{display:flex;align-items:center;gap:12px;margin-bottom:34px;font-weight:700;font-size:22px}.brand img{width:44px;height:44px}
.panel{width:452px;height:700px;border-radius:14px;background:#fff;box-shadow:0 24px 70px rgba(0,0,0,.45);overflow:hidden;border:6px solid #fff;position:relative}
.panel img{width:440px;display:block}
.fade{position:absolute;left:0;right:0;bottom:0;height:70px;background:linear-gradient(transparent,#f6f7f9)}
.note{position:absolute;left:72px;bottom:22px;font-size:13px;color:#aebfe6;max-width:600px}
</style>
<div class="t"><div class="brand"><img src="${icon}">AnyMCP Extension</div><h1>${s.h}</h1><p>${s.p}</p></div>
<div class="panel"><img src="${b64(raw(s.src))}"><div class="fade"></div></div>
<div class="note">Render of the extension’s side-panel page with synthetic data (Acme Support Portal fixture). Not affiliated with Google or Anthropic.</div>`;

const promo = `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box} body{margin:0;width:440px;height:280px;font-family:system-ui,"Segoe UI",sans-serif;color:#fff;background:linear-gradient(135deg,#0b57d0,#14213d);display:flex;flex-direction:column;justify-content:center;padding:0 34px;gap:12px}
img{width:64px;height:64px} h1{margin:0;font-size:34px;font-weight:800} p{margin:0;font-size:17px;line-height:1.35;color:#dbe6ff}</style>
<img src="${icon}"><h1>AnyMCP Extension</h1><p>Teach a website task once, review it, and let your AI app run it as an MCP tool.</p>`;

for (const s of slides) if (!existsSync(raw(s.src))) throw new Error(`missing ${raw(s.src)} — run: npm run screenshots`);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

// Refuse to write an image whose text or logo is cut off at an edge (the first promo tile was: its padding pushed
// the tagline past 440 px). The panel screenshot is excluded: it is cropped on purpose and fades out.
async function assertFits(name: string) {
  const outside = await page.evaluate(() => {
    const found: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("h1, p, .brand, .note, body > img")) {
      const r = el.getBoundingClientRect();
      if (r.left < 0 || r.top < 0 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5 || el.scrollWidth > el.clientWidth + 1)
        found.push(`<${el.tagName.toLowerCase()}${el.className ? ` class="${el.className}"` : ""}> at x ${Math.round(r.left)}–${Math.round(r.right)}, y ${Math.round(r.top)}–${Math.round(r.bottom)}`);
    }
    return found.length ? `${found.join("; ")} (image is ${innerWidth}×${innerHeight})` : "";
  });
  if (outside) throw new Error(`${name}: content does not fit: ${outside}`);
}

for (const s of slides) {
  await page.setContent(frame(s));
  await assertFits(s.file);
  await page.screenshot({ path: resolve(root, "store/screenshots", s.file) });
  console.log("wrote", s.file);
}
await page.setViewportSize({ width: 440, height: 280 });
await page.setContent(promo);
await assertFits("promo-small-440x280.png");
await page.screenshot({ path: resolve(root, "store/screenshots/promo-small-440x280.png") });
console.log("wrote promo-small-440x280.png");
await browser.close();

writeFileSync(
  resolve(root, "store/screenshots/README.md"),
  `# Store images\n\nGenerated by \`scripts/store-assets.ts\` from screenshots of the REAL extension (\`scripts/screenshots.ts\`), using synthetic data.\n\n* 1280×800 images: panel renders with a caption. They are **renders of the extension's side-panel page**, labelled as such in each image — Playwright cannot capture Chrome's docked side panel.\n* \`promo-small-440x280.png\`: small promo tile.\n* Regenerate after any UI change: \`npm run screenshots && npx tsx scripts/store-assets.ts\`.\n* Before submitting, the owner should replace or supplement these with real window screenshots taken manually in Chrome.\n`,
);
