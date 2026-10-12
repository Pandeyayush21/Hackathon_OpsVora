import type { NotificationCategory, NotificationEmailMode, NotificationKind } from '@/lib/types/database';

export type NotifyPortal = 'agency' | 'portal';

export interface CatalogueContext {
    title?: string;
    entityTitle?: string;
    actorName?: string;
    projectName?: string;
    clientName?: string;
    decision?: string;
    number?: string;
    version?: number;
    slug?: string;
    entityId?: string;
    preview?: string;
    agreementTitle?: string;
    reference?: string;
    /** Portal path (no slug) for comment kinds when it differs from `title`, which holds the agency path. */
    portalLink?: string;
}

export interface CatalogueEntry {
    kind: NotificationKind;
    category: NotificationCategory;
    defaultEmail: NotificationEmailMode;
    /** Skip the notification email (e.g. invoice.sent already sends PDF). */
    skipEmail?: boolean;
    title: (ctx: CatalogueContext) => string;
    link: (ctx: CatalogueContext, portal: NotifyPortal) => string;
    body?: (ctx: CatalogueContext) => string | null;
}

function agencyPath(slug: string, path: string) {
    return `/agency/${slug}${path}`;
}

function portalPath(slug: string, path: string) {
    return `/portal/${slug}${path}`;
}

function dual(
    agency: (slug: string, id: string) => string,
    portal: (slug: string, id: string) => string,
): (ctx: CatalogueContext, p: NotifyPortal) => string {
    return (ctx, p) => {
        const slug = ctx.slug || '';
        const id = ctx.entityId || '';
        return p === 'portal' ? portal(slug, id) : agency(slug, id);
    };
}

/** Comment kinds: `title` carries the agency path, `portalLink` the portal path (both without slug). */
function commentLink(ctx: CatalogueContext, p: NotifyPortal): string {
    const slug = ctx.slug || '';
    return p === 'portal'
        ? portalPath(slug, `/${ctx.portalLink || ctx.title || 'projects'}`)
        : agencyPath(slug, `/${ctx.title || 'projects'}`);
}

export const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
    'assignment',
    'mention',
    'comment',
    'review',
    'client_activity',
    'billing',
    'team',
    'agreements',
];

export const CATEGORY_DEFAULTS: Record<NotificationCategory, NotificationEmailMode> = {
    assignment: 'instant',
    mention: 'instant',
    comment: 'daily',
    review: 'instant',
    client_activity: 'instant',
    billing: 'instant',
    team: 'daily',
    agreements: 'instant',
};

