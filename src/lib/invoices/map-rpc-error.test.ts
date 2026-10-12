import { describe, expect, it } from 'vitest';
import { mapRpcError } from './service';

describe('mapRpcError', () => {
    const cases: [string, number, string][] = [
        ['ALREADY_PAID', 409, 'ALREADY_PAID'],
        ['NOT_PAYABLE', 409, 'NOT_PAYABLE'],
        ['NOT_SENT', 409, 'BAD_STATE'],
        ['REASON_REQUIRED', 400, 'BAD_REQUEST'],
        ['INVOICE_LOCKED', 409, 'INVOICE_LOCKED'],
        ['CLIENT_NOT_FOUND', 400, 'BAD_CLIENT'],
        ['PROJECT_NOT_IN_CLIENT', 400, 'BAD_REQUEST'],
        ['OVERPAYMENT', 400, 'OVERPAYMENT'],
        ['NOT_FOUND', 404, 'NOT_FOUND'],
    ];

    for (const [needle, status, code] of cases) {
        it(`maps ${needle} to ${status}/${code}`, async () => {
            const res = mapRpcError(`RPC failed: ${needle}`);
            expect(res).not.toBeNull();
            expect(res!.status).toBe(status);
            const body = await res!.json();
            expect(body.code).toBe(code);
        });
    }
});
