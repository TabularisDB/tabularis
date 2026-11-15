import {describe, it, expect, vi, beforeEach} from 'vitest';
import {render, screen, fireEvent, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {JsonEditorProps, NodeData} from 'json-edit-react';
import {buildExpandToLevelTrigger, compareJsonKeys} from '@/utils/jsonTree';

type CapturedProps = JsonEditorProps & {
    restrictEdit?: boolean;
    restrictAdd?: boolean;
    restrictDelete?: boolean;
    restrictTypeSelection?: boolean;
};

const lastProps: {current: CapturedProps | null} = {current: null};

vi.mock('json-edit-react', () => ({
    JsonEditor: (props: CapturedProps) => {
        lastProps.current = props;
        return <div data-testid="mock-json-editor">{JSON.stringify(props.data)}</div>;
    },
    defaultTheme: {displayName: 'default', styles: {}},
    githubDarkTheme: {displayName: 'githubDark', styles: {}},
    githubLightTheme: {displayName: 'githubLight', styles: {}},
}));

// eslint-disable-next-line import/first
import {JsonTreeView} from '@/components/ui/JsonTreeView';

describe('JsonTreeView', () => {
    beforeEach(() => {
        lastProps.current = null;
    });

    it('renders nested data through the underlying JSON editor', () => {
        const data = {name: 'Alice', nested: {count: 3}};
        render(<JsonTreeView value={data} onChange={() => {}} />);

        expect(screen.getByTestId('mock-json-editor')).toBeInTheDocument();
        expect(lastProps.current).not.toBeNull();
        expect(lastProps.current!.data).toEqual(data);
    });

    it('allows leaf edits but restricts structural mutations when onChange is provided', () => {
        render(<JsonTreeView value={{a: 1}} onChange={() => {}} />);

        expect(lastProps.current!.restrictEdit).toBe(false);
        expect(lastProps.current!.restrictAdd).toBe(true);
        expect(lastProps.current!.restrictDelete).toBe(true);
        expect(lastProps.current!.restrictTypeSelection).toBe(true);
    });

    it('is view-only when readOnly is true', () => {
        render(<JsonTreeView value={{a: 1}} onChange={() => {}} readOnly />);

        expect(lastProps.current!.restrictEdit).toBe(true);
        expect(lastProps.current!.restrictAdd).toBe(true);
        expect(lastProps.current!.restrictDelete).toBe(true);
        expect(lastProps.current!.restrictTypeSelection).toBe(true);
    });

    it('is view-only when onChange is omitted', () => {
        render(<JsonTreeView value={{a: 1}} />);

        expect(lastProps.current!.restrictEdit).toBe(true);
        expect(lastProps.current!.restrictAdd).toBe(true);
        expect(lastProps.current!.restrictDelete).toBe(true);
        expect(lastProps.current!.restrictTypeSelection).toBe(true);
    });

    it('emits onChange when the underlying editor reports updated data', () => {
        const onChange = vi.fn();
        render(<JsonTreeView value={{a: 1}} onChange={onChange} />);

        const setData = lastProps.current!.setData;
        expect(setData).toBeTypeOf('function');
        setData!({a: 2});

        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith({a: 2});
    });

    it('does not provide setData when in read-only mode', () => {
        render(<JsonTreeView value={{a: 1}} readOnly onChange={() => {}} />);
        expect(lastProps.current!.setData).toBeUndefined();
    });

    it("forwards searchQuery to the editor's searchText prop", () => {
        render(<JsonTreeView value={{a: 1}} searchQuery="needle" />);
        expect(lastProps.current!.searchText).toBe('needle');
    });

    it("wires onCopy through the editor's enableClipboard callback", () => {
        const onCopy = vi.fn();
        render(<JsonTreeView value={{a: 1}} onCopy={onCopy} />);

        const clipboard = lastProps.current!.enableClipboard;
        expect(typeof clipboard).toBe('function');

        if (typeof clipboard === 'function') {
            clipboard({
                success: true,
                errorMessage: null,
                key: 'a',
                path: ['a'],
                value: 1,
                stringValue: '1',
                type: 'value',
            });
        }

        expect(onCopy).toHaveBeenCalledWith('1');
    });

    it('provides a theme object to the underlying editor', () => {
        render(<JsonTreeView value={{a: 1}} />);
        expect(lastProps.current!.theme).toBeDefined();
    });

    describe('leaf editing', () => {
        it('emits onChange with updated root when a string leaf is edited', () => {
            const onChange = vi.fn();
            render(<JsonTreeView value={{name: 'Alice', age: 30}} onChange={onChange} />);

            lastProps.current!.setData!({name: 'Bob', age: 30});

            expect(onChange).toHaveBeenCalledTimes(1);
            expect(onChange).toHaveBeenCalledWith({name: 'Bob', age: 30});
        });

        it('emits onChange with updated root when a numeric leaf is edited', () => {
            const onChange = vi.fn();
            render(<JsonTreeView value={{count: 1}} onChange={onChange} />);

            lastProps.current!.setData!({count: 42});

            expect(onChange).toHaveBeenCalledTimes(1);
            expect(onChange).toHaveBeenCalledWith({count: 42});
        });

        it('emits onChange with updated root when a boolean leaf is toggled', () => {
            const onChange = vi.fn();
            render(<JsonTreeView value={{active: false}} onChange={onChange} />);

            lastProps.current!.setData!({active: true});

            expect(onChange).toHaveBeenCalledTimes(1);
            expect(onChange).toHaveBeenCalledWith({active: true});
        });

        it('disallows adding new keys via restrictAdd and restrictTypeSelection', () => {
            render(<JsonTreeView value={{a: 1}} onChange={() => {}} />);

            expect(lastProps.current!.restrictAdd).toBe(true);
            expect(lastProps.current!.restrictTypeSelection).toBe(true);
        });

        it('does not call onChange when no onChange prop is provided', () => {
            render(<JsonTreeView value={{a: 1}} />);

            expect(lastProps.current!.setData).toBeUndefined();
        });
    });

    describe('search', () => {
        it('renders a controlled search input when no external searchQuery is provided', () => {
            render(<JsonTreeView value={{a: 1}} />);
            const input = screen.getByPlaceholderText('jsonInput.search');
            expect(input).toBeInTheDocument();
            expect((input as HTMLInputElement).value).toBe('');
        });

        it('does not render the internal search input when searchQuery is provided', () => {
            render(<JsonTreeView value={{a: 1}} searchQuery="" />);
            expect(screen.queryByPlaceholderText('jsonInput.search')).not.toBeInTheDocument();
        });

        it("forwards typed text from the internal input to the editor's searchText", () => {
            render(<JsonTreeView value={{name: 'Alice', nested: {count: 3}}} />);
            const input = screen.getByPlaceholderText('jsonInput.search') as HTMLInputElement;

            fireEvent.change(input, {target: {value: 'Alice'}});
            expect(input.value).toBe('Alice');
            expect(lastProps.current!.searchText).toBe('Alice');
        });

        it("clears the editor's searchText when the internal input is cleared", () => {
            render(<JsonTreeView value={{name: 'Alice'}} />);
            const input = screen.getByPlaceholderText('jsonInput.search') as HTMLInputElement;

            fireEvent.change(input, {target: {value: 'Alice'}});
            expect(lastProps.current!.searchText).toBe('Alice');

            fireEvent.change(input, {target: {value: ''}});
            expect(input.value).toBe('');
            expect(lastProps.current!.searchText).toBe('');
        });

        it("forwards the user's text verbatim so the library can do case-insensitive matching", () => {
            render(<JsonTreeView value={{Name: 'Alice'}} />);
            const input = screen.getByPlaceholderText('jsonInput.search') as HTMLInputElement;

            fireEvent.change(input, {target: {value: 'alice'}});
            expect(lastProps.current!.searchText).toBe('alice');

            fireEvent.change(input, {target: {value: 'ALICE'}});
            expect(lastProps.current!.searchText).toBe('ALICE');
        });

        it('configures searchFilter to match both keys and values', () => {
            render(<JsonTreeView value={{a: 1}} />);
            expect(lastProps.current!.searchFilter).toBe('all');
        });

        it('prefers the external searchQuery over the internal input state', () => {
            const {rerender} = render(<JsonTreeView value={{a: 1}} searchQuery="external" />);
            expect(lastProps.current!.searchText).toBe('external');

            rerender(<JsonTreeView value={{a: 1}} searchQuery="updated" />);
            expect(lastProps.current!.searchText).toBe('updated');
        });
    });

    describe('customNodeDefinitions (links and colors)', () => {
        it('passes customNodeDefinitions with link and color conditions', () => {
            render(<JsonTreeView value={{url: 'https://example.com', color: '#1e90ff'}} />);

            const defs = lastProps.current!.customNodeDefinitions;
            expect(defs).toBeDefined();
            expect(defs!.length).toBe(2);

            const [linkDef, colorDef] = defs!;

            // Link condition matches URLs and mailto
            expect(linkDef.condition({value: 'https://example.com'} as unknown as NodeData)).toBe(
                true,
            );
            expect(
                linkDef.condition({value: 'mailto:support@tabularis.dev'} as unknown as NodeData),
            ).toBe(true);
            expect(linkDef.condition({value: 'not-a-link'} as unknown as NodeData)).toBe(false);

            // Color condition matches hex, rgb, hsl
            expect(colorDef.condition({value: '#1e90ff'} as unknown as NodeData)).toBe(true);
            expect(colorDef.condition({value: 'rgb(255, 0, 0)'} as unknown as NodeData)).toBe(true);
            expect(colorDef.condition({value: 'not-a-color'} as unknown as NodeData)).toBe(false);

            // Does not interfere with editing
            expect(linkDef.showOnEdit).toBe(false);
            expect(colorDef.showOnEdit).toBe(false);
        });
    });

    describe('expand all / collapse all', () => {
        const nested = {a: {b: [1, {c: 'x'}]}, d: [[1], [2]]};
        const variants = [
            {name: 'compact view-only', props: {}},
            {name: 'compact editable', props: {onChange: () => {}}},
            {name: 'full-height view-only', props: {fillHeight: true}},
            {
                name: 'full-height editable',
                props: {fillHeight: true, onChange: () => {}},
            },
        ];

        it.each(variants)('renders accessible buttons ($name)', ({props}) => {
            render(<JsonTreeView value={nested} {...props} />);
            expect(screen.getByRole('button', {name: 'jsonInput.expandAll'})).toBeEnabled();
            expect(screen.getByRole('button', {name: 'jsonInput.collapseAll'})).toBeEnabled();
        });

        it.each(variants)(
            'triggers the library collapse API without changing data ($name)',
            ({props}) => {
                const onChange = vi.fn();
                render(
                    <JsonTreeView
                        value={nested}
                        {...props}
                        {...('onChange' in props ? {onChange} : {})}
                    />,
                );
                expect(lastProps.current!.externalTriggers).toBeUndefined();

                fireEvent.click(screen.getByRole('button', {name: 'jsonInput.collapseAll'}));
                expect(lastProps.current!.externalTriggers).toEqual({
                    collapse: {path: [], collapsed: true, includeChildren: true},
                });

                fireEvent.click(screen.getByRole('button', {name: 'jsonInput.expandAll'}));
                expect(lastProps.current!.externalTriggers).toEqual({
                    collapse: {path: [], collapsed: false, includeChildren: true},
                });

                expect(lastProps.current!.data).toBe(nested);
                expect(onChange).not.toHaveBeenCalled();
            },
        );

        it('issues a new trigger object on repeated clicks', () => {
            render(<JsonTreeView value={nested} />);
            const button = screen.getByRole('button', {
                name: 'jsonInput.collapseAll',
            });
            fireEvent.click(button);
            const first = lastProps.current!.externalTriggers;
            fireEvent.click(button);
            expect(lastProps.current!.externalTriggers).not.toBe(first);
        });

        it('keeps the search text when toggling', () => {
            render(<JsonTreeView value={nested} />);
            fireEvent.change(screen.getByPlaceholderText('jsonInput.search'), {
                target: {value: 'x'},
            });
            fireEvent.click(screen.getByRole('button', {name: 'jsonInput.collapseAll'}));
            expect(lastProps.current!.searchText).toBe('x');
            expect(lastProps.current!.searchFilter).toBe('all');
        });

        it('still shows controls when an external searchQuery hides the search box', () => {
            render(<JsonTreeView value={nested} searchQuery="x" />);
            expect(screen.getByRole('button', {name: 'jsonInput.expandAll'})).toBeInTheDocument();
            expect(lastProps.current!.searchText).toBe('x');
        });

        it('works for arrays and nested containers', () => {
            render(<JsonTreeView value={[[1, [2]], {a: []}]} />);
            fireEvent.click(screen.getByRole('button', {name: 'jsonInput.expandAll'}));
            expect(lastProps.current!.externalTriggers?.collapse).toMatchObject({
                path: [],
                includeChildren: true,
            });
        });

        it.each(['text', 42, true, null])('disables controls for scalar root %s', (value) => {
            render(<JsonTreeView value={value} />);
            expect(screen.getByRole('button', {name: 'jsonInput.expandAll'})).toBeDisabled();
            expect(screen.getByRole('button', {name: 'jsonInput.collapseAll'})).toBeDisabled();
        });

        it('does not remount the editor when toggling', () => {
            render(<JsonTreeView value={nested} />);
            const editor = screen.getByTestId('mock-json-editor');
            fireEvent.click(screen.getByRole('button', {name: 'jsonInput.collapseAll'}));
            expect(screen.getByTestId('mock-json-editor')).toBe(editor);
        });
    });

    describe('sort keys', () => {
        const data = {z: 1, '10': 'ten', '2': 'two', nested: {y: 2, alpha: 3}};
        const layouts = [
            {name: 'compact', props: {}},
            {name: 'full-height', props: {fillHeight: true}},
        ];
        const sortToggle = () => screen.getByRole('button', {name: 'jsonInput.sortKeys'});

        it.each(layouts)('turns key sorting on and off in a read-only tree ($name)', ({props}) => {
            const onChange = vi.fn();
            render(<JsonTreeView value={data} readOnly onChange={onChange} {...props} />);
            expect(sortToggle()).toHaveAttribute('aria-pressed', 'false');
            expect(lastProps.current!.keySort).toBe(false);

            fireEvent.click(sortToggle());
            expect(sortToggle()).toHaveAttribute('aria-pressed', 'true');
            expect(lastProps.current!.keySort).toBe(compareJsonKeys);

            fireEvent.click(sortToggle());
            expect(sortToggle()).toHaveAttribute('aria-pressed', 'false');
            expect(lastProps.current!.keySort).toBe(false);

            expect(lastProps.current!.data).toBe(data);
            expect(onChange).not.toHaveBeenCalled();
        });

        it.each(layouts)('is not offered in an editable tree ($name)', ({props}) => {
            render(<JsonTreeView value={data} onChange={() => {}} {...props} />);
            expect(
                screen.queryByRole('button', {name: 'jsonInput.sortKeys'}),
            ).not.toBeInTheDocument();
            expect(lastProps.current!.keySort).toBe(false);
        });

        it('stops sorting when the tree becomes editable', () => {
            const {rerender} = render(<JsonTreeView value={data} readOnly onChange={() => {}} />);
            fireEvent.click(sortToggle());
            expect(lastProps.current!.keySort).toBe(compareJsonKeys);

            rerender(<JsonTreeView value={data} onChange={() => {}} />);
            expect(lastProps.current!.keySort).toBe(false);
            expect(
                screen.queryByRole('button', {name: 'jsonInput.sortKeys'}),
            ).not.toBeInTheDocument();
        });

        it('can be reached and toggled with the keyboard', async () => {
            const user = userEvent.setup();
            render(<JsonTreeView value={data} searchQuery="" />);

            await user.tab();
            await user.tab();
            await user.tab();
            expect(sortToggle()).toHaveFocus();

            await user.keyboard(' ');
            expect(sortToggle()).toHaveAttribute('aria-pressed', 'true');
            expect(lastProps.current!.keySort).toBe(compareJsonKeys);
        });

        it.each([{}, []])('can be toggled for an empty container %j', (value) => {
            render(<JsonTreeView value={value} />);
            expect(sortToggle()).toBeEnabled();

            fireEvent.click(sortToggle());
            expect(lastProps.current!.keySort).toBe(compareJsonKeys);
            expect(lastProps.current!.data).toBe(value);
        });

        it.each(['text', 42, true, null])('is disabled for scalar root %s', (value) => {
            render(<JsonTreeView value={value} />);
            expect(sortToggle()).toBeDisabled();
        });
    });

    describe('expand to level', () => {
        const data = {customer: {address: {city: 'Rome'}}, list: [[1], {a: {}}]};
        const layouts = [
            {name: 'compact', props: {}},
            {name: 'full-height', props: {fillHeight: true}},
        ];
        const levelGroup = () => screen.getByRole('group', {name: 'jsonInput.expandToLevel'});
        const levelButton = (level: number) => {
            const button = within(levelGroup()).getAllByRole('button', {
                name: 'jsonInput.expandToLevelN',
            })[level - 1];
            expect(button).toHaveTextContent(String(level));
            return button;
        };

        it.each(layouts)('offers levels 1, 2 and 3 in a read-only tree ($name)', ({props}) => {
            render(<JsonTreeView value={data} readOnly onChange={() => {}} {...props} />);
            const buttons = within(levelGroup()).getAllByRole('button');
            expect(buttons.map((b) => b.textContent)).toEqual(['1', '2', '3']);
            buttons.forEach((b) => expect(b).toBeEnabled());
        });

        it.each(layouts)(
            'sends the chosen depth to the library collapse API ($name)',
            ({props}) => {
                const onChange = vi.fn();
                render(<JsonTreeView value={data} readOnly onChange={onChange} {...props} />);
                expect(lastProps.current!.externalTriggers).toBeUndefined();

                for (const level of [1, 2, 3]) {
                    fireEvent.click(levelButton(level));
                    expect(lastProps.current!.externalTriggers).toEqual(
                        buildExpandToLevelTrigger(data, level),
                    );
                }

                expect(lastProps.current!.data).toBe(data);
                expect(onChange).not.toHaveBeenCalled();
            },
        );

        it.each(layouts)('is not offered in an editable tree ($name)', ({props}) => {
            render(<JsonTreeView value={data} onChange={() => {}} {...props} />);
            expect(
                screen.queryByRole('group', {name: 'jsonInput.expandToLevel'}),
            ).not.toBeInTheDocument();
            expect(lastProps.current!.restrictEdit).not.toBe(true);
        });

        it('issues a new trigger object when the same level is chosen again', () => {
            render(<JsonTreeView value={data} />);
            fireEvent.click(levelButton(2));
            const first = lastProps.current!.externalTriggers;
            fireEvent.click(levelButton(2));
            expect(lastProps.current!.externalTriggers).not.toBe(first);
            expect(lastProps.current!.externalTriggers).toEqual(first);
        });

        it('keeps search text and key sorting', () => {
            render(<JsonTreeView value={data} />);
            fireEvent.change(screen.getByPlaceholderText('jsonInput.search'), {
                target: {value: 'Rome'},
            });
            fireEvent.click(screen.getByRole('button', {name: 'jsonInput.sortKeys'}));
            fireEvent.click(levelButton(3));
            expect(lastProps.current!.searchText).toBe('Rome');
            expect(lastProps.current!.keySort).toBe(compareJsonKeys);
            expect(screen.getByRole('button', {name: 'jsonInput.sortKeys'})).toHaveAttribute(
                'aria-pressed',
                'true',
            );
        });

        it('leaves expand all and collapse all usable', () => {
            render(<JsonTreeView value={data} />);
            fireEvent.click(levelButton(1));
            fireEvent.click(screen.getByRole('button', {name: 'jsonInput.expandAll'}));
            expect(lastProps.current!.externalTriggers).toEqual({
                collapse: {path: [], collapsed: false, includeChildren: true},
            });
            fireEvent.click(levelButton(2));
            expect(lastProps.current!.externalTriggers).toEqual(buildExpandToLevelTrigger(data, 2));
            fireEvent.click(screen.getByRole('button', {name: 'jsonInput.collapseAll'}));
            expect(lastProps.current!.externalTriggers).toEqual({
                collapse: {path: [], collapsed: true, includeChildren: true},
            });
        });

        it('does not remount the editor', () => {
            render(<JsonTreeView value={data} />);
            const editor = screen.getByTestId('mock-json-editor');
            fireEvent.click(levelButton(1));
            fireEvent.click(levelButton(3));
            expect(screen.getByTestId('mock-json-editor')).toBe(editor);
        });

        it.each([{}, []])('is safe for an empty container %j', (value) => {
            render(<JsonTreeView value={value} />);
            fireEvent.click(levelButton(3));
            expect(lastProps.current!.externalTriggers).toEqual({
                collapse: [
                    {path: [], collapsed: false, includeChildren: false},
                    {path: [], collapsed: true, includeChildren: true},
                ],
            });
            expect(lastProps.current!.data).toBe(value);
        });

        it.each(['text', 42, true, null])('is disabled for scalar root %s', (value) => {
            render(<JsonTreeView value={value} />);
            within(levelGroup())
                .getAllByRole('button')
                .forEach((b) => expect(b).toBeDisabled());
        });

        it('can be reached and used with the keyboard', async () => {
            const user = userEvent.setup();
            render(<JsonTreeView value={data} searchQuery="" />);
            for (let i = 0; i < 5; i++) await user.tab();
            expect(levelButton(2)).toHaveFocus();
            await user.keyboard('{Enter}');
            expect(lastProps.current!.externalTriggers).toEqual(buildExpandToLevelTrigger(data, 2));
        });
    });
});
