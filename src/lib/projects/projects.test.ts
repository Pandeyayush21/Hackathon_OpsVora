import { describe, expect, it } from 'vitest';
import { needsRebalance, nextPosition, validateProjectInput, validateTaskInput } from './validate';
import { applyWorkScope, projectsForClients, workAllows, workFromMemberships } from './scope';
import { scopeFromContacts } from '@/lib/clients/scope';
import { canAssign, canClaimTask, canDeleteTask, canEditTask, clientTaskView, projectAcceptsTasks } from './task-rules';

describe('validateProjectInput', () => {
    it('requires a name and a client, and keeps the due date after the start', () => {
        const ok = validateProjectInput({ name: '  Launch  ', client_id: '11111111-1111-1111-1111-111111111111', color: '#3366FF' });
        expect(ok.ok).toBe(true);
        if (ok.ok) expect(ok.value.name).toBe('Launch');
        expect(validateProjectInput({ name: 'Launch' }).ok).toBe(false);
        expect(validateProjectInput({ name: 'Launch', client_id: '11111111-1111-1111-1111-111111111111', start_date: '2026-05-02', due_date: '2026-05-01' }).ok).toBe(false);
    });
});

describe('validateTaskInput', () => {
    it('rejects a project change and normalizes labels', () => {
        expect(validateTaskInput({ title: 'Write brief', project_id: 'x' }).ok).toBe(false);
        const ok = validateTaskInput({ title: 'Write brief', labels: ['Design', 'design', 'Brand'] });
        expect(ok.ok).toBe(true);
        if (ok.ok) expect(ok.value.labels).toEqual(['design', 'brand']);
    });
});

describe('nextPosition', () => {
    it('places a card between neighbours and flags a tiny gap', () => {
        expect(nextPosition(null, null)).toBe(1024);
        expect(nextPosition(1024, null)).toBe(2048);
        expect(nextPosition(1000, 1002)).toBe(1001);
        expect(needsRebalance([1, 1 + 1e-8])).toBe(true);
        expect(needsRebalance([1024, 2048])).toBe(false);
    });
});

describe('work scope', () => {
    it('gives staff every project and a creator only live memberships', () => {
        expect(workFromMemberships('admin', []).kind).toBe('all');
        expect(workFromMemberships('manager', [])).toEqual({ kind: 'all' });
        const empty = workFromMemberships('creator', []);
        expect(empty).toEqual({ kind: 'projects', ids: [] });
        expect(workAllows(empty, 'p')).toBe(false);
        expect(workFromMemberships('creator', [
            { project_id: 'p', deleted: true },
            { project_id: 'q', deleted: false },
        ])).toEqual({ kind: 'projects', ids: ['q'] });
        const calls: string[] = [];
        const query = {
            in: (col: string, ids: string[]) => { calls.push(`in:${col}:${ids.join(',')}`); return query; },
            eq: (col: string, value: string) => { calls.push(`eq:${col}:${value}`); return query; },
        };
        applyWorkScope(query, empty);
        expect(calls[0]?.startsWith('eq:project_id:')).toBe(true);
    });

    it('limits a client to their own live projects', () => {
        const scope = scopeFromContacts('client', [
            { client_id: 'c', portal_status: 'active', deleted: false },
            { client_id: 'gone', portal_status: 'disabled', deleted: false },
        ]);
        expect(projectsForClients(scope, [
            { id: 'mine', client_id: 'c', deleted: false },
            { id: 'other', client_id: 'z', deleted: false },
            { id: 'dead', client_id: 'c', deleted: true },
        ])).toEqual(['mine']);
    });
});

describe('task rules', () => {
    const task = { assigned_spoc_id: 'me', created_by: 'other' };
    it('lets leads edit any task and a creator only their own', () => {
        expect(canEditTask({ role: 'manager', userId: 'x', task, permissions: ['tasks.update'] })).toBe(true);
        expect(canEditTask({ role: 'creator', userId: 'me', task, permissions: ['tasks.update'] })).toBe(true);
        expect(canEditTask({ role: 'creator', userId: 'other', task: { assigned_spoc_id: 'me', created_by: 'other' }, permissions: ['tasks.update'] })).toBe(true);
        expect(canEditTask({ role: 'creator', userId: 'stranger', task, permissions: ['tasks.update'] })).toBe(false);
    });

    it('lets a creator take an open task but not assign someone else', () => {
        expect(canAssign({ role: 'creator', permissions: [], assigneeId: 'me', userId: 'me', currentAssignee: null })).toBe(true);
        expect(canAssign({ role: 'creator', permissions: [], assigneeId: null, userId: 'me', currentAssignee: 'me' })).toBe(true);
        expect(canAssign({ role: 'creator', permissions: [], assigneeId: 'them', userId: 'me', currentAssignee: null })).toBe(false);
        expect(canAssign({ role: 'admin', permissions: ['tasks.assign'], assigneeId: 'them', userId: 'me', currentAssignee: null })).toBe(true);
    });

    it('closes completed projects and hides internal task fields', () => {
        expect(projectAcceptsTasks({ status: 'active' })).toBe(true);
        expect(projectAcceptsTasks({ status: 'completed' })).toBe(false);
        expect(projectAcceptsTasks({ status: 'cancelled' })).toBe(false);
        expect(clientTaskView({ id: 't', title: 'Brief', status: 'todo', due_date: null, completed_at: null, description: 'secret' } as never)).toEqual({
            id: 't', title: 'Brief', status: 'todo', due_date: null, completed_at: null,
        });
    });
});

describe('claiming and deleting tasks', () => {
    const update = ['tasks.update'];
    const open = { assigned_spoc_id: null, created_by: 'lead' };

    it('lets a creator take an unassigned task they did not create', () => {
        expect(canEditTask({ role: 'creator', userId: 'me', task: open, permissions: update })).toBe(false);
        expect(canClaimTask({ role: 'creator', userId: 'me', task: open, assigneeId: 'me', permissions: update })).toBe(true);
    });

    it('does not let a creator claim for someone else or take an assigned task', () => {
        expect(canClaimTask({ role: 'creator', userId: 'me', task: open, assigneeId: 'other', permissions: update })).toBe(false);
        expect(canClaimTask({ role: 'creator', userId: 'me', task: { ...open, assigned_spoc_id: 'other' }, assigneeId: 'me', permissions: update })).toBe(false);
        expect(canClaimTask({ role: 'creator', userId: 'me', task: open, assigneeId: 'me', permissions: [] })).toBe(false);
    });

    it('limits creators with tasks.delete to their own tasks', () => {
        const del = ['tasks.delete'];
        expect(canDeleteTask({ role: 'manager', userId: 'm', task: open, permissions: del })).toBe(true);
        expect(canDeleteTask({ role: 'creator', userId: 'me', task: open, permissions: del })).toBe(false);
        expect(canDeleteTask({ role: 'creator', userId: 'me', task: { ...open, created_by: 'me' }, permissions: del })).toBe(true);
        expect(canDeleteTask({ role: 'admin', userId: 'a', task: open, permissions: [] })).toBe(false);
    });
});
