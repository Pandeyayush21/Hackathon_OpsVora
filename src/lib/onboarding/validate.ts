import { HEX_COLOR } from './slug';

export { HEX_COLOR };

/** Empty string clears the website. Otherwise require a real URL, adding https:// when missing. */
export function normalizeWebsite(input: string): { value: string | null } | { error: string } {
    const raw = input.trim();
    if (!raw) return { value: null };
    const website = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
        new URL(website);
    } catch {
        return { error: 'Website must be a valid URL' };
    }
    return { value: website };
}
