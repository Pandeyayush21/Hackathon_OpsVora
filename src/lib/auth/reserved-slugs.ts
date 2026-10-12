/**
 * Reserved slugs that cannot be used as agency slugs.
 * These match route segments, system paths, or common words
 * that would conflict with the application routing.
 */
const RESERVED_SLUGS = new Set([
    // System routes
    'admin',
    'api',
    'portal',
    'login',
    'logout',
    'register',
    'signup',
    'sign',
    'signing',
    'claim',
    'invite',
    'team-invite',
    'super-admin',
    'suspended',
    'branding-setup',
    'reset-password',

    // Common words that shouldn't be slugs
    'app',
    'dashboard',
    'settings',
    'help',
    'support',
    'billing',
    'pricing',
    'docs',
    'blog',
    'about',
    'contact',
    'terms',
    'privacy',
    'status',
    'health',
    'www',
    'mail',
    'email',
    'ftp',
    'cdn',
    'assets',
    'static',
    'public',
    'new',
    'edit',
    'delete',
    'create',
    'update',

    // Brand
    'vora',
    'vorahq',
    'opsvora',
    'agency',
    'agencies',
    'client',
    'clients',
    'team',
]);

/**
 * Check if a slug is reserved and cannot be used.
 */
export function isReservedSlug(slug: string): boolean {
    return RESERVED_SLUGS.has(slug.toLowerCase().trim());
}
