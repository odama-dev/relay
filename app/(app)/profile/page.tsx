import { requireUser, asUser } from "@/lib/auth";
import { roleLabel, employmentLabel } from "@/lib/roles";
import { MUTABLE_NOTIFICATION_TYPES, NOTIFICATION_TYPES } from "@/lib/notify";
import { PageHeader } from "@/components/page-header";
import { ProfileForm } from "./profile-form";

export const metadata = { title: "Profile" };

export default async function ProfilePage() {
  const user = await requireUser();
  const profile = await asUser(user, (tx) => tx.profile.findUniqueOrThrow({ where: { id: user.id } }));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col">
      <PageHeader
        title="Profile"
        description={`${roleLabel(profile.role)} · ${employmentLabel(profile.employmentType)}${profile.isAdmin ? " · Admin" : ""}. Role and employment type are managed by HR.`}
      />
      <ProfileForm
        initial={{
          fullName: profile.fullName,
          avatarUrl: profile.avatarUrl ?? "",
          timezone: profile.timezone,
          mutedNotifications: profile.mutedNotifications,
        }}
        email={profile.email}
        slackLinked={Boolean(profile.slackUserId)}
        timezones={Intl.supportedValuesOf("timeZone")}
        notificationTypes={MUTABLE_NOTIFICATION_TYPES.map((t) => ({ value: t, label: NOTIFICATION_TYPES[t] }))}
      />
    </div>
  );
}
