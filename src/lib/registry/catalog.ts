// ============================================
// OpsVora Feature Registry — code catalog
//
// Code DECLARES what exists (features, their permissions, limits, roles).
// The DB DECIDES who gets what (plan ↔ feature, role ↔ permission, overrides),
// editable from /super-admin. Run "Sync registry" after changing this file.
//
// See src/lib/registry/README.md for how to add a feature.
// ============================================

// ---- Roles (fixed set; keys match profiles.role) ----

export const ROLES = [
    { key: 'admin', name: 'Agency Admin', portal: 'agency', description: 'Owns the agency workspace. Full access.' },
    { key: 'manager', name: 'Manager', portal: 'agency', description: 'Runs day-to-day operations. No billing or workspace settings.' },
    { key: 'creator', name: 'Team Member', portal: 'team', description: 'Works on assigned tasks and deliverables.' },
    { key: 'client', name: 'Client', portal: 'client', description: 'Views their projects, deliverables and invoices in the branded portal.' },
] as const;

export type RoleKey = (typeof ROLES)[number]['key'];
export type Portal = 'agency' | 'team' | 'client';
export type FeatureStatus = 'available' | 'beta' | 'coming_soon' | 'deprecated';
export type FeatureCategory = 'core' | 'people' | 'clients' | 'work' | 'finance' | 'collaboration';

export const ROLE_KEYS = ROLES.map((r) => r.key) as readonly RoleKey[];

// ---- Feature definitions ----

export type PermissionKind = 'read' | 'write';

interface PermissionDef {
    label: string;
    /** Roles granted this permission by default (admin can change in /super-admin/roles). */
    roles: readonly RoleKey[];
    /** Writes are refused while a workspace is read-only. Defaults from the action (see kindOfAction). */
    kind?: PermissionKind;
    /**
     * Old keys of this permission. Sync copies their role grants to this key and
     * marks the old key inactive, so a rename never loses admin edits.
     */
    renamedFrom?: readonly string[];
}

const READ_ACTIONS = new Set(['view', 'access']);

export function kindOfAction(action: string): PermissionKind {
    return READ_ACTIONS.has(action) ? 'read' : 'write';
}

interface FeatureDef {
    name: string;
    description: string;
    category: FeatureCategory;
    portals: readonly Portal[];
    /** Default status on first sync. After that, status is owned by the DB (admin-editable). */
    status: FeatureStatus;
    /** Core features are on for any plan that has no explicit row (e.g. a newly created plan). */
    isCore: boolean;
    permissions: Record<string, PermissionDef>;
}

const ALL: readonly RoleKey[] = ['admin', 'manager', 'creator', 'client'];
const STAFF: readonly RoleKey[] = ['admin', 'manager', 'creator'];
const LEADS: readonly RoleKey[] = ['admin', 'manager'];
const OWNER: readonly RoleKey[] = ['admin'];

