import {describe, expect, it} from 'vitest';
import {consoleUrl} from '../../src/utils/console';

describe('Neon console links', () => {
    it('targets the bound project and branch, with a project-only legacy fallback', () => {
        expect(consoleUrl({projectId: 'project-one', branchId: 'br-one'})).toBe(
            'https://console.neon.tech/app/projects/project-one/branches/br-one',
        );
        expect(consoleUrl({projectId: 'project-two', branchId: null})).toBe(
            'https://console.neon.tech/app/projects/project-two',
        );
    });
    it('never falls back to the global console for missing or invalid bindings', () => {
        for (const binding of [
            {projectId: null},
            {projectId: ''},
            {projectId: '../../other'},
            {projectId: 'https://other.test'},
            {projectId: 'project-one', branchId: '../other'},
        ]) {
            expect(consoleUrl(binding)).toBeUndefined();
        }
    });
});
