import { serveJson, HttpError } from "../_shared/http.ts";
import { hashPin } from "../_shared/crypto.ts";
import { createServiceClient, requireAdmin } from "../_shared/supabase.ts";

const pinPattern = /^\d{6,12}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve((request) =>
  serveJson(request, "admin-set-learner-pin", async (req, body) => {
    const admin = await requireAdmin(req);
    if (typeof body.learnerId !== "string" || !uuidPattern.test(body.learnerId) ||
        typeof body.pin !== "string" || !pinPattern.test(body.pin)) {
      throw new HttpError(400, "invalid_pin_request", "Select a learner and enter a 6–12 digit PIN.");
    }

    const service = createServiceClient();
    const pinHash = await hashPin(body.pin);
    const { error } = await service.rpc("admin_update_learner_pin", {
      p_learner_id: body.learnerId,
      p_pin_hash: pinHash,
      p_admin_id: admin.id,
    });
    if (error) {
      if (error.message.includes("learner not found")) {
        throw new HttpError(404, "learner_not_found", "The learner was not found.");
      }
      throw new Error("Unable to save the learner PIN, revoke existing sessions, and audit the change.");
    }

    return { updated: true };
  })
);
