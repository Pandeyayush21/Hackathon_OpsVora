import { describe, expect, it } from 'vitest';
import {
    collectMentionIds,
    decodeMentions,
    encodeMentions,
    escapeHtml,
    mentionToken,
    parseMentionTokens,
    previewOf,
    rewriteMentions,
    tokenizeBody,
} from './format';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('mention tokens', () => {
    it('parses tokens from a body', () => {
        const body = `Hi ${mentionToken('Ann Lee', A)} and ${mentionToken('Bo', B)}`;
        expect(parseMentionTokens(body)).toEqual([
            { name: 'Ann Lee', userId: A },
            { name: 'Bo', userId: B },
        ]);
    });

    it('merges token ids with an explicit array, dropping junk and duplicates', () => {
        const body = `ping ${mentionToken('Ann', A)}`;
        expect(collectMentionIds(body, [A.toUpperCase(), B, 'not-a-uuid', 7])).toEqual([A, B]);
    });

    it('rewrites disallowed tokens to plain text', () => {
        const body = `${mentionToken('Ann', A)} ${mentionToken('Bo', B)}`;
        expect(rewriteMentions(body, new Set([A]))).toBe(`${mentionToken('Ann', A)} @Bo`);
    });

    it('strips brackets from names so a token cannot be broken', () => {
        expect(mentionToken('A]nn[', A)).toBe(`@[Ann](user:${A})`);
    });

    it('round trips composer text', () => {
        const picked = [{ name: 'Ann Lee', userId: A }, { name: 'Ann', userId: B }];
        const body = encodeMentions('hey @Ann Lee and @Ann, also @Annabel', picked);
        expect(body).toBe(`hey ${mentionToken('Ann Lee', A)} and ${mentionToken('Ann', B)}, also @Annabel`);
        const back = decodeMentions(body);
        expect(back.text).toBe('hey @Ann Lee and @Ann, also @Annabel');
        expect(back.picked.map((p) => p.userId).sort()).toEqual([A, B]);
    });

    it('previews with names instead of tokens', () => {
        expect(previewOf(`thanks ${mentionToken('Ann', A)}\nlooks good`)).toBe('thanks @Ann looks good');
    });
});

describe('tokenizeBody', () => {
    it('keeps html as text and never builds markup', () => {
        const segments = tokenizeBody('<script>alert(1)</script>');
        expect(segments).toEqual([{ type: 'text', text: '<script>alert(1)</script>' }]);
    });

    it('turns mentions, links and line breaks into segments', () => {
        const segments = tokenizeBody(`Hi ${mentionToken('Ann', A)}\nsee https://example.com/a?b=1.`);
        expect(segments).toEqual([
            { type: 'text', text: 'Hi ' },
            { type: 'mention', name: 'Ann', userId: A },
            { type: 'br' },
            { type: 'text', text: 'see ' },
            { type: 'link', href: 'https://example.com/a?b=1', text: 'https://example.com/a?b=1' },
            { type: 'text', text: '.' },
        ]);
    });

    it('only links http and https', () => {
        const segments = tokenizeBody('javascript:alert(1) and ftp://x.test');
        expect(segments.every((s) => s.type === 'text')).toBe(true);
    });

    it('escapes html for string builders', () => {
        expect(escapeHtml(`<a href="x">&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
    });
});
