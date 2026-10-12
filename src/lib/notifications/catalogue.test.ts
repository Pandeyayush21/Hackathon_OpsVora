import { describe, expect, it } from 'vitest';
import { getCatalogueEntry } from './catalogue';
import { CATEGORY_DEFAULTS } from './catalogue';

describe('notification catalogue', () => {
    it('has titles and links for core kinds', () => {
        const entry = getCatalogueEntry('task.assigned');
        expect(entry?.category).toBe('assignment');
        expect(entry?.title({ entityTitle: 'Logo' })).toContain('Logo');
        expect(entry?.link({ slug: 'acme', entityId: 't1' }, 'agency')).toContain('/agency/acme');
    });

    it('skips email for invoice.sent', () => {
        expect(getCatalogueEntry('invoice.sent')?.skipEmail).toBe(true);
    });

    it('has defaults for every category', () => {
        expect(CATEGORY_DEFAULTS.mention).toBe('instant');
        expect(CATEGORY_DEFAULTS.comment).toBe('daily');
    });
});
