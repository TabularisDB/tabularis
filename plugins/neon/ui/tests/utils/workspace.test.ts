import {describe, expect, it} from 'vitest';
import {parseResource} from '../../src/utils/workspace';

describe('resource workspace IDs', () => {
    it('keeps new-function views distinct from functions named new or create', () => {
        expect(parseResource('function-create')).toEqual({
            service: 'functions',
            createFunction: true,
        });
        expect(parseResource('function:new')).toEqual({service: 'functions', functionSlug: 'new'});
        expect(parseResource('function:create')).toEqual({
            service: 'functions',
            functionSlug: 'create',
        });
    });
    it('decodes identity IDs and rejects malformed or unexpected routes', () => {
        expect(parseResource('auth-user:user%2Fone')).toEqual({
            service: 'users',
            authUserId: 'user/one',
        });
        for (const id of [
            'function:bad-slug',
            'function:%',
            'auth-user:%00',
            'auth-user:%1F',
            'auth-user:',
            'other:one',
        ])
            expect(parseResource(id)).toBeUndefined();
    });
});
