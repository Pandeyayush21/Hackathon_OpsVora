// Workspace access modes, derived from billing state. Pure — safe on client and server.
//
//   full      active or trialing: everything the role allows
//   grace     past due for GRACE_DAYS or fewer: full access + warning
//   readonly  past due longer, or canceled: reads only
//   blocked   suspended by the OpsVora team

import { featureOf, isWritePermission, type PermissionKey } from '@/lib/registry/catalog';
import type { Entitlements } from './resolve';
import { roleCan, type RoleGrants } from './roles-core';

/** Days a past-due workspace keeps full access. */
export const GRACE_DAYS = 7;

const DAY_MS = 86_400_000;

export type AccessMode = 'full' | 'grace' | 'readonly' | 'blocked';

type ModeInput = Pick<Entitlements, 'isSuspended' | 'subscriptionStatus' | 'pastDueSince'>;

export function accessMode(ent: ModeInput, now: Date = new Date()): AccessMode {
    if (ent.isSuspended) return 'blocked';
    if (ent.subscriptionStatus === 'canceled') return 'readonly';
    if (ent.subscriptionStatus === 'past_due') {
        // No start date means we can't tell how long it has been — keep them working.
        if (!ent.pastDueSince) return 'grace';
        const days = (now.getTime() - new Date(ent.pastDueSince).getTime()) / DAY_MS;
        return days <= GRACE_DAYS ? 'grace' : 'readonly';
    }
    return 'full';
}

/** Whole days of grace left (0 on the last day), or null when not in grace. */
export function graceDaysLeft(ent: ModeInput, now: Date = new Date()): number | null {
    if (accessMode(ent, now) !== 'grace' || !ent.pastDueSince) return null;
    const end = new Date(ent.pastDueSince).getTime() + GRACE_DAYS * DAY_MS;
    return Math.max(0, Math.ceil((end - now.getTime()) / DAY_MS));
}

/** Whole days until the trial ends, or null when not trialing. */
export function trialDaysLeft(ent: Pick<Entitlements, 'subscriptionStatus' | 'currentPeriodEnd'>, now: Date = new Date()): number | null {
    if (ent.subscriptionStatus !== 'trialing' || !ent.currentPeriodEnd) return null;
    return Math.max(0, Math.ceil((new Date(ent.currentPeriodEnd).getTime() - now.getTime()) / DAY_MS));
}

export type DenyCode = 'AGENCY_SUSPENDED' | 'FEATURE_NOT_IN_PLAN' | 'FORBIDDEN' | 'READ_ONLY';

export const DENY: Record<DenyCode, { status: number; message: string }> = {
    AGENCY_SUSPENDED: { status: 423, message: 'This workspace is paused. Contact support.' },
    FEATURE_NOT_IN_PLAN: { status: 402, message: 'This feature is not included in your plan' },
    FORBIDDEN: { status: 403, message: 'You do not have permission to do this' },
    READ_ONLY: { status: 423, message: 'Your workspace is read-only. Update billing to continue.' },
};

/**
 * The one access rule, shared by API routes (requireAccess) and pages (requirePageAccess).
 * Returns null when allowed.
 */
/** Once membership and the role grant are known: plan, then read-only writes. */
export function evaluateGranted(input: {
    mode: AccessMode;
    features: Record<string, boolean>;
    granted: boolean;
    permission: PermissionKey | string;
}): DenyCode | null {
    if (input.mode === 'blocked') return 'AGENCY_SUSPENDED';
    if (input.features[featureOf(input.permission)] !== true) return 'FEATURE_NOT_IN_PLAN';
    if (!input.granted) return 'FORBIDDEN';
    if (input.mode === 'readonly' && isWritePermission(input.permission)) return 'READ_ONLY';
    return null;
}

export function evaluateAccess(input: {
    mode: AccessMode;
    features: Record<string, boolean>;
    grants: RoleGrants;
    role: string;
    permission: PermissionKey;
}): DenyCode | null {
    return evaluateGranted({
        mode: input.mode,
        features: input.features,
        granted: roleCan(input.grants, input.role, input.permission),
        permission: input.permission,
    });
}
