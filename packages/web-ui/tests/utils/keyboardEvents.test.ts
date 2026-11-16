import {describe, expect, it, vi} from 'vitest';
import {
    getShortcutFocusContext,
    isTextCompositionKeyEvent,
    isTypingTarget,
    onActivationKey,
} from '@/utils/keyboardEvents';

describe('keyboardEvents', () => {
    describe('isTextCompositionKeyEvent', () => {
        it('detects active IME composition', () => {
            const event = new KeyboardEvent('keydown', {key: 'a', isComposing: true});
            expect(isTextCompositionKeyEvent(event)).toBe(true);
        });

        it('detects dead keys', () => {
            const event = new KeyboardEvent('keydown', {key: 'Dead'});
            expect(isTextCompositionKeyEvent(event)).toBe(true);
        });

        it('detects IME process keys', () => {
            const event = new KeyboardEvent('keydown', {key: 'Process'});
            expect(isTextCompositionKeyEvent(event)).toBe(true);
        });

        it('detects unidentified keys', () => {
            const event = new KeyboardEvent('keydown', {key: 'Unidentified'});
            expect(isTextCompositionKeyEvent(event)).toBe(true);
        });

        it('detects compose keys', () => {
            const event = new KeyboardEvent('keydown', {key: 'Compose'});
            expect(isTextCompositionKeyEvent(event)).toBe(true);
        });

        it('detects legacy IME keyCode 229', () => {
            const event = new KeyboardEvent('keydown', {
                key: 'a',
                keyCode: 229,
            } as KeyboardEventInit);
            expect(isTextCompositionKeyEvent(event)).toBe(true);
        });

        it('lets ordinary shortcut key events through', () => {
            const event = new KeyboardEvent('keydown', {
                key: 'p',
                ctrlKey: true,
                shiftKey: true,
            });
            expect(isTextCompositionKeyEvent(event)).toBe(false);
        });
    });

    describe('onActivationKey', () => {
        const keyEvent = (key: string, nested = false) => {
            const currentTarget = document.createElement('div');
            const target = nested ? document.createElement('input') : currentTarget;
            return {key, target, currentTarget, preventDefault: vi.fn()};
        };

        it.each(['Enter', ' '])('activates on %j and prevents the default action', (key) => {
            const activate = vi.fn();
            const event = keyEvent(key);
            onActivationKey(activate)(event);
            expect(activate).toHaveBeenCalledWith(event);
            expect(event.preventDefault).toHaveBeenCalled();
        });

        it('ignores other keys', () => {
            const activate = vi.fn();
            const event = keyEvent('a');
            onActivationKey(activate)(event);
            expect(activate).not.toHaveBeenCalled();
            expect(event.preventDefault).not.toHaveBeenCalled();
        });

        it('ignores keys pressed inside a nested control', () => {
            const activate = vi.fn();
            const event = keyEvent('Enter', true);
            onActivationKey(activate)(event);
            expect(activate).not.toHaveBeenCalled();
            expect(event.preventDefault).not.toHaveBeenCalled();
        });
    });

    describe('isTypingTarget', () => {
        it('returns false for null and undefined', () => {
            expect(isTypingTarget(null)).toBe(false);
            expect(isTypingTarget(undefined)).toBe(false);
        });

        it('returns false for non-HTMLElement targets', () => {
            expect(isTypingTarget(window as unknown as EventTarget)).toBe(false);
            expect(isTypingTarget(document as unknown as EventTarget)).toBe(false);
        });

        it('returns false for plain elements', () => {
            const div = document.createElement('div');
            const span = document.createElement('span');
            const button = document.createElement('button');
            expect(isTypingTarget(div)).toBe(false);
            expect(isTypingTarget(span)).toBe(false);
            expect(isTypingTarget(button)).toBe(false);
        });

        it('returns true for textarea elements', () => {
            const textarea = document.createElement('textarea');
            expect(isTypingTarget(textarea)).toBe(true);
        });

        it('returns true for select elements', () => {
            const select = document.createElement('select');
            expect(isTypingTarget(select)).toBe(true);
        });

        it.each([
            ['text (default)', document.createElement('input')],
            ['text', Object.assign(document.createElement('input'), {type: 'text'})],
            ['password', Object.assign(document.createElement('input'), {type: 'password'})],
            ['search', Object.assign(document.createElement('input'), {type: 'search'})],
            ['number', Object.assign(document.createElement('input'), {type: 'number'})],
            ['email', Object.assign(document.createElement('input'), {type: 'email'})],
            ['url', Object.assign(document.createElement('input'), {type: 'url'})],
            ['tel', Object.assign(document.createElement('input'), {type: 'tel'})],
        ])('returns true for text-like input type: %s', (_, input) => {
            expect(isTypingTarget(input)).toBe(true);
        });

        it.each([
            ['checkbox', 'checkbox'],
            ['radio', 'radio'],
            ['button', 'button'],
            ['range', 'range'],
            ['color', 'color'],
            ['file', 'file'],
            ['hidden', 'hidden'],
            ['image', 'image'],
            ['reset', 'reset'],
            ['submit', 'submit'],
        ])('returns false for non-text input type: %s', (_, type) => {
            const input = document.createElement('input');
            input.type = type;
            expect(isTypingTarget(input)).toBe(false);
        });

        it('returns true for contenteditable elements', () => {
            const div = document.createElement('div');
            div.contentEditable = 'true';
            expect(isTypingTarget(div)).toBe(true);
        });
    });
});

describe('getShortcutFocusContext', () => {
    it('treats a Monaco descendant as editable even without a text input', () => {
        const editor = document.createElement('div');
        editor.className = 'monaco-editor';
        const child = document.createElement('span');
        editor.append(child);
        expect(getShortcutFocusContext(child)).toEqual({
            inMonaco: true,
            inEditable: true,
        });
    });

    it.each(['input', 'textarea', 'select'])('recognizes a plain %s', (tag) => {
        expect(getShortcutFocusContext(document.createElement(tag))).toEqual({
            inMonaco: false,
            inEditable: true,
        });
    });

    it('recognizes contentEditable and its descendants', () => {
        const editable = document.createElement('div');
        editable.setAttribute('contenteditable', 'true');
        const child = document.createElement('span');
        editable.append(child);
        expect(getShortcutFocusContext(editable)).toEqual({
            inMonaco: false,
            inEditable: true,
        });
        expect(getShortcutFocusContext(child)).toEqual({
            inMonaco: false,
            inEditable: true,
        });
    });

    it.each(['button', 'body'])('recognizes a non-editable %s', (tag) => {
        expect(getShortcutFocusContext(document.createElement(tag))).toEqual({
            inMonaco: false,
            inEditable: false,
        });
    });

    it('accepts a missing focus element', () => {
        expect(getShortcutFocusContext(null)).toEqual({
            inMonaco: false,
            inEditable: false,
        });
    });
});
