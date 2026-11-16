import { HttpError, serveJson } from "../_shared/http.ts";
import { createServiceClient, requireAdmin } from "../_shared/supabase.ts";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const inviteRedirect = "https://mcm-photography.vercel.app/admin/set-password.html";
const suspensionDuration = "876000h";

async function writeAdminAudit(
  service: ReturnType<typeof createServiceClient>,
  adminId: string,
  action: string,
  userId: string,
) {
  const { error } = await service.from("admin_audit_log").insert({
    actor_id: adminId,
    action,
    resource_table: "auth.users",
    resource_id: userId,
  });
  if (error) {
    throw new Error("The administrator account changed, but its audit event could not be saved.");
  }
}

Deno.serve((request) =>
  serveJson(request, "admin-manage-users", async (req, body) => {
    const admin = await requireAdmin(req);
    const service = createServiceClient();
    const action = body.action;

    if (action === "list") {
      const { data, error } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (error) throw new Error("Unable to load administrator accounts.");
      return {
        users: data.users
          .filter((user) => user.app_metadata?.role === "admin")
          .map((user) => ({
            id: user.id,
            email: user.email ?? "",
            created_at: user.created_at,
            last_sign_in_at: user.last_sign_in_at ?? null,
            banned_until: user.banned_until ?? null,
          })),
      };
    }

    if (action === "invite") {
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      if (!emailPattern.test(email) || email.length > 254) {
        throw new HttpError(400, "invalid_email", "Enter a valid administrator email address.");
      }
      const { data, error } = await service.auth.admin.inviteUserByEmail(email, {
        redirectTo: inviteRedirect,
      });
      if (error || !data.user) {
        throw new Error("Unable to invite this administrator account.");
      }
      const { error: roleError } = await service.auth.admin.updateUserById(data.user.id, {
        app_metadata: { ...data.user.app_metadata, role: "admin" },
      });
      if (roleError) {
        throw new Error("The invitation was created, but the administrator role could not be assigned. Do not send another invite until this account is corrected in Supabase Auth.");
      }
      await writeAdminAudit(service, admin.id, "INVITE_ADMIN", data.user.id);
      return { invited: true, email };
    }

    if (action === "suspend" || action === "reinstate") {
      const userId = typeof body.userId === "string" ? body.userId : "";
      if (!uuidPattern.test(userId)) {
        throw new HttpError(400, "invalid_user", "Select an administrator account.");
      }
      if (userId === admin.id) {
        throw new HttpError(400, "cannot_change_self", "You cannot suspend or reinstate your own administrator account.");
      }

      const { data, error } = await service.auth.admin.getUserById(userId);
      if (error || !data.user) throw new HttpError(404, "admin_not_found", "Administrator account not found.");
      if (data.user.app_metadata?.role !== "admin") {
        throw new HttpError(403, "not_an_admin", "Only administrator accounts can be managed here.");
      }

      if (action === "suspend") {
        const { data: users, error: listError } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
        if (listError) throw new Error("Unable to verify that another administrator can remain active.");
        const activeAdmins = users.users.filter((user) =>
          user.app_metadata?.role === "admin" &&
          (!user.banned_until || new Date(user.banned_until).getTime() <= Date.now())
        );
        if (activeAdmins.length <= 1) {
          throw new HttpError(400, "last_admin", "The last active administrator cannot be suspended.");
        }
      }

      const appMetadata = { ...data.user.app_metadata };
      if (action === "suspend") {
        appMetadata.role = "admin";
        appMetadata.admin_suspended = true;
      } else {
        appMetadata.role = "admin";
        appMetadata.admin_suspended = false;
      }
      const { error: updateError } = await service.auth.admin.updateUserById(userId, {
        app_metadata: appMetadata,
        ban_duration: action === "suspend" ? suspensionDuration : "none",
      });
      if (updateError) throw new Error("Unable to update the administrator account.");
      await writeAdminAudit(
        service,
        admin.id,
        action === "suspend" ? "SUSPEND_ADMIN" : "REINSTATE_ADMIN",
        userId,
      );
      return { userId, status: action === "suspend" ? "suspended" : "active" };
    }

    throw new HttpError(400, "invalid_action", "Choose a supported administrator account action.");
  })
);
