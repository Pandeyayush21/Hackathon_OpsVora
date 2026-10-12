import { defaultGrant, PERMISSIONS, roleApplies, type PermissionKey } from '@/lib/registry/catalog';

/** role → permission → granted, as stored in role_permissions. */
export type RoleGrants = Record<string, Record<string, boolean>>;

/** DB grant if present, otherwise the catalog default (covers not-yet-synced permissions). */
export function roleCan(grants: RoleGrants, role: string, permission: PermissionKey | string): boolean {
    if (!roleApplies(role, permission)) return false;
    const explicit = grants[role]?.[permission];
    return explicit ?? defaultGrant(role, permission);
}

/** Every permission key granted to a role — used to hydrate client-side AccessProvider. */
export function permissionsForRole(grants: RoleGrants, role: string): PermissionKey[] {
    return PERMISSIONS.filter((p) => roleCan(grants, role, p.key)).map((p) => p.key);
}
