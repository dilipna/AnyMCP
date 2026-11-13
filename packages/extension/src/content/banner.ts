// Persistent in-page indicator that automation (or recording) is active, with a Stop control.
// Lives in a closed shadow root so page styles cannot restyle it. A hostile page could still remove
// the host element; the toolbar badge and the side panel indicate the same state independently.

let host: HTMLElement | null = null;

export function showBanner(text: string, kind: "running" | "recording", onStop: () => void): void {
  hideBanner();
  host = document.createElement("div");
  host.setAttribute("data-mycp-banner", "");
  host.style.cssText = "all:initial;position:fixed;top:12px;right:12px;z-index:2147483647;";
  const root = host.attachShadow({ mode: "closed" });
  const color = kind === "recording" ? "#b42318" : "#0b57d0";
  root.innerHTML = `
    <style>
      .bar{font:600 13px/1.3 system-ui,sans-serif;display:flex;gap:10px;align-items:center;background:#fff;color:#1b1f24;
           border:2px solid ${color};border-radius:10px;padding:8px 10px;box-shadow:0 4px 18px rgba(0,0,0,.25);max-width:340px}
      .dot{width:10px;height:10px;border-radius:50%;background:${color};animation:p 1.4s ease-in-out infinite}
      @media (prefers-reduced-motion: reduce){.dot{animation:none}}
      @keyframes p{50%{opacity:.35}}
      button{font:inherit;background:${color};color:#fff;border:0;border-radius:6px;padding:4px 10px;cursor:pointer}
      button:focus-visible{outline:3px solid #ffbf47;outline-offset:2px}
      span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    </style>
    <div class="bar" role="status" aria-live="polite"><div class="dot" aria-hidden="true"></div><span></span><button type="button">Stop</button></div>`;
  root.querySelector("span")!.textContent = text;
  root.querySelector("button")!.addEventListener("click", (e) => {
    if (e.isTrusted) onStop(); // a page script cannot click Stop on the user's behalf... or fake it
  });
  (document.documentElement ?? document.body).appendChild(host);
}

export function hideBanner(): void {
  host?.remove();
  host = null;
}
