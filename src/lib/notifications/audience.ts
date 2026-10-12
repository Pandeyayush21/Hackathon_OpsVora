import { userContacts } from '@/lib/auth/users';
import { findMembership } from '@/lib/access/guards';
import { getEntitlements } from '@/lib/access/entitlements';
import { getRoleGrants } from '@/lib/access/roles';
import { roleCan } from '@/lib/access/roles-core';
import { clientScope, scopeAllows } from '@/lib/clients/scope';
import { documentInScope } from '@/lib/documents/access';
import { deliverableInScope } from '@/lib/deliverables/access';
import { visibleProjectIds, workAllows } from '@/lib/projects/scope';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { CommentVisibility } from '@/lib/types/database';
import type { PermissionKey } from '@/lib/registry/catalog';

export type AudienceEntityType = 'task' | 'deliverable' | 'document' | 'invoice' | 'project' | 'comment' | 'agreement' | 'agency';

export interface AudienceEntity {
    type: AudienceEntityType;
    id: string;
    /** When type is comment, the outer entity. */
    parentType?: AudienceEntityType;
    parentId?: string;
    visibility?: CommentVisibility;
}

const VIEW_PERM: Partial<Record<AudienceEntityType, PermissionKey | 'notifications.view'>> = {
    task: 'tasks.view',
    deliverable: 'deliverables.view',
    document: 'documents.view',
    invoice: 'invoices.view',
    project: 'projects.view',
    comment: 'comments.view',
    agreement: 'notifications.view',
    agency: 'notifications.view',
};

interface Cache {
    memberships: Map<string, Awaited<ReturnType<typeof findMembership>>>;
    entitlements: Awaited<ReturnType<typeof getEntitlements>> | undefined;
    grants: Awaited<ReturnType<typeof getRoleGrants>> | undefined;
}

function emptyCache(): Cache {
    return { memberships: new Map(), entitlements: undefined, grants: undefined };
}

async function loadMember(cache: Cache, agencyId: string, userId: string) {
    const key = `${agencyId}:${userId}`;
    if (!cache.memberships.has(key)) {
        cache.memberships.set(key, await findMembership(userId, agencyId));
    }
    return cache.memberships.get(key)!;
}

async function loadEntitlements(cache: Cache, agencyId: string) {
    if (cache.entitlements === undefined) {
        cache.entitlements = await getEntitlements(agencyId);
    }
    return cache.entitlements;
}

async function loadGrants(cache: Cache) {
    if (!cache.grants) cache.grants = await getRoleGrants();
    return cache.grants;
}

async function entityVisible(
    agencyId: string,
    userId: string,
    role: string,
    entity: AudienceEntity,
): Promise<boolean> {
    const supabase = createServerSupabaseClient();

    if (entity.type === 'agency') return true;

    if (entity.type === 'comment') {
        if (role === 'client' && entity.visibility === 'internal') return false;
        if (!entity.parentType || !entity.parentId) return false;
        return entityVisible(agencyId, userId, role, {
            type: entity.parentType,
            id: entity.parentId,
            visibility: entity.visibility,
        });
    }

    if (entity.type === 'project') {
        const visible = await visibleProjectIds(agencyId, userId, role);
        if (visible.kind === 'all') return true;
        return visible.ids.includes(entity.id);
    }

    if (entity.type === 'task') {
        const { data: task } = await supabase
            .from('tasks')
            .select('id, project_id, is_visible_to_client, deleted_at')
            .eq('agency_id', agencyId)
            .eq('id', entity.id)
            .maybeSingle();
        if (!task || task.deleted_at) return false;
        if (role === 'client' && !task.is_visible_to_client) return false;
        const visible = await visibleProjectIds(agencyId, userId, role);
        if (visible.kind === 'all') return true;
        return visible.ids.includes(task.project_id as string);
    }

    if (entity.type === 'deliverable') {
        const scoped = await deliverableInScope(agencyId, userId, role, entity.id);
        return !!scoped;
    }

    if (entity.type === 'document') {
        const scoped = await documentInScope(agencyId, userId, role, entity.id);
        return !!scoped;
    }

    if (entity.type === 'invoice') {
        const { data: invoice } = await supabase
            .from('invoices')
            .select('id, client_id, status, deleted_at')
            .eq('agency_id', agencyId)
            .eq('id', entity.id)
            .maybeSingle();
        if (!invoice || invoice.deleted_at) return false;
        if (role === 'client') {
            if (invoice.status === 'draft') return false;
            const scope = await clientScope(agencyId, userId, role);
            return scopeAllows(scope, invoice.client_id as string);
        }
        return true;
    }

    if (entity.type === 'agreement') {
        const { data: agreement } = await supabase
            .from('agreements')
            .select('id, recipient_user_id, recipient_email, client_id, status, deleted_at')
            .eq('agency_id', agencyId)
            .eq('id', entity.id)
            .maybeSingle();
        if (!agreement || agreement.deleted_at) return false;
        if (role === 'admin' || role === 'manager') return true;
        if (agreement.recipient_user_id === userId) return true;
        // Creators / clients: only if addressed to them (email match checked at sign time)
        // Addressed to them: compare with the email on auth.users (profiles has none).
        const email = (await userContacts([userId])).get(userId)?.email?.toLowerCase();
        if (email && email === String(agreement.recipient_email).toLowerCase()) return true;
        if (role === 'client' && agreement.client_id) {
            const scope = await clientScope(agencyId, userId, role);
            return scopeAllows(scope, agreement.client_id as string);
        }
        return false;
    }

    return false;
}

