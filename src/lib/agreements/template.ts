/**
 * Agreement templates: plain text with `{{field}}` placeholders. Rendering only substitutes
 * known fields with plain text, so a merge value can never introduce markup or a new placeholder.
 */
import type { AgreementFieldType, AgreementKind, AgreementTemplateField } from '@/lib/types/database';

export const MAX_BODY = 50_000;
export const MAX_VALUE = 500;

/** Placeholders the server always fills in. They are never asked for in the wizard. */
export const BUILTIN_FIELDS = ['agency_name', 'today', 'recipient_name', 'recipient_email'] as const;

/** Suggested fields per kind, offered by the field picker in the template editor. */
export const SUGGESTED_FIELDS: Record<AgreementKind, readonly string[]> = {
    offer_letter: ['role', 'salary', 'start_date', 'reports_to', 'location'],
    client_contract: ['client_name', 'services', 'fee', 'start_date', 'term'],
    nda: ['client_name', 'start_date', 'term'],
    policy: ['start_date'],
    other: [],
};

export const KIND_LABEL: Record<AgreementKind, string> = {
    offer_letter: 'Offer letter',
    client_contract: 'Contract',
    nda: 'NDA',
    policy: 'Policy',
    other: 'Other',
};

const FIELD_TYPES: readonly AgreementFieldType[] = ['text', 'date', 'money', 'number'];
const PLACEHOLDER = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g;

export function isBuiltinField(key: string): boolean {
    return (BUILTIN_FIELDS as readonly string[]).includes(key);
}

/** Every `{{field}}` in the body, in first-seen order, without duplicates. */
export function extractFields(body: string): string[] {
    const keys: string[] = [];
    for (const match of body.matchAll(PLACEHOLDER)) {
        const key = match[1];
        if (!keys.includes(key)) keys.push(key);
    }
    return keys;
}

