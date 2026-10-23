import "server-only";
import type { AccessLevel, AppModule, Division, EmploymentType, Prisma, UserRole, UserStatus } from "@prisma/client";
import { asUser, type CurrentUser } from "@/lib/auth";
import { USER_ROLES } from "@/lib/roles";

export type PersonRow = {
  id: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
  role: UserRole;
  isAdmin: boolean;
  employmentType: EmploymentType;
  status: UserStatus;
  slackLinked: boolean;
  timezone: string;
  jobRoleId: string | null;
  jobRoleName: string | null;
  division: Division | null;
  level: number | null;
  jobTitle: string | null;
  accessLevel: AccessLevel;
  managerId: string | null;
  managerName: string | null;
  modules: AppModule[];
};

export type PeopleFilters = { q?: string; role?: UserRole; status: UserStatus };

const STATUSES: UserStatus[] = ["active", "invited", "deactivated"];

export function parsePeopleFilters(sp: Record<string, string | string[] | undefined>, canManage: boolean): PeopleFilters {
  const get = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const role = get("role");
  const status = get("status");
  return {
    q: get("q")?.trim() || undefined,
    role: USER_ROLES.includes(role as UserRole) ? (role as UserRole) : undefined,
    // Only HR / admins look past the active directory (M0.3).
    status: canManage && STATUSES.includes(status as UserStatus) ? (status as UserStatus) : "active",
  };
}

export async function listPeople(user: CurrentUser, filters: PeopleFilters): Promise<PersonRow[]> {
  const where: Prisma.ProfileWhereInput = {
    status: filters.status,
    ...(filters.role ? { role: filters.role } : {}),
    ...(filters.q
      ? {
          OR: [
            { fullName: { contains: filters.q, mode: "insensitive" } },
            { email: { contains: filters.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const rows = await asUser(user, (tx) =>
    tx.profile.findMany({
      where,
      orderBy: { fullName: "asc" },
      include: {
        jobRole: { select: { name: true } },
        manager: { select: { fullName: true } },
        modules: { select: { module: true } },
      },
    }),
  );
  return rows.map((p) => ({
    id: p.id,
    fullName: p.fullName,
    email: p.email,
    avatarUrl: p.avatarUrl,
    role: p.role,
    isAdmin: p.isAdmin,
    employmentType: p.employmentType,
    status: p.status,
    slackLinked: Boolean(p.slackUserId),
    timezone: p.timezone,
    jobRoleId: p.jobRoleId,
    jobRoleName: p.jobRole?.name ?? null,
    division: p.division,
    level: p.level,
    jobTitle: p.jobTitle,
    accessLevel: p.accessLevel,
    managerId: p.managerId,
    managerName: p.manager?.fullName ?? null,
    modules: p.modules.map((m) => m.module),
  }));
}

export type PersonOption = { id: string; name: string; role: UserRole };

/**
 * Active people for pickers (owner, collaborators, members, PM). Deactivated
 * users never appear here (M0.4) but keep showing in history.
 */
export async function activePeopleOptions(user: CurrentUser, roles?: UserRole[]): Promise<PersonOption[]> {
  const rows = await asUser(user, (tx) =>
    tx.profile.findMany({
      where: { status: "active", ...(roles ? { role: { in: roles } } : {}) },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, role: true },
    }),
  );
  return rows.map((p) => ({ id: p.id, name: p.fullName, role: p.role }));
}

export type JobRoleOption = { id: string; name: string; division: Division; level: number; defaultAccess: AccessLevel; defaultModules: AppModule[] };

/** Active job roles for the person dialog (Phase 2 catalogue). */
export async function jobRoleOptions(user: CurrentUser): Promise<JobRoleOption[]> {
  const rows = await asUser(user, (tx) =>
    tx.jobRole.findMany({ where: { archivedAt: null }, orderBy: [{ division: "asc" }, { level: "asc" }, { name: "asc" }] }),
  );
  return rows.map((r) => ({ id: r.id, name: r.name, division: r.division, level: r.level, defaultAccess: r.defaultAccess, defaultModules: r.defaultModules }));
}
