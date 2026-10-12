import { isReservedSlug } from '@/lib/auth/reserved-slugs';

// Workspace URL slugs: /agency/<slug>. Shared by the claim form and API.

export function slugify(input: string): string {
    return input
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40)
        .replace(/-+$/g, '');
}

/** Returns an error message, or null if the slug is acceptable. */
export function slugProblem(slug: string): string | null {
    if (slug.length < 3) return 'Use at least 3 characters';
    if (slug.length > 40) return 'Use at most 40 characters';
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return 'Use lowercase letters, numbers and single hyphens';
    if (isReservedSlug(slug)) return 'That address is reserved';
    return null;
}

export const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * Clean what someone types into the address field, keystroke by keystroke:
 * spaces/underscores become hyphens, repeats collapse, junk is dropped.
 * A trailing hyphen is kept so "my-" can become "my-agency"; use finalizeSlug() before saving.
 */
export function normalizeSlugInput(value: string): string {
    return value
        .toLowerCase()
        .replace(/[\s_]+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-{2,}/g, '-')
        .replace(/^-+/, '')
        .slice(0, 40);
}

/** Drop any trailing hyphen left over from typing. */
export function finalizeSlug(value: string): string {
    return value.replace(/-+$/, '');
}

/** Host from NEXT_PUBLIC_APP_URL, or "opsvora.com". Same on server and client, safe to render. */
export function appHostStatic(): string {
    const configured = process.env.NEXT_PUBLIC_APP_URL;
    if (configured) {
        try {
            return new URL(configured).host;
        } catch {
            /* fall through */
        }
    }
    return 'opsvora.com';
}

/**
 * Host shown in front of the workspace address, e.g. "opsvora.com". Falls back to the browser's
 * host when no app URL is configured. In components, read it through useAppHost() so the first
 * render matches the server.
 */
export function appHost(): string {
    if (process.env.NEXT_PUBLIC_APP_URL) return appHostStatic();
    return typeof window !== 'undefined' ? window.location.host : appHostStatic();
}
