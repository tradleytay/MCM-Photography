import { HttpError, serveJson } from "../_shared/http.ts";
import { requireParentSession } from "../_shared/parent-session.ts";
import { createServiceClient } from "../_shared/supabase.ts";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve((request) =>
  serveJson(request, "parent-download-request", async (_req, body) => {
    if (typeof body.orderId !== "string" || !uuidPattern.test(body.orderId) ||
        typeof body.photoId !== "string" || !uuidPattern.test(body.photoId)) {
      throw new HttpError(400, "invalid_download_request", "Select an eligible order and photograph.");
    }

    const service = createServiceClient();
    const session = await requireParentSession(service, body.accessToken);
    const { data: learner, error: learnerError } = await service
      .from("learners")
      .select("id, is_active, consent_status")
      .eq("id", session.learner_id)
      .maybeSingle();
    if (learnerError) throw new Error("Unable to validate learner access.");
    if (!learner || !learner.is_active || learner.consent_status !== "approved") {
      throw new HttpError(403, "gallery_unavailable", "This learner gallery is not available.");
    }

    const { data: orderItem, error: itemError } = await service
      .from("parent_order_items")
      .select("order_id, photo_id, parent_orders!inner(id, learner_id, status)")
      .eq("order_id", body.orderId)
      .eq("photo_id", body.photoId)
      .eq("parent_orders.learner_id", session.learner_id)
      .maybeSingle();
    if (itemError) throw new Error("Unable to validate the order and photograph.");
    if (!orderItem || orderItem.parent_orders.status === "cancelled") {
      throw new HttpError(404, "download_not_found", "This photograph is not available for download.");
    }

    const { data: photo, error: photoError } = await service
      .from("school_photos")
      .select("id, learner_id, is_archived, storage_path")
      .eq("id", body.photoId)
      .eq("learner_id", session.learner_id)
      .maybeSingle();
    if (photoError) throw new Error("Unable to validate the photograph.");
    if (!photo || photo.is_archived) {
      throw new HttpError(404, "download_not_found", "This photograph is not available for download.");
    }

    const { data: settings, error: settingsError } = await service
      .from("studio_settings")
      .select("download_policy")
      .eq("singleton", true)
      .single();
    if (settingsError) throw new Error("Unable to check the digital download policy.");
    if (settings.download_policy === "disabled") {
      throw new HttpError(403, "downloads_disabled", "Digital downloads are not available for this gallery.");
    }

    const { data: payment, error: paymentError } = await service
      .from("order_payments")
      .select("id")
      .eq("order_id", body.orderId)
      .eq("status", "verified")
      .maybeSingle();
    if (paymentError) throw new Error("Unable to validate payment.");
    const status = settings.download_policy === "paid" && payment ? "approved" : "pending";
    if (settings.download_policy === "paid" && !payment) {
      throw new HttpError(403, "payment_required", "Digital downloads are available after payment verification.");
    }

    const { data: existing, error: existingError } = await service
      .from("photo_download_requests")
      .select("id, status, download_count")
      .eq("order_id", body.orderId)
      .eq("photo_id", body.photoId)
      .maybeSingle();
    if (existingError) throw new Error("Unable to load the download request.");
    if (existing && existing.status === "pending" && status === "approved") {
      const { data, error } = await service
        .from("photo_download_requests")
        .update({
          status: "approved",
          approved_by: null,
          approved_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .select("id, status, download_count")
        .single();
      if (error || !data) throw new Error("Unable to approve the paid download request.");
      return { requestId: data.id, status: data.status, downloadCount: data.download_count };
    }
    if (existing && existing.status !== "rejected") {
      return { requestId: existing.id, status: existing.status, downloadCount: existing.download_count };
    }

    if (existing) {
      const { data, error } = await service
        .from("photo_download_requests")
        .update({
          status,
          approved_by: null,
          approved_at: status === "approved" ? new Date().toISOString() : null,
          download_count: 0,
          last_downloaded_at: null,
        })
        .eq("id", existing.id)
        .select("id, status, download_count")
        .single();
      if (error || !data) throw new Error("Unable to resubmit the download request.");
      return { requestId: data.id, status: data.status, downloadCount: data.download_count };
    }

    const { data, error } = await service
      .from("photo_download_requests")
      .insert({
        order_id: body.orderId,
        learner_id: session.learner_id,
        photo_id: body.photoId,
        status,
        approved_at: status === "approved" ? new Date().toISOString() : null,
      })
      .select("id, status, download_count")
      .single();
    if (error || !data) throw new Error("Unable to create the download request.");
    return { requestId: data.id, status: data.status, downloadCount: data.download_count };
  })
);
