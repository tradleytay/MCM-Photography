import { HttpError, serveJson } from "../_shared/http.ts";
import { keyedHash } from "../_shared/crypto.ts";
import { createServiceClient } from "../_shared/supabase.ts";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

Deno.serve((request) =>
  serveJson(request, "create-booking", async (req, body) => {
    const clientName = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const serviceType = typeof body.serviceType === "string" ? body.serviceType.trim() : "";
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const preferredDate = body.preferredDate === "" || body.preferredDate == null
      ? null
      : body.preferredDate;

    if (clientName.length < 2 || clientName.length > 120 ||
        !emailPattern.test(email) || email.length > 254 ||
        phone.length > 40 || serviceType.length < 2 || serviceType.length > 100 ||
        message.length < 1 || message.length > 5000 ||
        (preferredDate !== null &&
          !validDate(preferredDate))) {
      throw new HttpError(400, "invalid_booking", "Check the booking details and try again.");
    }

    const ipAddress = req.headers.get("cf-connecting-ip") ??
      req.headers.get("x-real-ip") ?? "unknown";
    const ipHash = await keyedHash(`booking-ip:${ipAddress}`);
    const service = createServiceClient();
    const { data: allowed, error: rateLimitError } = await service.rpc(
      "consume_public_booking_attempt",
      { p_ip_hash: ipHash },
    );
    if (rateLimitError) {
      throw new Error("Unable to check booking request limits.");
    }
    if (!allowed) {
      throw new HttpError(429, "too_many_requests", "Too many booking requests. Please try again later.");
    }

    const { data, error } = await service
      .from("bookings")
      .insert({
        client_name: clientName,
        email,
        phone,
        service_type: serviceType,
        preferred_date: preferredDate,
        message,
      })
      .select("booking_code")
      .single();
    if (error || !data) {
      throw new Error("Unable to save the booking request.");
    }

    return { bookingCode: data.booking_code };
  })
);
