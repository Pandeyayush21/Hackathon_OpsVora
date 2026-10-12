import {
    IconAgreements,
    IconClientPortal,
    IconClients,
    IconDashboard,
    IconDeliverables,
    IconDocuments,
    IconInvoices,
    IconLeaves,
    IconPen,
    IconProjects,
    IconSettings,
    IconTasks,
    IconTeam,
    type VoraIcon,
} from '@/components/icons/vora-icons';
import { featureOf, FEATURE_DEFS, type FeatureCategory, type FeatureKey, type PermissionKey } from './catalog';

export interface PortalNavItem {
    feature: FeatureKey;
    /** Empty string is the workspace home. */
    segment: string;
    icon: VoraIcon;
    permission: PermissionKey;
    /** False until the page exists. Those rows show a Soon badge and don't link. */
    built: boolean;
}

const NAV: PortalNavItem[] = [
    { feature: 'dashboard', segment: '', icon: IconDashboard, permission: 'dashboard.view', built: true },
    { feature: 'clients', segment: 'clients', icon: IconClients, permission: 'clients.view', built: true },
    { feature: 'client_portal', segment: 'portal', icon: IconClientPortal, permission: 'client_portal.manage', built: true },
    { feature: 'projects', segment: 'projects', icon: IconProjects, permission: 'projects.view', built: true },
    { feature: 'tasks', segment: 'tasks', icon: IconTasks, permission: 'tasks.view', built: true },
    { feature: 'deliverables', segment: 'deliverables', icon: IconDeliverables, permission: 'deliverables.view', built: true },
    { feature: 'documents', segment: 'documents', icon: IconDocuments, permission: 'documents.view', built: true },
    { feature: 'invoices', segment: 'invoices', icon: IconInvoices, permission: 'invoices.view', built: true },
    { feature: 'team', segment: 'team', icon: IconTeam, permission: 'team.view', built: true },
    { feature: 'agreements', segment: 'agreements', icon: IconAgreements, permission: 'agreements.view', built: true },
    { feature: 'leaves', segment: 'leaves', icon: IconLeaves, permission: 'leaves.view', built: false },
    { feature: 'settings', segment: 'settings', icon: IconSettings, permission: 'settings.view', built: true },
];

/** Short menu labels — the registry names ("Client Deliverables") are too long for a sidebar. */
const SHORT_LABEL: Partial<Record<FeatureKey, string>> = {
    dashboard: 'Dashboard',
    clients: 'Clients',
    client_portal: 'Client portal',
    projects: 'Projects',
    tasks: 'Tasks',
    deliverables: 'Deliverables',
    documents: 'Documents',
    invoices: 'Invoices',
    team: 'Team',
    agreements: 'Agreements',
    leaves: 'Leaves',
    settings: 'Settings',
};

export const PORTAL_NAV: readonly (PortalNavItem & { label: string; category: FeatureCategory })[] = NAV.map((item) => ({
    ...item,
    label: SHORT_LABEL[item.feature] ?? FEATURE_DEFS[item.feature].name,
    category: FEATURE_DEFS[item.feature].category,
}));

export const NAV_CATEGORY_LABEL: Record<FeatureCategory, string> = {
    core: 'Workspace',
    people: 'People',
    clients: 'Clients',
    work: 'Work',
    finance: 'Finance',
    collaboration: 'Collaboration',
};

export type NavVisibility = 'hidden' | 'locked' | 'soon' | 'shown';

/**
 * hidden — this role can't do it, or the plan lacks it and the viewer isn't an admin
 * locked — the role can, the plan can't; only agency admins see an Upgrade link
 * soon   — allowed, page not built yet
 * shown  — a real link
 */
export function navState(
    item: { permission: PermissionKey; built: boolean },
    ctx: { role: string; features: Record<string, boolean>; permissions: readonly string[] }
): NavVisibility {
    if (!ctx.permissions.includes(item.permission)) return 'hidden';
    if (ctx.features[featureOf(item.permission)] !== true) return ctx.role === 'admin' ? 'locked' : 'hidden';
    return item.built ? 'shown' : 'soon';
}

export function portalHref(slug: string, segment: string) {
    return segment ? `/agency/${slug}/${segment}` : `/agency/${slug}`;
}

/**
 * "My agreements" is recipient-based, not permission-based: every staff role can sign what was
 * addressed to them, even without `agreements.view`. It sits outside PORTAL_NAV for that reason.
 */
export const MY_AGREEMENTS_NAV = {
    segment: 'my-agreements',
    label: 'My agreements',
    icon: IconPen,
} as const;

export function myAgreementsVisible(ctx: { role: string; features: Record<string, boolean> }): boolean {
    return ctx.features.agreements === true && ctx.role !== 'client';
}

export interface ClientNavItem {
    key: 'home' | 'projects' | 'deliverables' | 'documents' | 'invoices' | 'agreements';
    label: string;
    href: string;
    built: boolean;
    noun: string;
}

const CLIENT_SECTIONS: { key: ClientNavItem['key']; feature: FeatureKey; permission: PermissionKey; label: string; noun: string }[] = [
    { key: 'projects', feature: 'projects', permission: 'projects.view', label: 'Projects', noun: 'projects' },
    { key: 'deliverables', feature: 'deliverables', permission: 'deliverables.view', label: 'Deliverables', noun: 'deliverables' },
    { key: 'documents', feature: 'documents', permission: 'documents.view', label: 'Documents', noun: 'documents' },
    { key: 'invoices', feature: 'invoices', permission: 'invoices.view', label: 'Invoices', noun: 'invoices' },
];

const CLIENT_BUILT: Partial<Record<ClientNavItem['key'], boolean>> = { projects: true, deliverables: true, documents: true, invoices: true };

/** What a client sees. Home is always there. Other sections need the plan and the client permission. */
export function clientNav(slug: string, ctx: { features: Record<string, boolean>; permissions: readonly string[] }): ClientNavItem[] {
    const items: ClientNavItem[] = [{ key: 'home', label: 'Home', href: `/portal/${slug}`, built: true, noun: 'home' }];
    for (const section of CLIENT_SECTIONS) {
        if (ctx.features[section.feature] !== true) continue;
        if (!ctx.permissions.includes(section.permission)) continue;
        items.push({
            key: section.key,
            label: section.label,
            href: `/portal/${slug}/${section.key}`,
            built: CLIENT_BUILT[section.key] === true,
            noun: section.noun,
        });
    }
    return items;
}

/**
 * Agreements in the client portal, if the plan includes them. Signing is recipient-based, so this
 * is not gated on `agreements.view` and stays out of clientNav.
 */
export function clientAgreementsItem(slug: string, features: Record<string, boolean>): ClientNavItem | null {
    if (features.agreements !== true) return null;
    return { key: 'agreements', label: 'Agreements', href: `/portal/${slug}/agreements`, built: true, noun: 'agreements' };
}
