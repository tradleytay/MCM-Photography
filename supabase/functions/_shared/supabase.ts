import { createClient } from "npm:@supabase/supabase-js@2";
import { HttpError } from "./http.ts";

function getRequiredEnvironment(name: string, fallbackName?: string): string {
  const value = Deno.env.get(name) ?? (fallbackName ? Deno.env.get(fallbackName) : undefined);
  if (!value) {
    throw new HttpError(503, "service_not_configured", "The backend service is not configured.");
  }
  return value;
}

export function createServiceClient() {
  return createClient(
    getRequiredEnvironment("SUPABASE_URL"),
    getRequiredEnvironment("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

export async function requireAdmin(request: Request): Promise<{ id: string; email?: string }> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new HttpError(401, "unauthorized", "Sign in with an administrator account.");
  }

  const authClient = createClient(
    getRequiredEnvironment("SUPABASE_URL"),
    getRequiredEnvironment("SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEY"),
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: authorization } },
    },
  );
  const { data, error } = await authClient.auth.getUser();
  if (error || !data.user) {
    throw new HttpError(401, "unauthorized", "Sign in with an administrator account.");
  }
  if (data.user.app_metadata?.role !== "admin") {
    throw new HttpError(403, "forbidden", "Administrator access is required.");
  }
  return { id: data.user.id, email: data.user.email };
}
 
