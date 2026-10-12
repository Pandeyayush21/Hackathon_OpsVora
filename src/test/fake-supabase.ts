/**
 * Small in-memory stand-in for the Supabase service client, for unit tests.
 * Supports the query-builder calls the app uses (select/eq/neq/is/in/lt/lte/gt/gte/
 * order/limit/maybeSingle/single, insert/update/delete) on flat columns, plus rpc and
 * storage spies. Embedded selects like `projects(name)` are not resolved: put the
 * joined object on the row yourself.
 */
type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

export interface FakeDb {
    tables: Record<string, Row[]>;
    selects: { table: string; columns: string }[];
    rpcCalls: { name: string; args: unknown }[];
    rpcResult: (name: string, args: unknown) => { data: unknown; error: { message: string } | null };
    storageRemoved: string[];
}

export function createFakeDb(tables: Record<string, Row[]> = {}): FakeDb {
    return {
        tables,
        selects: [],
        rpcCalls: [],
        rpcResult: () => ({ data: null, error: null }),
        storageRemoved: [],
    };
}

function builder(db: FakeDb, table: string) {
    const filters: Filter[] = [];
    let mode: 'select' | 'update' | 'delete' = 'select';
    let patch: Row = {};
    let limitN: number | null = null;
    let returning = false;

    const rows = () => (db.tables[table] ?? []).filter((row) => filters.every((f) => f(row)));
    const run = () => {
        const matched = rows();
        if (mode === 'update') {
            for (const row of matched) Object.assign(row, patch);
            return { data: returning ? matched : null, error: null };
        }
        if (mode === 'delete') {
            db.tables[table] = (db.tables[table] ?? []).filter((row) => !matched.includes(row));
            return { data: returning ? matched : null, error: null };
        }
        return { data: limitN == null ? matched : matched.slice(0, limitN), error: null, count: matched.length };
    };

    const q = {
        select(columns = '*') {
            if (mode === 'select') db.selects.push({ table, columns });
            else returning = true;
            return q;
        },
        eq: (col: string, val: unknown) => (filters.push((r) => r[col] === val), q),
        neq: (col: string, val: unknown) => (filters.push((r) => r[col] !== val), q),
        is: (col: string, val: null) => (filters.push((r) => (r[col] ?? null) === val), q),
        in: (col: string, vals: unknown[]) => (filters.push((r) => vals.includes(r[col])), q),
        lt: (col: string, val: string) => (filters.push((r) => String(r[col]) < val), q),
        lte: (col: string, val: string) => (filters.push((r) => String(r[col]) <= val), q),
        gt: (col: string, val: string) => (filters.push((r) => String(r[col]) > val), q),
        gte: (col: string, val: string) => (filters.push((r) => String(r[col]) >= val), q),
        not: (col: string, op: string, val: unknown) => (filters.push((r) => (op === 'is' && val === null ? (r[col] ?? null) !== null : r[col] !== val)), q),
        or: () => q,
        ilike: () => q,
        order: () => q,
        limit: (n: number) => ((limitN = n), q),
        update(values: Row) {
            mode = 'update';
            patch = values;
            return q;
        },
        delete() {
            mode = 'delete';
            return q;
        },
        insert(values: Row | Row[]) {
            const list = Array.isArray(values) ? values : [values];
            db.tables[table] = [...(db.tables[table] ?? []), ...list];
            return { select: () => ({ single: async () => ({ data: list[0], error: null }) }), then: (r: (v: unknown) => void) => r({ data: null, error: null }) };
        },
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        single: async () => {
            const first = run().data;
            return { data: Array.isArray(first) ? first[0] ?? null : first, error: null };
        },
        then: (resolve: (value: unknown) => void, reject?: (err: unknown) => void) => Promise.resolve(run()).then(resolve, reject),
    };
    return q;
}

export function fakeClient(db: FakeDb) {
    return {
        from: (table: string) => builder(db, table),
        rpc: async (name: string, args: unknown) => {
            db.rpcCalls.push({ name, args });
            return db.rpcResult(name, args);
        },
        storage: {
            from: () => ({
                remove: async (paths: string[]) => {
                    db.storageRemoved.push(...paths);
                    return { data: null, error: null };
                },
                list: async () => ({ data: [], error: null }),
            }),
        },
    };
}
