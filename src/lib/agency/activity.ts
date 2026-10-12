import { createServerSupabaseClient } from '@/lib/supabase/server';

export async function logActivity(input: {
    agencyId: string;
    actorId: string | null;
    action: string;
    target?: string | null;
    metadata?: Record<string, unknown>;
}) {
    const supabase = createServerSupabaseClient();
    const { error } = await supabase.from('agency_activity_logs').insert({
        agency_id: input.agencyId,
        actor_id: input.actorId,
        action: input.action,
        target: input.target ?? null,
        metadata: input.metadata ?? {},
    });
    if (error) console.error('[activity] log failed:', error.message);
}
