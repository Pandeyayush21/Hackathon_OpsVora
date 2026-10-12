import { HEX_COLOR } from '@/lib/onboarding/slug';
import type { ProjectPriority, ProjectStatus, TaskPriority, TaskStatus } from '@/lib/types/database';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROJECT_STATUS: ProjectStatus[] = ['draft', 'active', 'on_hold', 'completed', 'cancelled'];
const TASK_STATUS: TaskStatus[] = ['todo', 'in_progress', 'in_review', 'completed'];
const PRIORITY: ProjectPriority[] = ['low', 'medium', 'high', 'urgent'];

type Ok<T> = { ok: true; value: T };
type Err = { ok: false; error: string };

function str(body: Record<string, unknown>, key: string) {
    return typeof body[key] === 'string' ? body[key].trim() : '';
}

function uuidOrNull(body: Record<string, unknown>, key: string, label: string): { ok: true; value: string | null } | Err {
    if (body[key] == null || body[key] === '') return { ok: true, value: null };
    if (typeof body[key] !== 'string' || !UUID.test(body[key])) return { ok: false, error: `Choose a valid ${label}.` };
    return { ok: true, value: body[key] };
}

function dateOrNull(body: Record<string, unknown>, key: string): { ok: true; value: string | null } | Err {
    if (!(key in body) || body[key] == null || body[key] === '') return { ok: true, value: null };
    if (typeof body[key] !== 'string' || Number.isNaN(Date.parse(body[key]))) return { ok: false, error: 'Enter a valid date.' };
    return { ok: true, value: body[key].slice(0, 10) };
}

export interface ProjectInput {
    name?: string;
    client_id?: string;
    description?: string | null;
    client_summary?: string | null;
    status?: ProjectStatus;
    priority?: ProjectPriority;
    start_date?: string | null;
    due_date?: string | null;
    color?: string | null;
    owner_id?: string | null;
}

export function validateProjectInput(body: Record<string, unknown>, opts: { partial?: boolean } = {}): Ok<ProjectInput> | Err {
    const value: ProjectInput = {};
    const partial = opts.partial === true;

    if (!partial || 'name' in body) {
        const name = str(body, 'name');
        if (!name || name.length > 120) return { ok: false, error: 'Project name must be 1 to 120 characters.' };
        value.name = name;
    }
    if (!partial && 'client_id' in body) {
        const id = uuidOrNull(body, 'client_id', 'client');
        if (!id.ok || !id.value) return { ok: false, error: 'Choose a client.' };
        value.client_id = id.value;
    } else if (!partial) {
        return { ok: false, error: 'Choose a client.' };
    }
    if ('description' in body) {
        const description = typeof body.description === 'string' ? body.description : '';
        if (description.length > 10000) return { ok: false, error: 'Description must be 10000 characters or fewer.' };
        value.description = description.trim() || null;
    }
    if ('client_summary' in body) {
        const summary = typeof body.client_summary === 'string' ? body.client_summary : '';
        if (summary.length > 2000) return { ok: false, error: 'The client summary must be 2000 characters or fewer.' };
        value.client_summary = summary.trim() || null;
    }
    if ('status' in body) {
        if (typeof body.status !== 'string' || !PROJECT_STATUS.includes(body.status as ProjectStatus)) return { ok: false, error: 'Choose a valid status.' };
        value.status = body.status as ProjectStatus;
    }
    if ('priority' in body) {
        if (typeof body.priority !== 'string' || !PRIORITY.includes(body.priority as ProjectPriority)) return { ok: false, error: 'Choose a valid priority.' };
        value.priority = body.priority as ProjectPriority;
    }
    if ('start_date' in body || 'due_date' in body) {
        const start = 'start_date' in body ? dateOrNull(body, 'start_date') : { ok: true as const, value: undefined };
        const due = 'due_date' in body ? dateOrNull(body, 'due_date') : { ok: true as const, value: undefined };
        if (!start.ok) return start;
        if (!due.ok) return due;
        if (start.value && due.value && due.value < start.value) return { ok: false, error: 'The due date must be on or after the start date.' };
        if ('start_date' in body) value.start_date = start.value ?? null;
        if ('due_date' in body) value.due_date = due.value ?? null;
    }
    if ('color' in body) {
        if (body.color == null || body.color === '') value.color = null;
        else if (typeof body.color !== 'string' || !HEX_COLOR.test(body.color)) return { ok: false, error: 'Choose a colour like #3366FF.' };
        else value.color = body.color;
    }
    if ('owner_id' in body) {
        const owner = uuidOrNull(body, 'owner_id', 'owner');
        if (!owner.ok) return owner;
        value.owner_id = owner.value;
    }
    return { ok: true, value };
}

