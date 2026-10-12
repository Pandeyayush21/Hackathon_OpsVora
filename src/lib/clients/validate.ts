import { normalizeWebsite } from '@/lib/onboarding/validate';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ClientInput {
    company_name: string;
    website_url: string | null;
    industry: string | null;
    notes: string | null;
    tags: string[];
    owner_id: string | null;
    phone: string | null;
}

export interface ContactInput {
    name: string;
    email: string | null;
    phone: string | null;
    title: string | null;
    is_primary?: boolean;
}

type Ok<T> = { ok: true; value: T };
type Err = { ok: false; error: string };

function str(body: Record<string, unknown>, key: string) {
    return typeof body[key] === 'string' ? body[key].trim() : '';
}

export function validateClientInput(body: Record<string, unknown>, opts: { partial?: boolean } = {}): Ok<Partial<ClientInput>> | Err {
    const value: Partial<ClientInput> = {};
    const partial = opts.partial === true;

    if (!partial || 'company_name' in body) {
        const name = str(body, 'company_name');
        if (!name || name.length > 120) return { ok: false, error: 'Company name must be 1 to 120 characters.' };
        value.company_name = name;
    }
    if (!partial || 'website_url' in body) {
        if (!('website_url' in body) && partial) {
            /* skip */
        } else if (body.website_url == null || body.website_url === '') {
            value.website_url = null;
        } else if (typeof body.website_url !== 'string') {
            return { ok: false, error: 'Website must be a valid URL' };
        } else {
            const site = normalizeWebsite(body.website_url);
            if ('error' in site) return { ok: false, error: site.error };
            value.website_url = site.value;
        }
    }
    if ('industry' in body) {
        const industry = str(body, 'industry');
        if (industry.length > 60) return { ok: false, error: 'Industry must be 60 characters or fewer.' };
        value.industry = industry || null;
    }
    if ('notes' in body) {
        const notes = typeof body.notes === 'string' ? body.notes : '';
        if (notes.length > 5000) return { ok: false, error: 'Notes must be 5000 characters or fewer.' };
        value.notes = notes.trim() || null;
    }
    if ('tags' in body) {
        if (!Array.isArray(body.tags)) return { ok: false, error: 'Tags must be a list.' };
        const tags = [...new Set(body.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean))];
        if (tags.length > 10) return { ok: false, error: 'Use 10 tags or fewer.' };
        if (tags.some((t) => t.length > 30)) return { ok: false, error: 'Each tag must be 30 characters or fewer.' };
        value.tags = tags;
    }
    if ('owner_id' in body) {
        if (body.owner_id == null || body.owner_id === '') value.owner_id = null;
        else if (typeof body.owner_id !== 'string' || !UUID.test(body.owner_id)) return { ok: false, error: 'Choose a valid owner.' };
        else value.owner_id = body.owner_id;
    }
    if ('phone' in body) {
        const phone = str(body, 'phone');
        if (phone.length > 30) return { ok: false, error: 'Phone must be 30 characters or fewer.' };
        value.phone = phone || null;
    }
    if (!partial && !value.company_name) return { ok: false, error: 'Company name must be 1 to 120 characters.' };
    return { ok: true, value };
}

export function validateContactInput(body: Record<string, unknown>, opts: { partial?: boolean } = {}): Ok<Partial<ContactInput>> | Err {
    const value: Partial<ContactInput> = {};
    const partial = opts.partial === true;
    if (!partial || 'name' in body) {
        const name = str(body, 'name');
        if (!name || name.length > 100) return { ok: false, error: 'Contact name must be 1 to 100 characters.' };
        value.name = name;
    }
    if ('email' in body) {
        const email = str(body, 'email').toLowerCase();
        if (!email) value.email = null;
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'Enter a valid email address.' };
        else value.email = email;
    }
    if ('phone' in body) {
        const phone = str(body, 'phone');
        if (phone.length > 30) return { ok: false, error: 'Phone must be 30 characters or fewer.' };
        value.phone = phone || null;
    }
    if ('title' in body) {
        const title = str(body, 'title');
        if (title.length > 60) return { ok: false, error: 'Title must be 60 characters or fewer.' };
        value.title = title || null;
    }
    if ('is_primary' in body) value.is_primary = body.is_primary === true;
    return { ok: true, value };
}
