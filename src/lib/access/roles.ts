import { unstable_cache } from 'next/cache';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { ACCESS_TAGS } from './invalidate';
import type { RoleGrants } from './roles-core';

export { roleCan, permissionsForRole, type RoleGrants } from './roles-core';

export const getRoleGrants = unstable_cache(
    async (): Promise<RoleGrants> => {
        const supabase = createServerSupabaseClient();
        const { data, error } = await supabase.from('role_permissions').select('role_key, permission_key, granted');
        if (error) throw new Error(`role_permissions read failed: ${error.message}`);

        const grants: RoleGrants = {};
        for (const row of data ?? []) {
            (grants[row.role_key] ??= {})[row.permission_key] = row.granted;
        }
        return grants;
    },
    ['role-grants'],
    { tags: [ACCESS_TAGS.rbac], revalidate: 300 }
);
