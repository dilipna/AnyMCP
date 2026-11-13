// The first vertical slice, end to end, with nothing mocked:
//   MCP client -> local bridge (validates + authorizes) -> AnyMCP Extension -> real browser tab on the
//   synthetic fixture -> tool locates the order -> schema-validated, verified result with source ->
//   the run appears in the side panel.

import { expect, test } from "@playwright/test";
import { startStack, waitForState, type Stack } from "./harness";

let s: Stack;
test.beforeAll(async () => {
  s = await startStack();
});
test.afterAll(async () => {
  await s?.close();
});
test.beforeEach(async () => {
  await s.chaos({ reset: true });
});

test("find_order: MCP client gets a verified, schema-valid result with source, and the run shows in the panel", async () => {
  const client = await s.mcp();
  const { tools } = await client.listTools();
  expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["find_order", "draft_customer_note", "anymcp_get_run"]));

  const order = s.fixture.state.orders.find((o) => o.id === "A-1012")!;
  const env = await s.run(client, "find_order", { order_id: "A-1012" });

  expect(env.status).toBe("success");
  expect(env.reasonCode).toBe("ok");
  expect(env.tool).toEqual({ id: "find_order", version: 1 });
  expect(env.actionMayHaveOccurred).toBe(false);
  expect(env.output).toMatchObject({ found: true, order_id: "A-1012", customer: order.customer, status: order.status, total: order.total, placed: order.placed });
  expect(env.source).toMatchObject({ origin: s.fixture.origin, path: "/orders/A-1012" });
  expect(env.verification.postconditions.every((c) => c.passed)).toBe(true);
  expect(env.verification.preconditions.every((c) => c.passed)).toBe(true);
  expect(env.untrustedContent).toBe(true);
  expect(env.executionId).toMatch(/^run_[0-9a-f]{16}$/);

  // the same execution is visible to the user in the extension
  const state = await waitForState(s, (st) => st.runs.some((r) => r.executionId === env.executionId && r.state === "success"));
  const rec = state.runs.find((r) => r.executionId === env.executionId)!;
  expect(rec.trigger).toBe("mcp");
  expect(rec.events.map((e) => e.phase)).toEqual(expect.arrayContaining(["received", "permission_checked", "preconditions_checked", "step_executed", "outcome_verified", "result_returned"]));
  // privacy default: the stored record has no output and no entered values
  expect(rec.envelope?.output).toBeUndefined();
  expect(JSON.stringify(rec)).not.toContain("A-1012");

  await s.panel.getByRole("button", { name: "Runs" }).click();
  await expect(s.panel.getByText("Find order").first()).toBeVisible();
  await client.close();
});

test("find_order: a well-formed id that does not exist is a verified EMPTY result, not a failure", async () => {
  const client = await s.mcp();
  const env = await s.run(client, "find_order", { order_id: "A-9999" });
  expect(env.status).toBe("empty");
  expect(env.reasonCode).toBe("no_results");
  expect(env.output).toEqual({ found: false });
  await client.close();
});

test("find_order: a malformed id is rejected before anything runs in the browser", async () => {
  const client = await s.mcp();
  const before = s.fixture.state.requestLog.length;
  const res = await client.callTool({ name: "find_order", arguments: { order_id: "not-an-order" } });
  expect(res.isError).toBe(true);
  expect(s.fixture.state.requestLog.length).toBe(before); // the browser never touched the site
  await client.close();
});