export const CATALOGUE: Record<NotificationKind, CatalogueEntry> = {
    'task.assigned': {
        kind: 'task.assigned',
        category: 'assignment',
        defaultEmail: 'instant',
        title: (ctx) => `You were assigned: ${ctx.entityTitle || 'a task'}`,
        link: dual(
            (s, id) => agencyPath(s, `/tasks?task=${id}`),
            (s, _id) => portalPath(s, `/projects`),
        ),
    },
    'task.status_done': {
        kind: 'task.status_done',
        category: 'comment',
        defaultEmail: 'daily',
        title: (ctx) => `${ctx.entityTitle || 'A task'} was marked done`,
        link: dual(
            (s, id) => agencyPath(s, `/tasks?task=${id}`),
            (s, _id) => portalPath(s, `/projects`),
        ),
    },
    'task.due_soon': {
        kind: 'task.due_soon',
        category: 'assignment',
        defaultEmail: 'instant',
        title: (ctx) => `Due tomorrow: ${ctx.entityTitle || 'a task'}`,
        link: dual(
            (s, id) => agencyPath(s, `/tasks?task=${id}`),
            (s, _id) => portalPath(s, `/projects`),
        ),
    },
    'comment.mention': {
        kind: 'comment.mention',
        category: 'mention',
        defaultEmail: 'instant',
        title: (ctx) => `${ctx.actorName || 'Someone'} mentioned you`,
        link: commentLink,
        body: (ctx) => ctx.preview || null,
    },
    'comment.reply': {
        kind: 'comment.reply',
        category: 'comment',
        defaultEmail: 'instant',
        title: (ctx) => `${ctx.actorName || 'Someone'} replied to your comment`,
        link: commentLink,
        body: (ctx) => ctx.preview || null,
    },
    'comment.new': {
        kind: 'comment.new',
        category: 'comment',
        defaultEmail: 'daily',
        title: (ctx) => `New comment on ${ctx.entityTitle || 'an item'}`,
        link: commentLink,
        body: (ctx) => ctx.preview || null,
    },
    'deliverable.sent': {
        kind: 'deliverable.sent',
        category: 'review',
        defaultEmail: 'instant',
        title: (ctx) => `${ctx.entityTitle || 'A deliverable'} is ready for review`,
        link: dual(
            (s, id) => agencyPath(s, `/deliverables/${id}`),
            (s, id) => portalPath(s, `/deliverables/${id}`),
        ),
    },
    'deliverable.decided': {
        kind: 'deliverable.decided',
        category: 'review',
        defaultEmail: 'instant',
        title: (ctx) =>
            ctx.decision === 'approved'
                ? `${ctx.entityTitle || 'Deliverable'} was approved`
                : `Changes requested on ${ctx.entityTitle || 'a deliverable'}`,
        link: dual(
            (s, id) => agencyPath(s, `/deliverables/${id}`),
            (s, id) => portalPath(s, `/deliverables/${id}`),
        ),
    },
    'deliverable.viewed': {
        kind: 'deliverable.viewed',
        category: 'review',
        defaultEmail: 'daily',
        title: (ctx) => `${ctx.entityTitle || 'A deliverable'} was viewed`,
        link: dual(
            (s, id) => agencyPath(s, `/deliverables/${id}`),
            (s, id) => portalPath(s, `/deliverables/${id}`),
        ),
    },
    'document.shared': {
        kind: 'document.shared',
        category: 'client_activity',
        defaultEmail: 'daily',
        title: (ctx) => `New file shared: ${ctx.entityTitle || 'a document'}`,
        link: dual(
            (s) => agencyPath(s, `/documents`),
            (s) => portalPath(s, `/documents`),
        ),
    },
    'document.client_upload': {
        kind: 'document.client_upload',
        category: 'client_activity',
        defaultEmail: 'instant',
        title: (ctx) => `${ctx.clientName || 'A client'} uploaded a file`,
        link: dual(
            (s) => agencyPath(s, `/documents`),
            (s) => portalPath(s, `/documents`),
        ),
    },
    'invoice.sent': {
        kind: 'invoice.sent',
        category: 'billing',
        defaultEmail: 'instant',
        skipEmail: true,
        title: (ctx) => `Invoice ${ctx.number || ''} is ready`,
        link: dual(
            (s, id) => agencyPath(s, `/invoices/${id}`),
            (s, id) => portalPath(s, `/invoices/${id}`),
        ),
    },
    'invoice.paid': {
        kind: 'invoice.paid',
        category: 'billing',
        defaultEmail: 'instant',
        title: (ctx) => `Invoice ${ctx.number || ''} was paid`,
        link: dual(
            (s, id) => agencyPath(s, `/invoices/${id}`),
            (s, id) => portalPath(s, `/invoices/${id}`),
        ),
    },
    'invoice.overdue': {
        kind: 'invoice.overdue',
        category: 'billing',
        defaultEmail: 'daily',
        title: (ctx) => `Invoice ${ctx.number || ''} is overdue`,
        link: dual(
            (s, id) => agencyPath(s, `/invoices/${id}`),
            (s, id) => portalPath(s, `/invoices/${id}`),
        ),
    },
    'project.member_added': {
        kind: 'project.member_added',
        category: 'assignment',
        defaultEmail: 'instant',
        title: (ctx) => `You were added to ${ctx.projectName || 'a project'}`,
        link: dual(
            (s, id) => agencyPath(s, `/projects/${id}`),
            (s, id) => portalPath(s, `/projects/${id}`),
        ),
    },
    'team.joined': {
        kind: 'team.joined',
        category: 'team',
        defaultEmail: 'daily',
        title: (ctx) => `${ctx.actorName || 'Someone'} joined the team`,
        link: (ctx) => agencyPath(ctx.slug || '', '/team'),
    },
    'client.portal_joined': {
        kind: 'client.portal_joined',
        category: 'team',
        defaultEmail: 'daily',
        title: (ctx) => `${ctx.actorName || 'A contact'} joined the client portal`,
        link: dual(
            (s, id) => agencyPath(s, `/clients/${id}`),
            (s) => portalPath(s, ''),
        ),
    },
    'agreement.sent': {
        kind: 'agreement.sent',
        category: 'agreements',
        defaultEmail: 'instant',
        title: (ctx) => `Please sign: ${ctx.agreementTitle || ctx.entityTitle || 'an agreement'}`,
        link: (ctx, p) =>
            p === 'portal'
                ? portalPath(ctx.slug || '', `/agreements/${ctx.entityId || ''}`)
                : `/agreements/${ctx.entityId || ''}`,
    },
    'agreement.signed': {
        kind: 'agreement.signed',
        category: 'agreements',
        defaultEmail: 'instant',
        title: (ctx) => `${ctx.agreementTitle || 'Agreement'} was signed`,
        link: (ctx) => agencyPath(ctx.slug || '', `/agreements/${ctx.entityId || ''}`),
    },
    'agreement.declined': {
        kind: 'agreement.declined',
        category: 'agreements',
        defaultEmail: 'instant',
        title: (ctx) => `${ctx.agreementTitle || 'Agreement'} was declined`,
        link: (ctx) => agencyPath(ctx.slug || '', `/agreements/${ctx.entityId || ''}`),
    },
    'agreement.voided': {
        kind: 'agreement.voided',
        category: 'agreements',
        defaultEmail: 'instant',
        title: (ctx) => `${ctx.agreementTitle || 'Agreement'} was voided`,
        link: (ctx, p) =>
            p === 'portal'
                ? portalPath(ctx.slug || '', `/agreements/${ctx.entityId || ''}`)
                : agencyPath(ctx.slug || '', `/agreements/${ctx.entityId || ''}`),
    },
    'agreement.expired': {
        kind: 'agreement.expired',
        category: 'agreements',
        defaultEmail: 'daily',
        title: (ctx) => `${ctx.agreementTitle || 'Agreement'} expired`,
        link: (ctx) => agencyPath(ctx.slug || '', `/agreements/${ctx.entityId || ''}`),
    },
    'agreement.expiring': {
        kind: 'agreement.expiring',
        category: 'agreements',
        defaultEmail: 'instant',
        title: (ctx) => `${ctx.agreementTitle || 'Agreement'} expires soon`,
        link: (ctx, p) =>
            p === 'portal'
                ? portalPath(ctx.slug || '', `/agreements/${ctx.entityId || ''}`)
                : agencyPath(ctx.slug || '', `/agreements/${ctx.entityId || ''}`),
    },
    'agreement.completed': {
        kind: 'agreement.completed',
        category: 'agreements',
        defaultEmail: 'instant',
        title: (ctx) => `${ctx.agreementTitle || 'Agreement'} is complete`,
        link: (ctx, p) =>
            p === 'portal'
                ? portalPath(ctx.slug || '', `/agreements/${ctx.entityId || ''}`)
                : agencyPath(ctx.slug || '', `/agreements/${ctx.entityId || ''}`),
    },
};

export function getCatalogueEntry(kind: NotificationKind | string): CatalogueEntry | null {
    return (CATALOGUE as Record<string, CatalogueEntry>)[kind] ?? null;
}

export function defaultEmailForCategory(category: NotificationCategory | string): NotificationEmailMode {
    return CATEGORY_DEFAULTS[category as NotificationCategory] ?? 'daily';
}
