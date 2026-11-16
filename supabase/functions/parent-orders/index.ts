import { HttpError, serveJson } from "../_shared/http.ts";
import { requireParentSession } from "../_shared/parent-session.ts";
import { createServiceClient } from "../_shared/supabase.ts";

Deno.serve((request) =>
  serveJson(request, "parent-orders", async (_req, body) => {
    const service = createServiceClient();
    const session = await requireParentSession(service, body.accessToken);
    const { data: learner, error: learnerError } = await service
      .from("learners")
      .select("id, class_id, is_active, consent_status")
      .eq("id", session.learner_id)
      .maybeSingle();
    if (learnerError) {
      throw new Error("Unable to validate learner access.");
    }
    if (!learner || !learner.is_active || learner.consent_status !== "approved") {
      throw new HttpError(401, "parent_access_expired", "Your gallery access is no longer available.");
    }
    const { data: schoolClass, error: classError } = await service
      .from("school_classes")
      .select("project_id")
      .eq("id", learner.class_id)
      .maybeSingle();
    if (classError || !schoolClass) {
      throw new Error("Unable to validate learner class.");
    }
    const { data: project, error: projectError } = await service
      .from("school_projects")
      .select("school_id, status")
      .eq("id", schoolClass.project_id)
      .maybeSingle();
    if (projectError || !project) {
      throw new Error("Unable to validate learner project.");
    }
    const { data: school, error: schoolError } = await service
      .from("schools")
      .select("is_active")
      .eq("id", project.school_id)
      .maybeSingle();
    if (schoolError || !school) {
      throw new Error("Unable to validate learner school.");
    }
    if (!school.is_active || project.status !== "active") {
      throw new HttpError(403, "gallery_unavailable", "This learner gallery is not available.");
    }
    const { data: orders, error } = await service
      .from("parent_orders")
      .select("id, order_code, status, production_status, delivery_status, created_at, updated_at")
      .eq("learner_id", session.learner_id)
      .order("created_at", { ascending: false });
    if (error) {
      throw new Error("Unable to load order requests.");
    }

    if (!orders?.length) {
      return { orders: [] };
    }
    const { data: items, error: itemsError } = await service
      .from("parent_order_items")
      .select("order_id, item_type, photo_id, package_id, title_snapshot, unit_price_cents")
      .in("order_id", orders.map((order) => order.id));
    if (itemsError) {
      throw new Error("Unable to load order items.");
    }
    const { data: downloads, error: downloadsError } = await service
      .from("photo_download_requests")
      .select("id, order_id, photo_id, status, download_count")
      .eq("learner_id", session.learner_id)
      .in("order_id", orders.map((order) => order.id));
    if (downloadsError) {
      throw new Error("Unable to load photo download requests.");
    }
    return {
      orders: orders.map((order) => ({
        ...order,
        items: (items ?? []).filter((item) => item.order_id === order.id),
        downloads: (downloads ?? []).filter((download) => download.order_id === order.id),
      })),
    };
  })
);
