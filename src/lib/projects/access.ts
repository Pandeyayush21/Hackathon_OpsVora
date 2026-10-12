import { NextResponse } from 'next/server';
import { getRoleGrants, roleCan } from '@/lib/access/roles';
import { getProject, getTask } from './projects';
import { visibleProjectIds } from './scope';
import { canAssign, canEditTask, projectAcceptsTasks } from './task-rules';

export function rejectClient(role: string) {
    if (role !== 'client') return null;
    return NextResponse.json({ error: 'Open this from the client portal.', code: 'FORBIDDEN' }, { status: 403 });
}

export async function taskPermissions(role: string) {
    const grants = await getRoleGrants();
    return (['tasks.update', 'tasks.assign', 'tasks.delete'] as const).filter((key) => roleCan(grants, role, key));
}

export async function projectInScope(agencyId: string, userId: string, role: string, projectId: string) {
    const project = await getProject(agencyId, projectId);
    if (!project) return null;
    const visible = await visibleProjectIds(agencyId, userId, role);
    if (visible.kind === 'ids' && !visible.ids.includes(projectId)) return null;
    return project;
}

export async function taskInScope(agencyId: string, userId: string, role: string, taskId: string) {
    const task = await getTask(agencyId, taskId);
    if (!task) return null;
    const visible = await visibleProjectIds(agencyId, userId, role);
    if (visible.kind === 'ids' && !visible.ids.includes(task.project_id)) return null;
    return task;
}

export function editAllowed(role: string, userId: string, task: { assigned_spoc_id: string | null; created_by: string | null }, permissions: readonly string[]) {
    return canEditTask({ role, userId, task, permissions });
}

export function assignAllowed(role: string, userId: string, task: { assigned_spoc_id: string | null }, assigneeId: string | null, permissions: readonly string[]) {
    return canAssign({ role, permissions, assigneeId, userId, currentAssignee: task.assigned_spoc_id });
}

export function tasksOpen(project: { status: string; deleted_at?: string | null } | null) {
    return projectAcceptsTasks(project);
}
