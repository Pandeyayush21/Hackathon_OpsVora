/** Pure helpers for comment bodies: mention tokens and display segments. */

export const MAX_COMMENT_LENGTH = 5000;
export const MAX_MENTIONS = 20;

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const MENTION_SOURCE = `@\\[([^\\]\\n]{1,80})\\]\\(user:(${UUID})\\)`;
const URL_SOURCE = 'https?:\\/\\/[^\\s<>"\']+';

export type BodySegment =
    | { type: 'text'; text: string }
    | { type: 'mention'; name: string; userId: string }
    | { type: 'link'; href: string; text: string }
    | { type: 'br' };

export function isUuid(value: unknown): value is string {
    return typeof value === 'string' && new RegExp(`^${UUID}$`).test(value);
}

/** Token written into the body when a user is picked from the @ menu. */
export function mentionToken(name: string, userId: string): string {
    const safe = name.replace(/[\[\]\n]/g, '').trim().slice(0, 80) || 'user';
    return `@[${safe}](user:${userId.toLowerCase()})`;
}

export interface ParsedMention {
    name: string;
    userId: string;
}

export function parseMentionTokens(body: string): ParsedMention[] {
    const re = new RegExp(MENTION_SOURCE, 'g');
    const out: ParsedMention[] = [];
    let match: RegExpExecArray | null;
    while ((match = re.exec(body))) out.push({ name: match[1], userId: match[2].toLowerCase() });
    return out;
}

/** Unique, lower-cased mention ids from tokens plus an optional explicit array. */
export function collectMentionIds(body: string, extra?: unknown): string[] {
    const ids = new Set<string>();
    for (const m of parseMentionTokens(body)) ids.add(m.userId);
    if (Array.isArray(extra)) {
        for (const value of extra) if (isUuid(value)) ids.add(value.toLowerCase());
    }
    return [...ids].slice(0, MAX_MENTIONS);
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Composer text shows `@Name`; this turns every picked name that is still in the text into a
 * token. Longest names go first so "@Ann Lee" wins over "@Ann".
 */
export function encodeMentions(text: string, picked: ParsedMention[]): string {
    const byName = new Map<string, ParsedMention>();
    for (const p of picked) byName.set(p.name, p);
    let out = text;
    const names = [...byName.keys()].sort((a, b) => b.length - a.length);
    for (const name of names) {
        const p = byName.get(name)!;
        const re = new RegExp(`(^|[^\\w\\[])@${escapeRegExp(name)}(?![\\w])`, 'g');
        out = out.replace(re, (_all, lead: string) => `${lead}${mentionToken(p.name, p.userId)}`);
    }
    return out;
}

/** Inverse of encodeMentions, for editing an existing comment. */
export function decodeMentions(body: string): { text: string; picked: ParsedMention[] } {
    const picked = new Map<string, ParsedMention>();
    for (const m of parseMentionTokens(body)) picked.set(m.userId, m);
    return { text: stripMentionTokens(body), picked: [...picked.values()] };
}

/** Tokens for users who may not be mentioned become a plain `@Name`. */
export function rewriteMentions(body: string, allowed: Set<string>): string {
    return body.replace(new RegExp(MENTION_SOURCE, 'g'), (_all, name: string, id: string) =>
        allowed.has(id.toLowerCase()) ? `@[${name}](user:${id.toLowerCase()})` : `@${name}`,
    );
}

/** Tokens shown as `@Name`, for notification previews and emails. */
export function stripMentionTokens(body: string): string {
    return body.replace(new RegExp(MENTION_SOURCE, 'g'), (_all, name: string) => `@${name}`);
}

export function previewOf(body: string, max = 140): string {
    const flat = stripMentionTokens(body).replace(/\s+/g, ' ').trim();
    return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

const TRAILING = /[.,;:!?)\]}]+$/;

function safeHref(raw: string): { href: string; text: string; rest: string } | null {
    const trail = raw.match(TRAILING)?.[0] ?? '';
    const url = trail ? raw.slice(0, raw.length - trail.length) : raw;
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
        return { href: parsed.toString(), text: url, rest: trail };
    } catch {
        return null;
    }
}

function linkify(text: string, out: BodySegment[]) {
    const re = new RegExp(URL_SOURCE, 'g');
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
        const link = safeHref(match[0]);
        if (!link) continue;
        if (match.index > last) out.push({ type: 'text', text: text.slice(last, match.index) });
        out.push({ type: 'link', href: link.href, text: link.text });
        if (link.rest) out.push({ type: 'text', text: link.rest });
        last = match.index + match[0].length;
    }
    if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
}

function withMentions(line: string, out: BodySegment[]) {
    const re = new RegExp(MENTION_SOURCE, 'g');
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(line))) {
        if (match.index > last) linkify(line.slice(last, match.index), out);
        out.push({ type: 'mention', name: match[1], userId: match[2].toLowerCase() });
        last = match.index + match[0].length;
    }
    if (last < line.length) linkify(line.slice(last), out);
}

/**
 * Split a body into render segments. Output is data only: the renderer must emit text as
 * text nodes, so HTML in a body is never interpreted.
 */
export function tokenizeBody(body: string): BodySegment[] {
    const out: BodySegment[] = [];
    const lines = body.replace(/\r\n?/g, '\n').split('\n');
    lines.forEach((line, i) => {
        if (i > 0) out.push({ type: 'br' });
        withMentions(line, out);
    });
    return out;
}

/** HTML escape, for any caller that has to build a string (e.g. email). */
export function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
