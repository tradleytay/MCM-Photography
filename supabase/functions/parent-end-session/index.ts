import { serveJson, HttpError } from "../_shared/http.ts";
import { keyedHash } from "../_shared/crypto.ts";
import { createServiceClient } from "../_shared/supabase.ts";

Deno.serve((request) =>
  serveJson(request, "parent-end-session", async (_req, body) => {
    if (typeof body.accessToken !== "string" || body.accessToken.length < 32 || body.accessToken.length > 128) {
      throw new HttpError(400, "invalid_session", "The gallery session is invalid.");
    }

    const tokenHash = await keyedHash(`parent-session:${body.accessToken}`);
    const { error } = await createServiceClient()
      .from("parent_sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("token_hash", tokenHash)
      .is("revoked_at", null);
    if (error) {
      throw new Error("Unable to end parent session.");
    }
    return { ended: true };
  })
);
