import { serveJson, HttpError } from "../_shared/http.ts";
import { createParentToken, hashPin, keyedHash, verifyPin } from "../_shared/crypto.ts";
import { createServiceClient } from "../_shared/supabase.ts";

const referencePattern = /^[A-Z0-9-]{4,40}$/;
const pinPattern = /^\d{6,12}$/;
const sessionLifetimeMs = 15 * 60 * 1000;
const dummyPin = Array.from(crypto.getRandomValues(new Uint8Array(8)), (value) => String(value % 10)).join("");
const dummyPinHash = hashPin(dummyPin);

Deno.serve((request) =>
  serveJson(request, "parent-access", async (req, body) => {
    const reference = typeof body.reference === "string" ? body.reference.trim().toUpperCase() : "";
    const pin = typeof body.pin === "string" ? body.pin : "";
    if (!referencePattern.test(reference) || !pinPattern.test(pin)) {
      throw new HttpError(400, "invalid_credentials_format", "Enter a valid learner code and 6–12 digit PIN.");
    }

    const service = createServiceClient();
    const referenceHash = await keyedHash(`access-reference:${reference}`);
    const forwardedIp = req.headers.get("x-real-ip") ?? "";
    const ipHash = forwardedIp ? await keyedHash(`access-ip:${forwardedIp}`) : null;
    const { data: allowed, error: rateLimitError } = await service.rpc(
      "consume_parent_access_attempt",
      { p_reference_hash: referenceHash, p_ip_hash: ipHash },
    );
    if (rateLimitError) {
      throw new Error("Unable to apply parent access rate limit.");
    }
    if (!allowed) {
      throw new HttpError(429, "too_many_attempts", "Too many access attempts. Try again later.");
    }

    const { data: learner, error: learnerError } = await service
      .from("learners")
      .select("id, class_id, consent_status")
      .eq("reference_code", reference)
      .eq("is_active", true)
      .maybeSingle();
    if (learnerError) {
      throw new Error("Unable to verify learner access.");
    }

    let credentialHash: string | null = null;
    if (learner) {
      const { data: credential, error: credentialError } = await service
        .from("learner_access_credentials")
        .select("pin_hash")
        .eq("learner_id", learner.id)
        .maybeSingle();
      if (credentialError) {
        throw new Error("Unable to verify learner credentials.");
      }
      credentialHash = credential?.pin_hash ?? null;

      if (credentialHash && await verifyPin(pin, credentialHash)) {
        const { data: schoolClass, error: classError } = await service
          .from("school_classes")
          .select("project_id")
          .eq("id", learner.class_id)
          .maybeSingle();
        if (classError) {
          throw new Error("Unable to validate learner project.");
        }
        const { data: project, error: projectError } = schoolClass
          ? await service
            .from("school_projects")
            .select("school_id, status")
            .eq("id", schoolClass.project_id)
            .maybeSingle()
          : { data: null, error: null };
        if (projectError) {
          throw new Error("Unable to validate learner project.");
        }
        const { data: school, error: schoolError } = project
          ? await service
            .from("schools")
            .select("is_active")
            .eq("id", project.school_id)
            .maybeSingle()
          : { data: null, error: null };
        if (schoolError) {
          throw new Error("Unable to validate learner school.");
        }
        if (!school || !school.is_active || !project || project.status !== "active" ||
            learner.consent_status !== "approved") {
          throw new HttpError(401, "invalid_credentials", "The learner code or PIN is incorrect, or the gallery is unavailable.");
        }

        const accessToken = createParentToken();
        const expiresAt = new Date(Date.now() + sessionLifetimeMs).toISOString();
        const tokenHash = await keyedHash(`parent-session:${accessToken}`);
        const { error: sessionError } = await service
          .from("parent_sessions")
          .insert({ token_hash: tokenHash, learner_id: learner.id, expires_at: expiresAt });
        if (sessionError) {
          throw new Error("Unable to create parent session.");
        }
        return { accessToken, expiresAt };
      }
    }
    if (!credentialHash) {
      await verifyPin(pin, await dummyPinHash);
    }

    throw new HttpError(401, "invalid_credentials", "The learner code or PIN is incorrect, or the gallery is unavailable.");
  })
);
