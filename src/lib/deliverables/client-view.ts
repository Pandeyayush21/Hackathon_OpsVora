import type { DeliverableEventKind, DeliverableLink, DeliverableStatus } from '@/lib/types/database';

const HIDDEN_EVENTS = new Set<DeliverableEventKind>(['created', 'version_added', 'reopened']);

export function clientStatusWords(status: string): string | null {
    if (status === 'in_review') return 'Waiting for you';
    if (status === 'changes_requested') return 'Changes requested';
    if (status === 'approved') return 'Approved';
    return null;
}

export function actorLabel(input: { actor_kind: string; actor_name: string; client_name: string }) {
    if (input.actor_kind === 'client') return `${input.actor_name} at ${input.client_name}`;
    if (input.actor_kind === 'staff_for_client') return `${input.actor_name} for ${input.client_name}`;
    return input.actor_name;
}

export interface ClientFileView {
    id: string;
    file_name: string;
    size_bytes: number;
    mime_type: string | null;
}

export interface ClientVersionView {
    version: number;
    note: string | null;
    links: DeliverableLink[];
    sent_at: string | null;
    files: ClientFileView[];
}

export interface ClientEventView {
    version: number | null;
    kind: string;
    actor: string;
    comment: string | null;
    created_at: string;
}

export function clientVersionView(version: {
    version: number;
    note: string | null;
    links: DeliverableLink[];
    sent_at: string | null;
    files: { id: string; file_name: string; size_bytes: number; mime_type: string | null; status?: string; storage_path?: string }[];
}): ClientVersionView | null {
    if (!version.sent_at) return null;
    return {
        version: version.version,
        note: version.note,
        links: version.links,
        sent_at: version.sent_at,
        files: version.files
            .filter((file) => file.status !== 'pending')
            .map((file) => ({ id: file.id, file_name: file.file_name, size_bytes: file.size_bytes, mime_type: file.mime_type })),
    };
}

export function clientEventView(
    event: { version: number | null; kind: string; actor_kind: string; comment: string | null; created_at: string; actor_id?: string | null },
    names: { actor_name: string; client_name: string }
): ClientEventView | null {
    if (HIDDEN_EVENTS.has(event.kind as DeliverableEventKind)) return null;
    return {
        version: event.version,
        kind: event.kind,
        actor: actorLabel({ actor_kind: event.actor_kind, actor_name: names.actor_name, client_name: names.client_name }),
        comment: event.comment,
        created_at: event.created_at,
    };
}

export function clientListItem(row: {
    id: string;
    title: string;
    status: DeliverableStatus | string;
    project_name: string;
    current_version: number;
    submitted_at: string | null;
    due_date: string | null;
}) {
    const status = clientStatusWords(row.status);
    if (!status) return null;
    return {
        id: row.id,
        title: row.title,
        project_name: row.project_name,
        status,
        version: row.current_version,
        sent_at: row.submitted_at,
        due_date: row.due_date,
    };
}
