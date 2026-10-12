import { NextRequest, NextResponse } from 'next/server';
import { createClient, User } from '@supabase/supabase-js';

// ── Auth result types (explicit to enable TypeScript narrowing with 'error' in) ──

export type AuthErrorResult = { error: NextResponse };
export type AuthUserResult = AuthErrorResult | { user: User };

const COOKIE_NAME = 'vora_session';

// Lightweight Supabase client for auth verification only (no RLS bypass)
function createAuthClient() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    );
}

// Service-role client for DB lookups (profiles table)
function createAdminClient() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    );
}

/**
 * Extract the access token from cookie or Authorization header.
 */
export function extractToken(request: NextRequest): string | null {
    // 1. Try httpOnly cookie
    const cookie = request.cookies.get(COOKIE_NAME);
    if (cookie?.value) return cookie.value;

    // 2. Fall back to Authorization header (backward compat with super-admin client)
    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
        return authHeader.slice(7);
    }

    return null;
}

/**
 * Verify the request has a valid Supabase session.
 * Returns the authenticated user or a 401 error response.
 */
export async function getAuthUser(request: NextRequest): Promise<AuthUserResult> {
    const token = extractToken(request);

    if (!token) {
        return {
            error: NextResponse.json(
                { error: 'Unauthorized', code: 'NO_TOKEN' },
                { status: 401 }
            ),
        };
    }

    const supabase = createAuthClient();
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
        return {
            error: NextResponse.json(
                { error: 'Unauthorized', code: 'INVALID_TOKEN' },
                { status: 401 }
            ),
        };
    }

    return { user };
}

/**
 * Verify the request user is a platform super-admin.
 * Checks the `platform_admins` table (server-side source of truth).
 */
export async function requireSuperAdmin(request: NextRequest) {
    const auth = await getAuthUser(request);
    if ('error' in auth) return auth;

    const supabase = createAdminClient();
    const { data: adminRecord, error } = await supabase
        .from('platform_admins')
        .select('id')
        .eq('user_id', auth.user.id)
        .single();

    if (error || !adminRecord) {
        return {
            error: NextResponse.json(
                { error: 'Forbidden: Not a platform administrator', code: 'NOT_ADMIN' },
                { status: 403 }
            ),
        };
    }

    return { user: auth.user };
}

const REFRESH_COOKIE_NAME = 'vora_refresh';

/**
 * Helper to set the auth cookies on a response.
 * Stores access token (1hr) and optionally refresh token (7 days).
 */
export function setAuthCookie(response: NextResponse, accessToken: string, refreshToken?: string): NextResponse {
    const isProduction = process.env.NODE_ENV === 'production';

    response.cookies.set(COOKIE_NAME, accessToken, {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax',
        path: '/',
        maxAge: 3600, // 1 hour — matches Supabase default token lifetime
    });

    if (refreshToken) {
        response.cookies.set(REFRESH_COOKIE_NAME, refreshToken, {
            httpOnly: true,
            secure: isProduction,
            sameSite: 'lax',
            path: '/',
            maxAge: 7 * 24 * 3600, // 7 days
        });
    }

    return response;
}

/**
 * Helper to clear the auth cookies on a response.
 */
export function clearAuthCookie(response: NextResponse): NextResponse {
    const isProduction = process.env.NODE_ENV === 'production';

    response.cookies.set(COOKIE_NAME, '', {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax',
        path: '/',
        maxAge: 0,
    });

    response.cookies.set(REFRESH_COOKIE_NAME, '', {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax',
        path: '/',
        maxAge: 0,
    });

    return response;
}
