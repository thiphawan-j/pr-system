import assert from "node:assert/strict";
import { test } from "node:test";
import { assertLegacyProcurementWriter } from "../../src/server/purchase-orders/procurement-ownership";
import { toErrorResponse } from "../../src/server/shared/errors";

test("cutover is opt-in and returns a stable conflict without a database", async () => {
  const original = process.env.PO_WORKSPACE_ENABLED;
  try {
    delete process.env.PO_WORKSPACE_ENABLED;
    assert.doesNotThrow(assertLegacyProcurementWriter);
    process.env.PO_WORKSPACE_ENABLED = "false";
    assert.doesNotThrow(assertLegacyProcurementWriter);
    for (const value of ["true", " TRUE "]) {
      process.env.PO_WORKSPACE_ENABLED = value;
      let caught: unknown;
      try { assertLegacyProcurementWriter(); } catch (error) { caught = error; }
      assert.ok(caught);
      const response = toErrorResponse(caught);
      assert.equal(response.status, 409);
      assert.equal((await response.json()).code, "PO_WORKSPACE_OWNS_PROCUREMENT");
    }
  } finally {
    if (original === undefined) delete process.env.PO_WORKSPACE_ENABLED;
    else process.env.PO_WORKSPACE_ENABLED = original;
  }
});

test("every legacy procurement mutation fails before touching data at cutover", async () => {
  const original = process.env.PO_WORKSPACE_ENABLED;
  process.env.PO_WORKSPACE_ENABLED = "true";
  try {
    const creation = await import("../../src/server/purchase-orders/purchase-order-creation.service");
    const change = await import("../../src/server/purchase-orders/purchase-order-change.service");
    const cancellation = await import("../../src/server/purchase-orders/purchase-order-cancellation.service");
    const share = await import("../../src/server/purchase-orders/purchase-order-share.service");
    const pr = await import("../../src/server/purchase-requests/purchase-request.service");
    const blocked = (action: () => Promise<unknown>) => assert.rejects(action, { code: "PO_WORKSPACE_OWNS_PROCUREMENT" });
    await blocked(() => creation.convertPurchaseRequestToOrders("id", {} as never, {} as never));
    await blocked(() => creation.combinePurchaseRequestsToOrders({} as never, {} as never));
    await blocked(() => change.proposePurchaseOrderChange("id", {} as never, {} as never));
    await blocked(() => change.reviewPurchaseOrderChange("id", "change", {} as never, {} as never));
    await blocked(() => cancellation.cancelPurchaseOrder("id", {} as never, {} as never));
    await blocked(() => share.createPurchaseOrderShare("id", {} as never));
    await blocked(() => share.revokePurchaseOrderShare("id", {} as never, {} as never));
    await blocked(() => pr.closePurchaseRequest("id", {} as never, {} as never));
    await blocked(() => pr.recordPurchaseRequestReceipt("id", {} as never, {} as never));
    await blocked(() => pr.updatePurchaseRequestReceiptReferences("id", "receipt", {} as never, {}));
    await blocked(() => pr.updateReceiptReferences("id", {} as never, {}));
    await blocked(() => pr.updatePurchaseRequestCancellation("id", {} as never, {} as never));
    for (const action of ["ORDERED", "RECEIVED"] as const) {
      await blocked(() => pr.progressPurchaseRequest("id", {} as never, { action }));
    }
  } finally {
    if (original === undefined) delete process.env.PO_WORKSPACE_ENABLED;
    else process.env.PO_WORKSPACE_ENABLED = original;
  }
});
