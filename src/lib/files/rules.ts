const MAX_FILE_BYTES = 52_428_800;
const MAX_FILES = 20;
const BLOCKED = new Set(['exe', 'bat', 'cmd', 'sh', 'msi', 'js', 'mjs', 'html', 'htm', 'xhtml', 'svg', 'svgz']);

type Ok<T> = { ok: true; value: T };
type Err = { ok: false; error: string };

export function sanitizeFileName(name: string) {
    // Trailing dots and spaces are dropped too, so "evil.html." can't slip past the extension check.
    return name.replace(/[\u0000-\u001f\u007f]/g, '').replace(/[\\/]/g, '').trim().replace(/[.\s]+$/, '');
}

export function validateFileIntent(input: {
    name: string;
    size: number;
    type?: string | null;
    existingCount?: number;
}): Ok<{ name: string; size: number; type: string | null }> | Err {
    const name = sanitizeFileName(input.name);
    if (!name || name.length > 200) return { ok: false, error: 'File name must be 1 to 200 characters.' };
    if (!Number.isFinite(input.size) || input.size < 1 || input.size > MAX_FILE_BYTES) {
        return { ok: false, error: 'Each file must be between 1 byte and 50 MB.' };
    }
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
    if (BLOCKED.has(ext)) return { ok: false, error: `Files ending in .${ext} are not allowed.` };
    if ((input.existingCount ?? 0) >= MAX_FILES) return { ok: false, error: 'A version can have at most 20 files.' };
    const type = typeof input.type === 'string' && input.type.trim() ? input.type.trim().slice(0, 200) : null;
    return { ok: true, value: { name, size: input.size, type } };
}

export const FILE_LIMITS = { maxBytes: MAX_FILE_BYTES, maxFiles: MAX_FILES };
export const BLOCKED_EXTENSIONS = BLOCKED;