export const FEATURE_DEFS = {
    dashboard: {
        name: 'Dashboard',
        description: 'Overview of workspace activity.',
        category: 'core',
        portals: ['agency', 'team', 'client'],
        status: 'available',
        isCore: true,
        permissions: {
            view: { label: 'View dashboard', roles: ALL },
        },
    },
    settings: {
        name: 'Workspace Settings',
        description: 'Agency profile, preferences and integrations.',
        category: 'core',
        portals: ['agency'],
        status: 'available',
        isCore: true,
        permissions: {
            view: { label: 'View settings', roles: LEADS },
            update: { label: 'Update settings', roles: OWNER },
        },
    },
    branding: {
        name: 'Branded Portals',
        description: 'Agency logo and theme applied to agency, team and client portals.',
        category: 'core',
        portals: ['agency', 'team', 'client'],
        status: 'available',
        isCore: true,
        permissions: {
            view: { label: 'View branding', roles: LEADS },
            update: { label: 'Update logo & theme', roles: OWNER },
        },
    },
    notifications: {
        name: 'Notifications',
        description: 'In-app and email notifications.',
        category: 'core',
        portals: ['agency', 'team', 'client'],
        status: 'available',
        isCore: true,
        permissions: {
            view: { label: 'Receive notifications', roles: ALL },
        },
    },
    team: {
        name: 'Team Management',
        description: 'Invite, manage and remove team members.',
        category: 'people',
        portals: ['agency'],
        status: 'available',
        isCore: true,
        permissions: {
            view: { label: 'View team', roles: LEADS },
            invite: { label: 'Invite team members', roles: OWNER },
            update: { label: 'Change member roles', roles: OWNER },
            remove: { label: 'Remove team members', roles: OWNER },
        },
    },
    leaves: {
        name: 'Leave Management',
        description: 'Team leave requests and approvals.',
        category: 'people',
        portals: ['agency', 'team'],
        status: 'available',
        isCore: false,
        permissions: {
            view: { label: 'View leave calendar', roles: STAFF },
            request: { label: 'Request leave', roles: STAFF },
            approve: { label: 'Approve / reject leave', roles: LEADS },
        },
    },
    agreements: {
        name: 'Agreements',
        description: 'Offer letters, contracts and NDAs signed online with an audit trail.',
        category: 'people',
        portals: ['agency', 'team', 'client'],
        status: 'available',
        isCore: false,
        permissions: {
            view: { label: 'View agreements', roles: LEADS },
            create: { label: 'Create agreements', roles: LEADS },
            send: { label: 'Send agreements', roles: LEADS },
            void: { label: 'Void agreements', roles: LEADS },
            templates: { label: 'Manage agreement templates', roles: OWNER },
        },
    },
    clients: {
        name: 'Client Management',
        description: 'Client records, contacts and onboarding.',
        category: 'clients',
        portals: ['agency', 'team'],
        status: 'available',
        isCore: true,
        permissions: {
            view: { label: 'View clients', roles: STAFF },
            create: { label: 'Add clients', roles: LEADS },
            update: { label: 'Edit clients', roles: LEADS },
            delete: { label: 'Delete clients', roles: OWNER },
        },
    },
    client_portal: {
        name: 'Client Portal',
        description: 'Branded portal link for clients to view and manage their work.',
        category: 'clients',
        portals: ['agency', 'client'],
        status: 'available',
        isCore: true,
        permissions: {
            access: { label: 'Access client portal', roles: ['client'] },
            manage: { label: 'Invite clients / manage portal access', roles: LEADS },
        },
    },
    projects: {
        name: 'Projects',
        description: 'Group work per client into projects.',
        category: 'work',
        portals: ['agency', 'team', 'client'],
        status: 'available',
        isCore: true,
        permissions: {
            view: { label: 'View projects', roles: ALL },
            create: { label: 'Create projects', roles: LEADS },
            update: { label: 'Edit projects', roles: LEADS },
            delete: { label: 'Delete projects', roles: OWNER },
        },
    },
    tasks: {
        name: 'Team Tasks',
        description: 'Kanban tasks assigned to team members.',
        category: 'work',
        portals: ['agency', 'team'],
        status: 'available',
        isCore: true,
        permissions: {
            view: { label: 'View tasks', roles: STAFF },
            create: { label: 'Create tasks', roles: STAFF },
            update: { label: 'Update tasks', roles: STAFF },
            assign: { label: 'Assign tasks', roles: LEADS },
            delete: { label: 'Delete tasks', roles: LEADS },
        },
    },
    deliverables: {
        name: 'Client Deliverables',
        description: 'Share work with clients for review and approval.',
        category: 'work',
        portals: ['agency', 'team', 'client'],
        status: 'available',
        isCore: false,
        permissions: {
            view: { label: 'View deliverables', roles: ALL },
            create: { label: 'Submit deliverables', roles: STAFF },
            submit: { label: 'Send deliverables to clients', roles: LEADS },
            approve: { label: 'Approve / request changes', roles: ['admin', 'manager', 'client'] },
            delete: { label: 'Delete deliverables', roles: LEADS },
        },
    },
    documents: {
        name: 'Documents',
        description: 'File storage per client and project.',
        category: 'work',
        portals: ['agency', 'team', 'client'],
        status: 'available',
        isCore: true,
        permissions: {
            view: { label: 'View documents', roles: ALL },
            upload: { label: 'Upload documents', roles: STAFF },
            share: { label: 'Share documents with clients', roles: LEADS },
            client_upload: { label: 'Upload files from the client portal', roles: ['client'] },
            delete: { label: 'Delete documents', roles: LEADS },
        },
    },
    invoices: {
        name: 'Invoices',
        description: 'Create, send and track client invoices.',
        category: 'finance',
        portals: ['agency', 'client'],
        status: 'available',
        isCore: false,
        permissions: {
            view: { label: 'View invoices', roles: ['admin', 'manager', 'client'] },
            create: { label: 'Create invoices', roles: LEADS },
            send: { label: 'Send invoices', roles: LEADS },
            record_payment: { label: 'Record payments', roles: LEADS },
            delete: { label: 'Void / delete invoices', roles: OWNER },
        },
    },
    comments: {
        name: 'Comments',
        description: 'Threaded comments with @mentions.',
        category: 'collaboration',
        portals: ['agency', 'team', 'client'],
        status: 'available',
        isCore: true,
        permissions: {
            view: { label: 'View comments', roles: ALL },
            create: { label: 'Post comments', roles: STAFF },
            client: { label: 'Comment in the client portal', roles: ['client'] },
            moderate: { label: 'Delete others comments', roles: LEADS },
        },
    },
} as const satisfies Record<string, FeatureDef>;

export type FeatureKey = keyof typeof FEATURE_DEFS;

type ActionsOf<K extends FeatureKey> = Extract<keyof (typeof FEATURE_DEFS)[K]['permissions'], string>;
export type PermissionKey = { [K in FeatureKey]: `${K}.${ActionsOf<K>}` }[FeatureKey];

// ---- Limits ----

export const LIMIT_DEFS = {
    teamMembers: { label: 'Team members', unit: 'count', period: 'none', default: 2 },
    clients: { label: 'Clients', unit: 'count', period: 'none', default: 3 },
    projects: { label: 'Active projects', unit: 'count', period: 'none', default: 5 },
    storageMB: { label: 'Storage', unit: 'MB', period: 'none', default: 500 },
    agreementsMonthly: { label: 'Agreements sent per month', unit: 'count', period: 'monthly', default: 3 },
} as const satisfies Record<string, { label: string; unit: string; period: 'none' | 'monthly'; default: number }>;

