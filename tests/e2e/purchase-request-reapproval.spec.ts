import { expect, test } from "@playwright/test";
import { authenticate, expectStatus, getRequest } from "./receipt-support";
import { createRequestViaApi, credentials, postRequestAction } from "./support";

for (const action of ["REQUEST_REVISION", "REQUEST_CLARIFICATION"]) {
  for (const saveDraftFirst of [false, true]) {
    test(`${action}: edited scope requires approval (save first: ${saveDraftFirst})`, async ({ page }) => {
      await authenticate(page);
      const request = await createRequestViaApi(page, { submit: true });
      await authenticate(page, credentials.approver);
      await expectStatus(await postRequestAction(page, request.id, "approval", { action: "APPROVED" }), 200);
      await authenticate(page, credentials.purchasing);
      await expectStatus(await postRequestAction(page, request.id, "status", { action, comment: "Please revise scope" }), 200);
      await authenticate(page);
      const original = await getRequest(page, request.id);
      expect(original.approvedAt).not.toBeNull();
      const payload = {
        requestDate: original.requestDate,
        department: original.department,
        reason: "Revised scope needs fresh approval",
        urgency: original.urgency,
        requesterComment: "Increased quantity and changed the product",
        items: [{ itemName: "Revised product", quantity: 100, unit: "ชิ้น", unitPrice: 2000, amount: 200000 }],
      };
      const save = (submit: boolean) => page.request.patch(`/api/purchase-requests/${request.id}`, {
        multipart: { payload: JSON.stringify({ ...payload, submit }) },
      });
      if (saveDraftFirst) {
        await expectStatus(await save(false), 200);
        const saved = await getRequest(page, request.id);
        expect(saved.approvedAt).toBeNull();
        expect(saved.status).toBe(original.status);
      }
      await expectStatus(await save(true), 200);
      const revised = await getRequest(page, request.id);
      expect(revised.status).toBe("PENDING_APPROVAL");
      expect(revised.approvedAt).toBeNull();
      expect(revised.totalAmount).toBe(200000);
      expect(revised.currentApprover?.role).toBe("APPROVER");
      await authenticate(page, credentials.purchasing);
      await expectStatus(await postRequestAction(page, request.id, "status", { action: "ORDERED" }), 400);
      await authenticate(page, credentials.approver);
      await expectStatus(await postRequestAction(page, request.id, "approval", { action: "APPROVED" }), 200);
      const approved = await getRequest(page, request.id);
      expect(approved.status).toBe("APPROVED");
      expect(approved.approvedAt).not.toBeNull();
      expect(approved.items[0].quantity).toBe(100);
    });
  }
}
