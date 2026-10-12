import { describe, expect, it } from 'vitest';
import { finalizeSlug, normalizeSlugInput, slugify, slugProblem } from './slug';

describe('slugify (from agency name)', () => {
    it('turns names into clean addresses', () => {
        expect(slugify('Skillvalley')).toBe('skillvalley');
        expect(slugify('Acme & Co.')).toBe('acme-and-co');
        expect(slugify('  Café Crème  Studio ')).toBe('cafe-creme-studio');
        expect(slugify('***')).toBe('');
    });
    it('never ends in a hyphen after truncation', () => {
        const s = slugify('a'.repeat(39) + ' b');
        expect(s.length).toBeLessThanOrEqual(40);
        expect(s.endsWith('-')).toBe(false);
    });
});

describe('normalizeSlugInput (while typing)', () => {
    it('turns spaces and underscores into hyphens', () => {
        expect(normalizeSlugInput('my agency')).toBe('my-agency');
        expect(normalizeSlugInput('my_agency')).toBe('my-agency');
    });
    it('lowercases, drops junk, collapses repeats and leading hyphens', () => {
        expect(normalizeSlugInput('My--Agency!!')).toBe('my-agency');
        expect(normalizeSlugInput('-lead')).toBe('lead');
    });
    it('keeps a trailing hyphen so the user can keep typing', () => {
        expect(normalizeSlugInput('my-')).toBe('my-');
        expect(finalizeSlug('my-')).toBe('my');
    });
    it('caps at 40 characters', () => {
        expect(normalizeSlugInput('x'.repeat(60))).toHaveLength(40);
    });
});

describe('slugProblem', () => {
    it('accepts valid addresses', () => {
        expect(slugProblem('skillvalley')).toBeNull();
        expect(slugProblem('agency-42')).toBeNull();
    });
    it('rejects bad shapes', () => {
        expect(slugProblem('ab')).toMatch(/at least 3/);
        expect(slugProblem('my--agency')).toMatch(/single hyphens/);
        expect(slugProblem('my-')).toMatch(/single hyphens/);
        expect(slugProblem('My')).not.toBeNull();
    });
    it('rejects reserved words, including our own brand', () => {
        expect(slugProblem('admin')).toMatch(/reserved/);
        expect(slugProblem('opsvora')).toMatch(/reserved/);
        expect(slugProblem('agency')).toMatch(/reserved/);
    });
});
