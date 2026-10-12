import { revalidateTag } from 'next/cache';

export const ACCESS_TAGS = {
    entitlements: 'entitlements',
    agency: (agencyId: string) => `entitlements:${agencyId}`,
    rbac: 'rbac',
} as const;

const NOW = { expire: 0 };

/** Call after any write that changes what an agency (or every agency) is entitled to. */
export function invalidateEntitlements(agencyId?: string) {
    revalidateTag(agencyId ? ACCESS_TAGS.agency(agencyId) : ACCESS_TAGS.entitlements, NOW);
}

/** Call after any change to role_permissions. */
export function invalidateRbac() {
    revalidateTag(ACCESS_TAGS.rbac, NOW);
}
