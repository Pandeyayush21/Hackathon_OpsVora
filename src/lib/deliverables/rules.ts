import { projectAcceptsTasks } from '@/lib/projects/task-rules';
import type { DeliverableLink, DeliverableStatus } from '@/lib/types/database';

// Re-export file helpers for one release; prefer @/lib/files/rules.
export { FILE_LIMITS, sanitizeFileName, validateFileIntent } from '@/lib/files/rules';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ok<T> = { ok: true; value: T };
type Err = { ok: false; error: string };

function str(body: Record<string, unknown>, key: string) {
    return typeof body[key] === 'string' ? body[key].trim() : '';
}

export interface DeliverableInput {
    title?: string;
    project_id?: string;
    task_id?: string | null;
    due_date?: string | null;
}

export function validateDeliverableInput(body: Record<string, unknown>, opts: { partial?: boolean } = {}): Ok<DeliverableInput> | Err {
    const value: DeliverableInput = {};
    const partial = opts.partial === true;

    if (!partial || 'title' in body) {
        const title = str(body, 'title');
        if (!title || title.length > 160) return { ok: false, error: 'Title must be 1 to 160 characters.' };
        value.title = title;
    }
    if (!partial) {
        const projectId = str(body, 'project_id');
        if (!UUID.test(projectId)) return { ok: false, error: 'Choose a project.' };
        value.project_id = projectId;
    }
    if ('task_id' in body) {
        if (body.task_id == null || body.task_id === '') value.task_id = null;
        else if (typeof body.task_id !== 'string' || !UUID.test(body.task_id)) return { ok: false, error: 'Choose a valid task.' };
        else value.task_id = body.task_id;
    }
    if ('due_date' in body) {
        if (body.due_date == null || body.due_date === '') value.due_date = null;
        else if (typeof body.due_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.due_date) || Number.isNaN(Date.parse(body.due_date))) {
            return { ok: false, error: 'Enter a valid date.' };
        } else value.due_date = body.due_date;
    }
    return { ok: true, value };
}

export function validateVersionInput(body: Record<string, unknown>): Ok<{ note: string | null; links: DeliverableLink[] }> | Err {
    let note: string | null = null;
    if ('note' in body && body.note != null) {
        if (typeof body.note !== 'string') return { ok: false, error: 'The note must be text.' };
        if (body.note.length > 5000) return { ok: false, error: 'The note must be 5000 characters or fewer.' };
        note = body.note.trim() || null;
    }
    const links: DeliverableLink[] = [];
    if ('links' in body && body.links != null) {
        if (!Array.isArray(body.links)) return { ok: false, error: 'Links must be a list.' };
        if (body.links.length > 10) return { ok: false, error: 'A version can have at most 10 links.' };
        for (const item of body.links) {
            if (!item || typeof item !== 'object') return { ok: false, error: 'Each link needs a URL.' };
            const row = item as Record<string, unknown>;
            const url = typeof row.url === 'string' ? row.url.trim() : '';
            const label = typeof row.label === 'string' ? row.label.trim() : '';
            let parsed: URL;
            try {
                parsed = new URL(url);
            } catch {
                return { ok: false, error: 'Links must be https URLs.' };
            }
            if (parsed.protocol !== 'https:') return { ok: false, error: 'Links must be https URLs.' };
            if (url.length > 2000) return { ok: false, error: 'A link URL must be 2000 characters or fewer.' };
            if (label.length > 80) return { ok: false, error: 'A link label must be 80 characters or fewer.' };
            links.push({ url, label: label || parsed.hostname });
        }
    }
    return { ok: true, value: { note, links } };
}

export function canEditDeliverable(input: {
    role: string;
    userId: string;
    deliverable: { status: DeliverableStatus | string; created_by: string | null };
    permissions: readonly string[];
}): boolean {
    if (!input.permissions.includes('deliverables.create')) return false;
    if (input.deliverable.status === 'approved') return false;
    if (input.role === 'admin' || input.role === 'manager') return true;
    if (input.role === 'creator') {
        return input.deliverable.created_by === input.userId && (input.deliverable.status === 'draft' || input.deliverable.status === 'changes_requested');
    }
    return false;
}

export function canSubmit(input: {
    permissions: readonly string[];
    deliverable: { status: string; current_version: number };
    version: { version: number; sent_at: string | null; readyFiles: number; links: number };
    project: { status: string; deleted_at?: string | null } | null;
}): boolean {
    if (!input.permissions.includes('deliverables.submit')) return false;
    if (input.deliverable.status !== 'draft' && input.deliverable.status !== 'changes_requested') return false;
    if (input.version.version !== input.deliverable.current_version) return false;
    if (input.version.sent_at) return false;
    if (input.version.readyFiles < 1 && input.version.links < 1) return false;
    return projectAcceptsTasks(input.project);
}

export function canDecide(input: {
    role: string;
    permissions: readonly string[];
    deliverable: { status: string; current_version: number };
    version: number;
}): 'client' | 'staff_for_client' | null {
    if (!input.permissions.includes('deliverables.approve')) return null;
    if (input.deliverable.status !== 'in_review') return null;
    if (input.version !== input.deliverable.current_version) return null;
    if (input.role === 'client') return 'client';
    if (input.role === 'admin' || input.role === 'manager') return 'staff_for_client';
    return null;
}

type Move = 'created' | 'version_added' | 'sent' | 'viewed' | 'approved' | 'changes_requested' | 'reopened' | 'cancelled';

export function nextStatusAfter(event: Move, current: DeliverableStatus | null): DeliverableStatus {
    if (event === 'created') {
        if (current == null) return 'draft';
        throw new Error('ILLEGAL_TRANSITION');
    }
    if (current == null) throw new Error('ILLEGAL_TRANSITION');
    if (event === 'viewed') {
        if (current === 'in_review' || current === 'changes_requested' || current === 'approved') return current;
        throw new Error('ILLEGAL_TRANSITION');
    }
    const table: Record<string, DeliverableStatus> = {
        'version_added:changes_requested': 'draft',
        'sent:draft': 'in_review',
        'approved:in_review': 'approved',
        'changes_requested:in_review': 'changes_requested',
        'reopened:approved': 'draft',
        'cancelled:draft': 'cancelled',
        'cancelled:in_review': 'cancelled',
        'cancelled:changes_requested': 'cancelled',
    };
    const next = table[`${event}:${current}`];
    if (!next) throw new Error('ILLEGAL_TRANSITION');
    return next;
}
