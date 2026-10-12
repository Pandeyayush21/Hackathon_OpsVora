import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { visibleProjectIds } from '@/lib/projects/scope';
import type { Deliverable, DeliverableStatus } from '@/lib/types/database';

export interface ScopedDeliverable extends Deliverable {
    project_status: string;
    project_deleted_at: string | null;
    project_name: string;
    client_name: string;
    project_owner_id: string | null;
}

export async function deliverableInScope(agencyId: string, userId: string, role: string, deliverableId: string): Promise<ScopedDeliverable | null> {
    const supabase = createServerSupabaseClient();
    const { data } = await supabase
        .from('deliverables')
        .select('*, projects(status, deleted_at, name, owner_id), clients(company_name)')
        .eq('agency_id', agencyId)
        .eq('id', deliverableId)
        .is('deleted_at', null)
        .maybeSingle();
    if (!data) return null;
    const visible = await visibleProjectIds(agencyId, userId, role);
    if (visible.kind === 'ids' && !visible.ids.includes(data.project_id)) return null;
    if (role === 'client' && data.status === 'draft') return null;
    const project = Array.isArray(data.projects) ? data.projects[0] : data.projects;
    const client = Array.isArray(data.clients) ? data.clients[0] : data.clients;
    if (!project || project.deleted_at) return null;
    return {
        id: data.id,
        agency_id: data.agency_id,
        client_id: data.client_id,
        project_id: data.project_id,
        task_id: data.task_id,
        title: data.title,
        status: data.status as DeliverableStatus,
        current_version: data.current_version,
        due_date: data.due_date,
        created_by: data.created_by,
        submitted_at: data.submitted_at,
        decided_at: data.decided_at,
        approved_at: data.approved_at,
        created_at: data.created_at,
        updated_at: data.updated_at,
        deleted_at: data.deleted_at,
        project_status: project.status,
        project_deleted_at: project.deleted_at,
        project_name: project.name,
        client_name: client?.company_name ?? 'Client',
        project_owner_id: project.owner_id ?? null,
    };
}

const CONFLICT = new Set(['NOT_IN_REVIEW', 'STALE_VERSION', 'PROJECT_LOCKED']);
const BAD = new Set(['COMMENT_REQUIRED', 'COMMENT_TOO_LONG', 'BAD_DECISION', 'BAD_ACTOR', 'TASK_NOT_IN_PROJECT']);

export function mapDeliverableError(error: { message?: string } | null): NextResponse | null {
    const message = error?.message ?? '';
    const code = [...CONFLICT, ...BAD, 'PROJECT_NOT_FOUND'].find((item) => message.includes(item));
    if (!code) return null;
    if (code === 'PROJECT_NOT_FOUND') return NextResponse.json({ error: 'Project not found.', code }, { status: 404 });
    if (CONFLICT.has(code)) {
        const errorText = code === 'STALE_VERSION' ? 'That version is no longer the one under review.' : code === 'PROJECT_LOCKED' ? 'A deliverable stays on the project it was created for.' : 'This deliverable is not waiting for a decision.';
        return NextResponse.json({ error: errorText, code }, { status: 409 });
    }
    const errorText = code === 'COMMENT_REQUIRED' ? 'A comment is required.' : code === 'COMMENT_TOO_LONG' ? 'Comment must be 2000 characters or fewer.' : code === 'TASK_NOT_IN_PROJECT' ? 'That task is not on this project.' : 'That decision is not valid.';
    return NextResponse.json({ error: errorText, code }, { status: 400 });
}