export async function canSee(
    agencyId: string,
    userId: string,
    entity: AudienceEntity,
    cache: Cache = emptyCache(),
): Promise<boolean> {
    const member = await loadMember(cache, agencyId, userId);
    if (!member) return false;

    const entitlements = await loadEntitlements(cache, agencyId);
    if (!entitlements) return false;

    const perm = (VIEW_PERM[entity.type === 'comment' ? (entity.parentType || 'comment') : entity.type] ||
        'notifications.view') as PermissionKey;
    const feature = perm.split('.')[0];
    if (feature !== 'notifications' && entitlements.features[feature] !== true) return false;

    const grants = await loadGrants(cache);
    if (entity.type === 'agreement') {
        if (entitlements.features.agreements !== true) return false;
    } else if (entity.type !== 'agency') {
        if (!roleCan(grants, member.role, perm)) return false;
    }

    return entityVisible(agencyId, userId, member.role, entity);
}

export async function filterAudience(
    agencyId: string,
    userIds: string[],
    entity: AudienceEntity,
): Promise<string[]> {
    const cache = emptyCache();
    const unique = [...new Set(userIds.filter(Boolean))];
    const out: string[] = [];
    for (const id of unique) {
        if (await canSee(agencyId, id, entity, cache)) out.push(id);
    }
    return out;
}

/** Watchers: creator, assignee/owner, commenters, mentioned users. */
export async function entityWatchers(
    agencyId: string,
    entity: { type: AudienceEntityType; id: string },
): Promise<string[]> {
    const supabase = createServerSupabaseClient();
    const ids = new Set<string>();

    if (entity.type === 'task') {
        const { data } = await supabase
            .from('tasks')
            .select('created_by, assigned_spoc_id')
            .eq('agency_id', agencyId)
            .eq('id', entity.id)
            .maybeSingle();
        if (data?.created_by) ids.add(data.created_by);
        if (data?.assigned_spoc_id) ids.add(data.assigned_spoc_id);
    } else if (entity.type === 'project') {
        const { data: project } = await supabase
            .from('projects')
            .select('created_by, owner_id')
            .eq('agency_id', agencyId)
            .eq('id', entity.id)
            .maybeSingle();
        if (project?.created_by) ids.add(project.created_by);
        if (project?.owner_id) ids.add(project.owner_id);
        const { data: members } = await supabase
            .from('project_members')
            .select('user_id')
            .eq('agency_id', agencyId)
            .eq('project_id', entity.id);
        for (const m of members ?? []) if (m.user_id) ids.add(m.user_id);
    } else if (entity.type === 'deliverable') {
        const [{ data }, { data: versions }] = await Promise.all([
            supabase.from('deliverables').select('created_by').eq('agency_id', agencyId).eq('id', entity.id).maybeSingle(),
            // Who sent it lives on each version.
            supabase.from('deliverable_versions').select('sent_by').eq('agency_id', agencyId).eq('deliverable_id', entity.id).not('sent_by', 'is', null),
        ]);
        if (data?.created_by) ids.add(data.created_by);
        for (const v of versions ?? []) if (v.sent_by) ids.add(v.sent_by as string);
    } else if (entity.type === 'document') {
        const { data } = await supabase
            .from('documents')
            .select('uploaded_by')
            .eq('agency_id', agencyId)
            .eq('id', entity.id)
            .maybeSingle();
        if (data?.uploaded_by) ids.add(data.uploaded_by as string);
    } else if (entity.type === 'invoice') {
        const { data } = await supabase
            .from('invoices')
            .select('created_by, sent_by')
            .eq('agency_id', agencyId)
            .eq('id', entity.id)
            .maybeSingle();
        if (data?.created_by) ids.add(data.created_by);
        if (data?.sent_by) ids.add(data.sent_by);
    }

    const { data: comments } = await supabase
        .from('comments')
        .select('author_id, mentions')
        .eq('agency_id', agencyId)
        .eq('entity_type', entity.type)
        .eq('entity_id', entity.id)
        .is('deleted_at', null);
    for (const c of comments ?? []) {
        if (c.author_id) ids.add(c.author_id);
        for (const m of (c.mentions as string[]) ?? []) ids.add(m);
    }

    return [...ids];
}

export { workAllows };
