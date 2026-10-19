import { checkInvitation } from "@/lib/people/accounts";
import { AuthNotice, AuthShell } from "../../auth-shell";
import { AcceptInviteForm } from "./accept-invite-form";

export const metadata = { title: "Join Odama OS" };
export const dynamic = "force-dynamic";

const REASONS = {
  invalid: "This invitation link isn't valid. It may have been replaced by a newer one.",
  expired: "This invitation has expired. Ask HR or an admin to send you a new one.",
  used: "This invitation was already used. Sign in with your email and password.",
};

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const check = await checkInvitation(token);

  if (!check.ok) {
    return (
      <AuthShell title="Invitation unavailable">
        <AuthNotice>{REASONS[check.reason]}</AuthNotice>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={`Welcome, ${check.fullName}`}
      description={
        <>
          Create a password for <span className="text-foreground">{check.email}</span> to join Odama OS.
        </>
      }
    >
      <AcceptInviteForm token={token} className="mt-6" />
    </AuthShell>
  );
}
