import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb, fakeClient, type FakeDb } from '@/test/fake-supabase';

let db: FakeDb;
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: () => fakeClient(db) }));
vi.mock('@/lib/agency/activity', () => ({ logActivity: async () => undefined }));
vi.mock('@/lib/email/invoices', () => ({
    sendInvoiceEmail: async () => true,
    sendInvoiceReminder: async () => true,
    sendPaymentReceipt: async () => true,
}));

const { deletePayment, voidInvoice } = await import('./service');

const mine = { agencyId: 'agency-a', userId: 'u1', role: 'admin' };

beforeEach(() => {
    db = createFakeDb({
        invoices: [
            { id: 'inv-a', agency_id: 'agency-a', status: 'sent', deleted_at: null, number: 'INV-0001', total_minor: 100, paid_minor: 0 },
            { id: 'inv-b', agency_id: 'agency-b', status: 'sent', deleted_at: null, number: 'INV-0001', total_minor: 100, paid_minor: 0 },
        ],
        invoice_payments: [
            { id: 'pay-a', invoice_id: 'inv-a', agency_id: 'agency-a' },
            { id: 'pay-b', invoice_id: 'inv-b', agency_id: 'agency-b' },
        ],
    });
});

describe('cross-agency protection', () => {
    it("won't void another agency's invoice", async () => {
        const res = await voidInvoice(mine, 'inv-b', { reason: 'test' });
        expect(res.status).toBe(404);
        expect(db.rpcCalls).toHaveLength(0);
    });

    it("won't delete another agency's payment, even through your own invoice id", async () => {
        const viaTheirs = await deletePayment(mine, 'inv-b', 'pay-b');
        expect(viaTheirs.status).toBe(404);
        const viaMine = await deletePayment(mine, 'inv-a', 'pay-b');
        expect(viaMine.status).toBe(404);
        expect(db.rpcCalls).toHaveLength(0);
    });

    it('does act on your own invoice', async () => {
        await voidInvoice(mine, 'inv-a', { reason: 'Wrong amount' });
        expect(db.rpcCalls.map((call) => call.name)).toEqual(['void_invoice']);
    });
});
