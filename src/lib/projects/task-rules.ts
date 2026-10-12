import type { TaskStatus } from '@/lib/types/database';

export interface TaskRuleInput {
    assigned_spoc_id: string | null;
    created_by: string | null;
}

export function canEditTask(input: {
    role: string;
    userId: string;
    task: TaskRuleInput;
    permissions: readonly string[];
}): boolean {
    if (!input.permissions.includes('tasks.update')) return false;
    if (input.role === 'admin' || input.role === 'manager') return true;
    if (input.role === 'creator') {
        return input.task.assigned_spoc_id === input.userId || input.task.created_by === input.userId;
    }
    return false;
}

/** A creator may pick up an unassigned task by assigning it to themselves. */
export function canClaimTask(input: {
    role: string;
    userId: string;
    task: TaskRuleInput;
    assigneeId: string | null | undefined;
    permissions: readonly string[];
}): boolean {
    return (
        input.role === 'creator' &&
        input.permissions.includes('tasks.update') &&
        input.task.assigned_spoc_id === null &&
        input.assigneeId === input.userId
    );
}

/** Leads with tasks.delete can delete any task; a creator granted tasks.delete only their own. */
export function canDeleteTask(input: {
    role: string;
    userId: string;
    task: TaskRuleInput;
    permissions: readonly string[];
}): boolean {
    if (!input.permissions.includes('tasks.delete')) return false;
    if (input.role === 'admin' || input.role === 'manager') return true;
    if (input.role === 'creator') {
        return input.task.assigned_spoc_id === input.userId || input.task.created_by === input.userId;
    }
    return false;
}

/** Leads with tasks.assign can set anyone. A creator may only take a task or drop their own. */
export function canAssign(input: {
    role: string;
    permissions: readonly string[];
    assigneeId: string | null;
    userId: string;
    currentAssignee: string | null;
}): boolean {
    if (input.permissions.includes('tasks.assign') && (input.role === 'admin' || input.role === 'manager')) return true;
    if (input.role !== 'creator') return false;
    if (input.assigneeId === input.userId) return true;
    return input.assigneeId === null && input.currentAssignee === input.userId;
}

export function projectAcceptsTasks(project: { status: string; deleted_at?: string | null } | null): boolean {
    if (!project || project.deleted_at) return false;
    return project.status !== 'completed' && project.status !== 'cancelled';
}

export interface ClientTaskView {
    id: string;
    title: string;
    status: TaskStatus | string;
    due_date: string | null;
    completed_at: string | null;
}

export function clientTaskView(task: ClientTaskView): ClientTaskView {
    return {
        id: task.id,
        title: task.title,
        status: task.status,
        due_date: task.due_date,
        completed_at: task.completed_at,
    };
}
