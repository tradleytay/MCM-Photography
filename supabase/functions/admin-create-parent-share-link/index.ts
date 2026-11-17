import { serveJson, HttpError } from "../_shared/http.ts";
import { createParentToken, keyedHash } from "../_shared/crypto.ts";
import { createServiceClient, requireAdmin } from "../_shared/supabase.ts";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const shareLifetimeMs = 7 * 24 * 60 * 60 * 1000;

Deno.serve((request) =>
  serveJson(request, "admin-create-parent-share-link", async (req, body) => {
    const admin = await requireAdmin(req);
    if (typeof body.learnerId !== "string" || !uuidPattern.test(body.learnerId)) {
      throw new HttpError(400, "invalid_learner", "Select a valid learner.");
    }

    const service = createServiceClient();
    const { data: learner, error: learnerError } = await service
      .from("learners")
      .select("id, class_id, consent_status, is_active")
      .eq("id", body.learnerId)
      .maybeSingle();
    if (learnerError) throw new Error("Unable to validate learner gallery access.");

    const { data: schoolClass, error: classError } = learner
      ? await service.from("school_classes").select("project_id").eq("id", learner.class_id).maybeSingle()
      : { data: null, error: null };
    if (classError) throw new Error("Unable to validate learner project.");

    const { data: project, error: projectError } = schoolClass
      ? await service.from("school_projects").select("school_id, status").eq("id", schoolClass.project_id).maybeSingle()
      : { data: null, error: null };
    if (projectError) throw new Error("Unable to validate learner project.");

    const { data: school, error: schoolError } = project
      ? await service.from("schools").select("is_active").eq("id", project.school_id).maybeSingle()
      : { data: null, error: null };
    if (schoolError) throw new Error("Unable to validate learner school.");

    const { data: publishedPhoto, error: photoError } = learner
      ? await service.from("school_photos")
        .select("id")
        .eq("learner_id", learner.id)
        .eq("is_published", true)
        .eq("is_archived", false)
        .limit(1)
        .maybeSingle()
      : { data: null, error: null };
    if (photoError) throw new Error("Unable to validate published learner photos.");

    if (!learner?.is_active || learner.consent_status !== "approved" ||
        !school || !school.is_active || !project || project.status !== "active" || !publishedPhoto) {
      throw new HttpError(
        409,
        "gallery_not_ready",
        "A direct link is available only for an active learner with approved consent and published photos.",
      );
    }

    const accessToken = createParentToken();
    const tokenHash = await keyedHash(`parent-session:${accessToken}`);
    const expiresAt = new Date(Date.now() + shareLifetimeMs).toISOString();
    const { error: sessionError } = await service.from("parent_sessions").insert({
      token_hash: tokenHash,
      learner_id: learner.id,
      expires_at: expiresAt,
    });
    if (sessionError) throw new Error("Unable to create the parent gallery share link.");

    const { error: auditError } = await service.from("admin_audit_log").insert({
      actor_id: admin.id,
      action: "CREATE_PARENT_SHARE_LINK",
      resource_table: "parent_sessions",
      resource_id: learner.id,
    });
    if (auditError) {
      const { error: revokeError } = await service.from("parent_sessions")
        .update({ revoked_at: new Date().toISOString() })
        .eq("token_hash", tokenHash);
      if (revokeError) throw new Error("Unable to audit or revoke the newly created gallery link.");
      throw new Error("Unable to audit the gallery link creation; the link was revoked.");
    }

    return { accessToken, expiresAt };
  })
);
