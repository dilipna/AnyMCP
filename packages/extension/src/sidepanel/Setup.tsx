// "Getting started": the five steps from installing to a first real result, each with its live status.
// Every status is derived from real state (bridge connection, grants, enabled tools, runs) — nothing is assumed.

import type { PanelState } from "../shared/types";

interface Step {
  title: string;
  done: boolean;
  /** What to do while this step is not done. */
  todo: string;
  action?: { label: string; go: () => void };
}

export function setupSteps(state: PanelState, nav: { record: () => void; settings: () => void }): Step[] {
  const c = state.conn;
  const bridgeOk = c.paired && c.state === "connected";
  return [
    {
      title: "Start the bridge and pair this browser",
      done: bridgeOk,
      todo: c.paired
        ? "This browser is paired, but the bridge is not running. Start it again (anymcp-bridge, or npm run bridge in the project folder)."
        : "Start the bridge on this computer (anymcp-bridge), then enter the 8-digit code it shows under Connect.",
      ...(c.paired ? {} : { action: { label: "Open Connect", go: nav.settings } }),
    },
    {
      title: "Connect your AI app",
      done: !!c.clientName,
      todo: "Add AnyMCP to your AI app (an MCP client) with the command or settings entry shown in Settings → Show the client command.",
      action: { label: "Show how", go: nav.settings },
    },
    {
      title: "Allow a website",
      done: state.grants.length > 0,
      todo: "Choose the one site AnyMCP may use. Chrome asks you to confirm. You can remove it any time.",
      action: { label: "Allow a website", go: nav.record },
    },
    {
      title: "Teach, test and enable a tool",
      done: state.tools.some((t) => t.enabledVersion !== null),
      todo: "Do a task once on that site (start with something read-only, like a search), review what the tool may read and change, test it, then enable it.",
      action: { label: "Teach a workflow", go: nav.record },
    },
    {
      title: "Ask your AI app to use it",
      done: state.runs.some((r) => r.trigger === "mcp"),
      todo: "Ask your assistant to do the task. Each run appears under Runs with what happened and whether it was verified.",
    },
  ];
}

export function SetupChecklist({ state, nav }: { state: PanelState; nav: { record: () => void; settings: () => void } }) {
  const steps = setupSteps(state, nav);
  const next = steps.findIndex((s) => !s.done);
  if (next === -1) return null; // all done: get out of the way
  return (
    <section className="card" aria-labelledby="setup-h">
      <h2 id="setup-h">Getting started</h2>
      <p className="muted">
        {steps.filter((s) => s.done).length} of {steps.length} done. AnyMCP lets your AI app run website tasks you taught and approved; it does not call
        an AI model itself.
      </p>
      <ol className="plain setup">
        {steps.map((s, i) => (
          <li key={s.title} className={`setup-step ${s.done ? "done" : i === next ? "current" : ""}`} aria-current={i === next ? "step" : undefined}>
            <span className="setup-mark" aria-hidden="true">{s.done ? "✓" : i + 1}</span>
            <div className="stack" style={{ gap: 2 }}>
              <strong>
                {s.title}
                <span className="visually-hidden">{s.done ? " (done)" : i === next ? " (next step)" : " (not done yet)"}</span>
              </strong>
              {i === next && (
                <>
                  <small>{s.todo}</small>
                  {s.action && (
                    <div>
                      <button type="button" className="btn small primary" onClick={s.action.go}>{s.action.label}</button>
                    </div>
                  )}
                </>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