export type LimitKey = keyof typeof LIMIT_DEFS;

/** -1 means unlimited. */
export const UNLIMITED = -1;

// ---- Default plan matrix (seed only — used by sync for rows that don't exist yet) ----

const FREE_FEATURES: FeatureKey[] = [
    'dashboard', 'settings', 'branding', 'notifications', 'team', 'clients',
    'client_portal', 'projects', 'tasks', 'documents', 'comments', 'agreements',
];

export const DEFAULT_PLAN_MATRIX: Record<string, { features: FeatureKey[]; limits: Record<LimitKey, number> }> = {
    free: {
        features: FREE_FEATURES,
        limits: { teamMembers: 2, clients: 3, projects: 5, storageMB: 500, agreementsMonthly: 3 },
    },
    pro: {
        features: [...FREE_FEATURES, 'deliverables', 'invoices', 'leaves'],
        limits: { teamMembers: 15, clients: 50, projects: UNLIMITED, storageMB: 10240, agreementsMonthly: 50 },
    },
    ultra: {
        features: Object.keys(FEATURE_DEFS) as FeatureKey[],
        limits: { teamMembers: UNLIMITED, clients: UNLIMITED, projects: UNLIMITED, storageMB: UNLIMITED, agreementsMonthly: UNLIMITED },
    },
};

// ---- Flattened views ----

export interface CatalogFeature {
    key: FeatureKey;
    name: string;
    description: string;
    category: FeatureCategory;
    portals: readonly Portal[];
    status: FeatureStatus;
    isCore: boolean;
    sortOrder: number;
}

export interface CatalogPermission {
    key: PermissionKey;
    featureKey: FeatureKey;
    action: string;
    label: string;
    defaultRoles: readonly RoleKey[];
    kind: PermissionKind;
    renamedFrom: readonly string[];
    sortOrder: number;
}

export const FEATURES: CatalogFeature[] = (Object.keys(FEATURE_DEFS) as FeatureKey[]).map((key, i) => {
    const def: FeatureDef = FEATURE_DEFS[key];
    return {
        key,
        name: def.name,
        description: def.description,
        category: def.category,
        portals: def.portals,
        status: def.status,
        isCore: def.isCore,
        sortOrder: i,
    };
});

export const PERMISSIONS: CatalogPermission[] = FEATURES.flatMap((f) => {
    const def: FeatureDef = FEATURE_DEFS[f.key];
    return Object.entries(def.permissions).map(([action, p], i) => ({
        key: `${f.key}.${action}` as PermissionKey,
        featureKey: f.key,
        action,
        label: p.label,
        defaultRoles: p.roles,
        kind: p.kind ?? kindOfAction(action),
        renamedFrom: p.renamedFrom ?? [],
        sortOrder: f.sortOrder * 100 + i,
    }));
});

const PERMISSION_KIND = new Map<string, PermissionKind>(PERMISSIONS.map((p) => [p.key, p.kind]));

/** Is this a write? Unknown keys count as writes, so read-only mode fails closed. */
export function isWritePermission(permission: PermissionKey | string): boolean {
    return (PERMISSION_KIND.get(permission) ?? 'write') === 'write';
}

export const LIMITS = (Object.keys(LIMIT_DEFS) as LimitKey[]).map((key) => ({ key, ...LIMIT_DEFS[key] }));

/** The feature a permission belongs to: 'invoices.create' → 'invoices'. */
export function featureOf(permission: PermissionKey | string): string {
    return permission.slice(0, permission.lastIndexOf('.'));
}

/** Catalog default: does this role get this permission out of the box? */
export function defaultGrant(role: string, permission: string): boolean {
    const p = PERMISSIONS.find((x) => x.key === permission);
    return !!p && (p.defaultRoles as readonly string[]).includes(role);
}

const ROLE_PORTAL = new Map<string, Portal>(ROLES.map((r) => [r.key, r.portal]));
const FEATURE_PORTALS = new Map<string, readonly Portal[]>(FEATURES.map((f) => [f.key, f.portals]));

/**
 * Can this permission apply to this role at all? A role only works in its own portal
 * (admin/manager → agency, creator → team, client → client), so e.g. `settings.update`
 * never applies to a client. Non-applicable grants are ignored even if set in the DB.
 */
export function roleApplies(role: string, permission: string): boolean {
    const portal = ROLE_PORTAL.get(role);
    const portals = FEATURE_PORTALS.get(featureOf(permission));
    if (!portal || !portals || !portals.includes(portal)) return false;
    // These actions are role-bound: never honor a grant outside defaultRoles.
    if (
        permission === 'documents.client_upload' ||
        permission === 'documents.share' ||
        permission === 'comments.client'
    ) {
        const p = PERMISSIONS.find((x) => x.key === permission);
        return !!p && (p.defaultRoles as readonly string[]).includes(role);
    }
    return true;
}
