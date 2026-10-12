import { createServerSupabaseClient } from '@/lib/supabase/server';
import { checkLimit } from '@/lib/access/entitlements';
import { getUsage } from '@/lib/portal/usage';
import type { Project, Task } from '@/lib/types/database';

const OPEN = ['draft', 'active', 'on_hold'];

export async function getProject(agencyId: string, projectId: string): Promise<Project | null> {
    const supabase = createServerSupabaseClient();
    const { data } = await supabase.from('projects').select('*').eq('agency_id', agencyId).eq('id', projectId).is('deleted_at', null).maybeSingle();
    return (data as Project | null) ?? null;
}

export async function getTask(agencyId: string, taskId: string): Promise<(Task & { project_status: string | null }) | null> {
    const supabase = createServerSupabaseClient();
    const { data } = await supabase
        .from('tasks')
        .select('*, projects(status, deleted_at)')
        .eq('agency_id', agencyId)
        .eq('id', taskId)
        .is('deleted_at', null)
        .maybeSingle();
    if (!data) return null;
    const project = Array.isArray(data.projects) ? data.projects[0] : data.projects;
    if (project?.deleted_at) return null;
    const task = { ...data } as Task & { projects?: unknown };
    delete task.projects;
    return { ...task, project_status: project?.status ?? null };
}

export async function projectSeatCheck(agencyId: string) {
    const usage = await getUsage(agencyId);
    return checkLimit(agencyId, 'projects', usage.projects, 1);
}

export function statusUsesSeat(status: string) {
    return OPEN.includes(status);
}

export async function projectProgress(projectIds: string[], opts: { sharedOnly?: boolean } = {}): Promise<Record<string, { total: number; done: number }>> {
    const out: Record<string, { total: number; done: number }> = {};
    for (const id of projectIds) out[id] = { total: 0, done: 0 };
    if (!projectIds.length) return out;
    const supabase = createServerSupabaseClient();
    let query = supabase.from('tasks').select('project_id, status').in('project_id', projectIds).is('deleted_at', null);
    if (opts.sharedOnly) query = query.eq('is_visible_to_client', true);
    const { data } = await query;
    for (const row of data ?? []) {
        const bucket = out[row.project_id as string];
        if (!bucket) continue;
        bucket.total += 1;
        if (row.status === 'completed') bucket.done += 1;
    }
    return out;
}
