import { HttpError } from "./http.ts";
import { keyedHash } from "./crypto.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export async function requireParentSession(
  service: SupabaseClient,
  token: unknown,
) {
  if (typeof token !== "string" || token.length < 32 || token.length > 128) {
    throw new HttpError(401, "parent_access_required", "Access your learner gallery to continue.");
  }

  const tokenHash = await keyedHash(`parent-session:${token}`);
  const { data, error } = await service
    .from("parent_sessions")
    .select("learner_id, expires_at, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (error) {
    throw new Error("Unable to validate parent session.");
  }
  if (!data || data.revoked_at || new Date(data.expires_at).getTime() <= Date.now()) {
    throw new HttpError(401, "parent_access_expired", "Your gallery access has expired. Sign in again.");
  }
  return { ...data, token_hash: tokenHash };
}
