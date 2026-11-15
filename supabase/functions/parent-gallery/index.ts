import { serveJson, HttpError } from "../_shared/http.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { requireParentSession } from "../_shared/parent-session.ts";

const photoUrlLifetimeSeconds = 300;

Deno.serve((request) =>
  serveJson(request, "parent-gallery", async (_req, body) => {
    const service = createServiceClient();
    const session = await requireParentSession(service, body.accessToken);
    const { data: learner, error: learnerError } = await service
      .from("learners")
      .select("id, display_name, class_id, is_active, consent_status")
      .eq("id", session.learner_id)
      .maybeSingle();
    if (learnerError) {
      throw new Error("Unable to load learner gallery.");
    }
    if (!learner || !learner.is_active || learner.consent_status !== "approved") {
      throw new HttpError(401, "parent_access_expired", "Your gallery access is no longer available.");
    }

    const { data: schoolClass, error: classError } = await service
      .from("school_classes")
      .select("name, project_id")
      .eq("id", learner.class_id)
      .maybeSingle();
    if (classError || !schoolClass) {
      throw new Error("Unable to load learner class.");
    }
    const { data: project, error: projectError } = await service
      .from("school_projects")
      .select("name, school_id, status")
      .eq("id", schoolClass.project_id)
      .maybeSingle();
    if (projectError || !project) {
      throw new Error("Unable to load school project.");
    }
    const { data: school, error: schoolError } = await service
      .from("schools")
      .select("name, is_active")
      .eq("id", project.school_id)
      .maybeSingle();
    if (schoolError || !school) {
      throw new Error("Unable to load school.");
    }
    if (!school.is_active || project.status !== "active") {
      throw new HttpError(403, "gallery_unavailable", "This learner gallery is not available.");
    }

    const { data: photos, error: photosError } = await service
      .from("school_photos")
      .select("id, title, storage_path, display_order")
      .eq("learner_id", learner.id)
      .eq("is_published", true)
      .order("display_order", { ascending: true })
      .limit(100);
    if (photosError || !photos) {
      throw new Error("Unable to load learner photographs.");
    }

    const signedPhotos = await Promise.all(photos.map(async (photo) => {
      const { data, error } = await service.storage
        .from("learner-photos")
        .createSignedUrl(photo.storage_path, photoUrlLifetimeSeconds);
      if (error || !data?.signedUrl) {
        throw new Error("Unable to prepare a private photograph.");
      }
      return { id: photo.id, title: photo.title, url: data.signedUrl };
    }));

    const { error: sessionUpdateError } = await service
      .from("parent_sessions")
      .update({ last_used_at: new Date().toISOString() })
      .eq("token_hash", session.token_hash);
    if (sessionUpdateError) {
      throw new Error("Unable to update parent session.");
    }

    return {
      learner: {
        name: learner.display_name,
        school: school.name,
        project: project.name,
        className: schoolClass.name,
      },
      photos: signedPhotos,
      accessExpiresAt: session.expires_at,
    };
  })
);