export interface TaskInput {
    title?: string;
    description?: string | null;
    status?: TaskStatus;
    priority?: TaskPriority;
    due_date?: string | null;
    labels?: string[];
    assignee_id?: string | null;
    is_visible_to_client?: boolean;
}

export function validateTaskInput(body: Record<string, unknown>, opts: { partial?: boolean } = {}): Ok<TaskInput> | Err {
    const value: TaskInput = {};
    const partial = opts.partial === true;
    if ('project_id' in body || 'client_id' in body) return { ok: false, error: 'A task stays on the project it was created for.' };
    if (!partial || 'title' in body) {
        const title = str(body, 'title');
        if (!title || title.length > 200) return { ok: false, error: 'Task title must be 1 to 200 characters.' };
        value.title = title;
    }
    if ('description' in body) {
        const description = typeof body.description === 'string' ? body.description : '';
        if (description.length > 10000) return { ok: false, error: 'Description must be 10000 characters or fewer.' };
        value.description = description.trim() || null;
    }
    if ('status' in body) {
        if (typeof body.status !== 'string' || !TASK_STATUS.includes(body.status as TaskStatus)) return { ok: false, error: 'Choose a valid status.' };
        value.status = body.status as TaskStatus;
    }
    if ('priority' in body) {
        if (typeof body.priority !== 'string' || !PRIORITY.includes(body.priority as TaskPriority)) return { ok: false, error: 'Choose a valid priority.' };
        value.priority = body.priority as TaskPriority;
    }
    if ('due_date' in body) {
        if (body.due_date == null || body.due_date === '') value.due_date = null;
        else if (typeof body.due_date !== 'string' || Number.isNaN(Date.parse(body.due_date))) return { ok: false, error: 'Enter a valid date.' };
        else value.due_date = body.due_date;
    }
    if ('labels' in body) {
        if (!Array.isArray(body.labels)) return { ok: false, error: 'Labels must be a list.' };
        const labels = [...new Set(body.labels.map((t) => String(t).trim().toLowerCase()).filter(Boolean))];
        if (labels.length > 10) return { ok: false, error: 'Use 10 labels or fewer.' };
        if (labels.some((t) => t.length > 30)) return { ok: false, error: 'Each label must be 30 characters or fewer.' };
        value.labels = labels;
    }
    if ('assignee_id' in body) {
        const assignee = uuidOrNull(body, 'assignee_id', 'assignee');
        if (!assignee.ok) return assignee;
        value.assignee_id = assignee.value;
    }
    if ('is_visible_to_client' in body) {
        if (typeof body.is_visible_to_client !== 'boolean') return { ok: false, error: 'Shared with client must be on or off.' };
        value.is_visible_to_client = body.is_visible_to_client;
    }
    return { ok: true, value };
}

const STEP = 1024;

/** Position between two neighbours. Null means the open end of the column. */
export function nextPosition(before: number | null, after: number | null): number {
    if (before == null && after == null) return STEP;
    if (before == null) return (after as number) - STEP;
    if (after == null) return before + STEP;
    return (before + after) / 2;
}

/** True when two cards in one column are too close to split again. */
export function needsRebalance(positions: number[]): boolean {
    const sorted = [...positions].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] - sorted[i - 1] < 1e-6) return true;
    }
    return false;
}

export function spacedPositions(count: number): number[] {
    return Array.from({ length: count }, (_, i) => (i + 1) * STEP);
}
