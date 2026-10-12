import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

/** Columns that don't exist. Supabase returns an error (which callers often swallow), so catch them here. */
const FORBIDDEN: { table: string; column: string; why: string }[] = [
    { table: 'profiles', column: 'email', why: 'emails live on auth.users; use userContacts() from @/lib/auth/users' },
    { table: 'project_members', column: 'deleted_at', why: 'project_members has no soft delete' },
    { table: 'documents', column: 'created_by', why: 'the column is uploaded_by' },
    { table: 'deliverables', column: 'sent_by', why: 'sent_by is on deliverable_versions' },
];

function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return sourceFiles(path);
        return /\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts') ? [path] : [];
    });
}

describe('queries only use columns that exist', () => {
    const files = sourceFiles(join(process.cwd(), 'src'));
    for (const rule of FORBIDDEN) {
        it(`never selects ${rule.table}.${rule.column} (${rule.why})`, () => {
            const offenders: string[] = [];
            // Same statement, no other .from( in between, and not inside an embedded select like projects(deleted_at).
            const pattern = new RegExp(
                String.raw`from\(['"]${rule.table}['"]\)(?:(?!\.from\()[^;]){0,200}?\.(select|is|eq)\(['"][^'"(]*\b${rule.column}\b`,
                'g'
            );
            for (const file of files) {
                const text = readFileSync(file, 'utf8');
                for (const match of text.matchAll(pattern)) {
                    // Stop at the end of the statement so a later query on another table doesn't count.
                    if (!match[0].includes(';')) offenders.push(file.replace(process.cwd(), ''));
                }
            }
            expect(offenders).toEqual([]);
        });
    }
});
