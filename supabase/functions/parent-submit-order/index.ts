import { HttpError, serveJson } from "../_shared/http.ts";
import { requireParentSession } from "../_shared/parent-session.ts";
import { createServiceClient } from "../_shared/supabase.ts";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve((request) =>
  serveJson(request, "parent-submit-order", async (_req, body) => {
    const service = createServiceClient();
    const session = await requireParentSession(service, body.accessToken);
    const photoIds = body.photoIds;
    const packageIds = body.packageIds;
    const parentNote = typeof body.parentNote === "string" ? body.parentNote.trim() : "";

    if (!Array.isArray(photoIds) || !Array.isArray(packageIds) ||
        photoIds.length > 20 || packageIds.length > 10 ||
        parentNote.length > 2000 ||
        photoIds.some((id) => typeof id !== "string" || !uuidPattern.test(id)) ||
        packageIds.some((id) => typeof id !== "string" || !uuidPattern.test(id)) ||
        (photoIds.length === 0 && packageIds.length === 0)) {
      throw new HttpError(400, "invalid_order", "Select at least one photo or package and try again.");
    }

    const { data, error } = await service.rpc("submit_parent_order", {
      p_learner_id: session.learner_id,
      p_photo_ids: photoIds,
      p_package_ids: packageIds,
      p_parent_note: parentNote,
    });
    if (error) {
      if (error.message.includes("invalid photo selection") ||
          error.message.includes("invalid package selection") ||
          error.message.includes("learner is not eligible")) {
        throw new HttpError(400, "invalid_order_selection", "Some selected items are no longer available.");
      }
      if (error.message.includes("invalid order selection")) {
        throw new HttpError(400, "invalid_order", "The order selection is too large.");
      }
      throw new Error("Unable to submit the order request.");
    }
    if (!Array.isArray(data) || !data[0]) {
      throw new Error("The order request could not be confirmed.");
    }
    return {
      id: data[0].id,
      orderCode: data[0].order_code,
      status: data[0].status,
      createdAt: data[0].created_at,
    };
  })
);
