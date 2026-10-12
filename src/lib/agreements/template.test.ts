import { describe, expect, it } from 'vitest';
import {
    SEED_TEMPLATES,
    builtinValues,
    extractFields,
    parseFields,
    renderTemplate,
    validateMergeValues,
} from './template';
import type { AgreementTemplateField } from '@/lib/types/database';

const fields: AgreementTemplateField[] = [
    { key: 'role', label: 'Role', type: 'text', required: true },
    { key: 'salary', label: 'Salary', type: 'money', required: true },
    { key: 'start_date', label: 'Start date', type: 'date', required: true },
    { key: 'headcount', label: 'Headcount', type: 'number', required: false },
];

describe('extractFields', () => {
    it('finds placeholders once, in order, and tolerates spacing', () => {
        expect(extractFields('Hi {{recipient_name}}, role {{ role }} at {{agency_name}}. Role again: {{role}}')).toEqual([
            'recipient_name',
            'role',
            'agency_name',
        ]);
    });

    it('ignores things that are not placeholders', () => {
        expect(extractFields('{{Role}} {{1bad}} {single} {{}}')).toEqual([]);
    });
});

describe('validateMergeValues', () => {
    it('accepts well formed values and trims them', () => {
        const result = validateMergeValues(fields, { role: '  Designer ', salary: '45000.50', start_date: '2026-11-01' });
        expect(result).toEqual({ ok: true, value: { role: 'Designer', salary: '45000.50', start_date: '2026-11-01' } });
    });

    it('reports the first missing required field by label', () => {
        expect(validateMergeValues(fields, { role: 'Designer' })).toEqual({ ok: false, error: 'Fill in Salary.' });
    });

    it('rejects bad dates, money and numbers', () => {
        const base = { role: 'Designer', salary: '1000' };
        expect(validateMergeValues(fields, { ...base, start_date: '01/11/2026' })).toEqual({
            ok: false,
            error: 'Start date must be a date like 2026-10-31.',
        });
        expect(validateMergeValues(fields, { ...base, start_date: '2026-02-31' })).toMatchObject({ ok: false });
        expect(validateMergeValues(fields, { role: 'D', salary: 'lots', start_date: '2026-11-01' })).toMatchObject({ ok: false });
        expect(validateMergeValues(fields, { ...base, start_date: '2026-11-01', headcount: 'four' })).toMatchObject({ ok: false });
    });

    it('drops keys that are not template fields', () => {
        const result = validateMergeValues(fields, { role: 'Designer', salary: '1', start_date: '2026-11-01', sneaky: 'x' });
        expect(result).toEqual({ ok: true, value: { role: 'Designer', salary: '1', start_date: '2026-11-01' } });
    });

    it('refuses a value longer than the cap', () => {
        expect(validateMergeValues(fields, { role: 'x'.repeat(501), salary: '1', start_date: '2026-11-01' })).toMatchObject({ ok: false });
    });
});

describe('renderTemplate', () => {
    it('substitutes every known placeholder', () => {
        const result = renderTemplate('Dear {{recipient_name}}, you are our new {{role}}.', { recipient_name: 'Priya', role: 'Designer' });
        expect(result).toEqual({ ok: true, text: 'Dear Priya, you are our new Designer.' });
    });

    it('reports a placeholder with no value', () => {
        expect(renderTemplate('Starts {{start_date}}', {})).toEqual({ ok: false, error: 'Fill in {{start_date}}.' });
    });

    it('cannot be used to inject markup or new placeholders', () => {
        const result = renderTemplate('Role: {{role}}', { role: '<script>alert(1)</script> {{salary}}' });
        expect(result).toMatchObject({ ok: true });
        if (result.ok) {
            expect(result.text).not.toContain('<');
            expect(result.text).not.toContain('{{');
            expect(result.text).toContain('scriptalert(1)/script');
        }
    });

    it('flattens newlines inside a value so headings cannot be forged', () => {
        const result = renderTemplate('Role: {{role}}', { role: 'Designer\n# Pay\nUnlimited' });
        expect(result).toMatchObject({ ok: true });
        if (result.ok) expect(result.text.split('\n')).toHaveLength(1);
    });

    it('does not expand a value that itself looks like a placeholder', () => {
        const result = renderTemplate('{{a}} {{b}}', { a: '{{b}}', b: 'real' });
        expect(result).toMatchObject({ ok: true });
        if (result.ok) expect(result.text).toBe('b real');
    });

    it('handles a very long value by capping it', () => {
        const result = renderTemplate('{{role}}', { role: 'y'.repeat(5000) });
        expect(result).toMatchObject({ ok: true });
        if (result.ok) expect(result.text.length).toBeLessThanOrEqual(500);
    });
});

describe('parseFields', () => {
    it('normalises keys, labels and types', () => {
        const result = parseFields([{ key: ' Start_Date ', type: 'date' }, { key: 'fee', label: 'Monthly fee', type: 'money', required: false }]);
        expect(result).toEqual({
            ok: true,
            value: [
                { key: 'start_date', label: 'Start date', type: 'date', required: true },
                { key: 'fee', label: 'Monthly fee', type: 'money', required: false },
            ],
        });
    });

    it('drops built-in fields and refuses duplicates or bad keys', () => {
        expect(parseFields([{ key: 'agency_name' }])).toEqual({ ok: true, value: [] });
        expect(parseFields([{ key: 'fee' }, { key: 'fee' }])).toMatchObject({ ok: false });
        expect(parseFields([{ key: '2fee' }])).toMatchObject({ ok: false });
        expect(parseFields('nope')).toMatchObject({ ok: false });
    });
});

describe('seed templates', () => {
    it('render once their own fields and the built-ins are filled in', () => {
        const builtins = builtinValues({ agencyName: 'Acme Studio', recipientName: 'Priya Sharma', recipientEmail: 'priya@example.com', today: '2026-10-02' });
        for (const template of SEED_TEMPLATES) {
            const declared = Object.fromEntries(template.fields.map((f) => [f.key, f.type === 'date' ? '2026-11-01' : f.type === 'money' ? '45000' : 'Sample']));
            const values = { ...builtins, ...declared };
            const body = renderTemplate(template.body, values);
            const title = renderTemplate(template.title, values);
            expect(body, template.name).toMatchObject({ ok: true });
            expect(title, template.name).toMatchObject({ ok: true });
        }
    });

    it('declare every placeholder they use', () => {
        for (const template of SEED_TEMPLATES) {
            const declared = new Set([...template.fields.map((f) => f.key), 'agency_name', 'today', 'recipient_name', 'recipient_email']);
            for (const key of extractFields(`${template.title}\n${template.body}`)) {
                expect(declared.has(key), `${template.name}:${key}`).toBe(true);
            }
        }
    });
});