export function fieldLabel(key: string): string {
    return key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/** Normalise the `fields` array a template editor posts. */
export function parseFields(input: unknown): { ok: true; value: AgreementTemplateField[] } | { ok: false; error: string } {
    if (input == null) return { ok: true, value: [] };
    if (!Array.isArray(input)) return { ok: false, error: 'Fields must be a list.' };
    if (input.length > 40) return { ok: false, error: 'A template can have at most 40 fields.' };
    const seen = new Set<string>();
    const value: AgreementTemplateField[] = [];
    for (const raw of input) {
        if (!raw || typeof raw !== 'object') return { ok: false, error: 'Each field needs a key and a label.' };
        const row = raw as Record<string, unknown>;
        const key = typeof row.key === 'string' ? row.key.trim().toLowerCase() : '';
        if (!/^[a-z][a-z0-9_]*$/.test(key)) return { ok: false, error: 'Field keys use lowercase letters, numbers and underscores.' };
        if (isBuiltinField(key)) continue;
        if (seen.has(key)) return { ok: false, error: `The field ${key} is listed twice.` };
        seen.add(key);
        const type = typeof row.type === 'string' && FIELD_TYPES.includes(row.type as AgreementFieldType) ? (row.type as AgreementFieldType) : 'text';
        const label = typeof row.label === 'string' && row.label.trim() ? row.label.trim().slice(0, 80) : fieldLabel(key);
        value.push({ key, label, type, required: row.required !== false });
    }
    return { ok: true, value };
}

function isIsoDate(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const time = Date.parse(`${value}T00:00:00Z`);
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

/**
 * Check the values a sender filled in against the template's field list. Returns plain strings
 * ready for rendering; unknown keys are dropped rather than passed through.
 */
export function validateMergeValues(
    fields: AgreementTemplateField[],
    values: Record<string, unknown>
): { ok: true; value: Record<string, string> } | { ok: false; error: string } {
    const out: Record<string, string> = {};
    for (const field of fields) {
        const raw = values[field.key];
        const text = raw == null ? '' : String(raw).trim();
        if (!text) {
            if (field.required) return { ok: false, error: `Fill in ${field.label}.` };
            continue;
        }
        if (text.length > MAX_VALUE) return { ok: false, error: `${field.label} is too long (max ${MAX_VALUE} characters).` };
        if (field.type === 'date' && !isIsoDate(text)) {
            return { ok: false, error: `${field.label} must be a date like 2026-10-31.` };
        }
        if (field.type === 'money' && !/^-?\d{1,12}(\.\d{1,2})?$/.test(text)) {
            return { ok: false, error: `${field.label} must be an amount like 45000 or 45000.50.` };
        }
        if (field.type === 'number' && !/^-?\d{1,12}(\.\d{1,4})?$/.test(text)) {
            return { ok: false, error: `${field.label} must be a number.` };
        }
        out[field.key] = text;
    }
    return { ok: true, value: out };
}

/** Values are text, never markup or code: strip anything that could change the document structure. */
function sanitiseValue(value: string): string {
    return value
        .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
        .replace(/[\r\n]+/g, ' ')
        .replace(/[<>]/g, '')
        .replace(/\{\{|\}\}/g, '')
        .slice(0, MAX_VALUE)
        .trim();
}

/**
 * Replace every `{{field}}` with its plain-text value in a single pass, so a value that itself
 * looks like a placeholder is never expanded. Any placeholder without a value is an error.
 */
export function renderTemplate(
    body: string,
    values: Record<string, string>
): { ok: true; text: string } | { ok: false; error: string } {
    if (body.length > MAX_BODY) return { ok: false, error: 'This document is too long.' };
    let missing: string | null = null;
    const text = body.replace(PLACEHOLDER, (_match, key: string) => {
        const value = values[key];
        if (value == null || value === '') {
            missing ??= key;
            return '';
        }
        return sanitiseValue(value);
    });
    if (missing) return { ok: false, error: `Fill in {{${missing}}}.` };
    return { ok: true, text };
}

/** Built-in values available to every document. */
export function builtinValues(input: { agencyName: string; recipientName: string; recipientEmail: string; today?: string }): Record<string, string> {
    return {
        agency_name: input.agencyName,
        today: input.today ?? new Date().toISOString().slice(0, 10),
        recipient_name: input.recipientName,
        recipient_email: input.recipientEmail,
    };
}

export interface SeedTemplate {
    name: string;
    kind: AgreementKind;
    title: string;
    body: string;
    fields: AgreementTemplateField[];
}

function field(key: string, type: AgreementFieldType = 'text', required = true): AgreementTemplateField {
    return { key, label: fieldLabel(key), type, required };
}

/**
 * Starting points created on the first visit to Agreements. Deliberately plain so an agency can
 * read them end to end before sending anything.
 */
export const SEED_TEMPLATES: readonly SeedTemplate[] = [
    {
        name: 'Offer letter',
        kind: 'offer_letter',
        title: 'Offer of employment: {{role}}',
        body: `# Offer of employment

{{today}}

Dear {{recipient_name}},

We are glad to offer you the role of {{role}} at {{agency_name}}.

# The role
- Position: {{role}}
- Reports to: {{reports_to}}
- Location: {{location}}
- Start date: {{start_date}}

# Pay
Your annual salary will be {{salary}}, paid monthly.

# What happens next
Sign this letter to accept the offer. Signing also creates your account in the {{agency_name}} team workspace, where you will find your tasks and projects.

This letter is a starting point and should be reviewed before it is sent. It is not legal advice.

Welcome aboard,
{{agency_name}}`,
        fields: [field('role'), field('reports_to'), field('location'), field('start_date', 'date'), field('salary', 'money')],
    },
    {
        name: 'Service agreement',
        kind: 'client_contract',
        title: 'Service agreement: {{client_name}}',
        body: `# Service agreement

This agreement is between {{agency_name}} and {{client_name}}, dated {{today}}.

# Services
{{agency_name}} will provide: {{services}}

# Term
The work starts on {{start_date}} and runs for {{term}}. Either side may end the agreement with 30 days written notice.

# Fees
The fee is {{fee}}. Invoices are due 14 days after the invoice date.

# Ownership
Once an invoice is paid in full, the work delivered under it belongs to {{client_name}}. {{agency_name}} keeps the right to show the work in its portfolio unless asked not to.

# Confidentiality
Both sides keep the other's business information private and use it only for this work.

This agreement is a starting point and should be reviewed before it is sent. It is not legal advice.`,
        fields: [field('client_name'), field('services'), field('start_date', 'date'), field('term'), field('fee', 'money')],
    },
    {
        name: 'Mutual NDA',
        kind: 'nda',
        title: 'Mutual non-disclosure agreement',
        body: `# Mutual non-disclosure agreement

Between {{agency_name}} and {{client_name}}, dated {{today}}.

# What is confidential
Anything one side shares with the other that is marked confidential, or that a reasonable person would treat as private: plans, pricing, customer lists, designs, code and unreleased work.

# What each side agrees
- Use the other side's confidential information only for the work you are doing together.
- Share it only with people who need it and who are held to the same promise.
- Keep it protected for {{term}} from {{start_date}}.

# What is not covered
Information that is already public, that you already had, or that you worked out on your own without using the other side's material.

This agreement is a starting point and should be reviewed before it is sent. It is not legal advice.`,
        fields: [field('client_name'), field('start_date', 'date'), field('term')],
    },
];
