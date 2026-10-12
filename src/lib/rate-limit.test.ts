import { describe, expect, it } from 'vitest';
import { memoryLimit } from './rate-limit';

describe('memoryLimit', () => {
    it('allows up to the limit, then blocks until the window slides', () => {
        const key = `test:${Math.random()}`;
        const t0 = 1_000_000;
        for (let i = 0; i < 5; i++) expect(memoryLimit(key, 5, 60_000, t0 + i).success).toBe(true);
        const blocked = memoryLimit(key, 5, 60_000, t0 + 10);
        expect(blocked.success).toBe(false);
        expect(blocked.remaining).toBe(0);
        expect(blocked.reset).toBe(t0 + 60_000);
        // First hit falls out of the window
        expect(memoryLimit(key, 5, 60_000, t0 + 60_001).success).toBe(true);
    });

    it('counts keys separately', () => {
        const t = 2_000_000;
        expect(memoryLimit('test:a', 1, 60_000, t).success).toBe(true);
        expect(memoryLimit('test:a', 1, 60_000, t).success).toBe(false);
        expect(memoryLimit('test:b', 1, 60_000, t).success).toBe(true);
    });
});
