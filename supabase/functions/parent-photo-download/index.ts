import { HttpError, serveJson } from "../_shared/http.ts";
import { requireParentSession } from "../_shared/parent-session.ts";
import { createServiceClient } from "../_shared/supabase.ts";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const downloadUrlLifetimeSeconds = 120;

Deno.serve((request) =>
  serveJson(request, "parent-photo-download", async (_req, body) => {
    if (typeof body.requestId !== "string" || !uuidPattern.test(body.requestId)) {
      throw new HttpError(400, "invalid_download_request", "Select an approved download request.");
    }

    const service = createServiceClient();
    const session = await requireParentSession(service, body.accessToken);
    const { data, error } = await service.rpc("consume_photo_download", {
      p_request_id: body.requestId,
      p_learner_id: session.learner_id,
    });
    if (error) {
      if (error.message.includes("not approved") ||
          error.message.includes("limit reached") ||
          error.message.includes("disabled") ||
          error.message.includes("payment must be verified")) {
        throw new HttpError(403, "download_unavailable", "This download is not currently available.");
      }
      if (error.message.includes("learner access")) {
        throw new HttpError(403, "gallery_unavailable", "This learner gallery is not available.");
      }
      throw new Error("Unable to issue the secure download.");
    }
    const result = Array.isArray(data) ? data[0] : data;
    if (!result || typeof result.storage_path !== "string") {
      throw new Error("The secure download could not be confirmed.");
    }

    const { data: signed, error: signedError } = await service.storage
      .from("learner-photos")
      .createSignedUrl(result.storage_path, downloadUrlLifetimeSeconds, { download: true });
    if (signedError || !signed?.signedUrl) {
      throw new Error("Unable to prepare a secure photo download.");
    }
    return {
      downloadUrl: signed.signedUrl,
      expiresInSeconds: downloadUrlLifetimeSeconds,
      remainingDownloads: Math.max(0, 5 - Number(result.download_count)),
    };
  })
);
