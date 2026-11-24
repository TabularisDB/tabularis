import {useState} from 'react';
import {fireEvent, render, screen, within} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {ParamsPanel} from '@/components/notebook/ParamsPanel';
import type {NotebookParam} from '@/types/notebook';
import type {ParamDrafts} from '@/utils/notebookParams';

vi.mock('lucide-react', async (importOriginal) => await importOriginal());

const K = 'editor.notebook.params';
const limit: NotebookParam = {name: 'limit', value: '10', type: 'number'};
const region: NotebookParam = {
    name: 'region',
    value: 'EU',
    type: 'select',
    options: ['EU', 'US'],
};
const table: NotebookParam = {name: 'tbl', value: 'orders'};

/** The panel over its own applied parameters, as the notebook holds them. */
function Panel({
    initial,
    onParamsChange,
    typedSupported = true,
}: {
    initial: NotebookParam[];
    onParamsChange: (params: NotebookParam[]) => void;
    typedSupported?: boolean;
}) {
    const [params, setParams] = useState(initial);
    return (
        <ParamsPanel
            params={params}
            typedSupported={typedSupported}
            onParamsChange={(next) => {
                onParamsChange(next);
                setParams(next);
            }}
        />
    );
}

function renderPanel(initial: NotebookParam[], typedSupported = true) {
    const onParamsChange = vi.fn();
    render(
        <Panel initial={initial} onParamsChange={onParamsChange} typedSupported={typedSupported} />,
    );
    return onParamsChange;
}

const row = (name: string) => within(screen.getByRole('group', {name: `@${name}`}));
const valueOf = (name: string) => row(name).getByRole('textbox', {name: `${K}.value`});
const typeOf = (name: string) => row(name).getByRole('combobox', {name: `${K}.type`});
const applyButton = () => screen.getByRole('button', {name: `${K}.apply`});
const pendingStatus = () => screen.queryByText(`${K}.unapplied`);

describe('ParamsPanel', () => {
    describe('raw parameters', () => {
        it('commits a raw value as it is typed, without Apply', () => {
            const onParamsChange = renderPanel([table, limit]);

            fireEvent.change(valueOf('tbl'), {target: {value: 'customers'}});

            expect(onParamsChange).toHaveBeenCalledExactlyOnceWith([
                {name: 'tbl', value: 'customers'},
                limit,
            ]);
            expect(pendingStatus()).not.toBeInTheDocument();
            expect(screen.queryByRole('button', {name: `${K}.apply`})).not.toBeInTheDocument();
        });

        it('offers Raw and every type, and explains raw mode', () => {
            renderPanel([table]);

            expect(typeOf('tbl')).toHaveValue('raw');
            expect(
                within(typeOf('tbl'))
                    .getAllByRole('option')
                    .map((option) => option.textContent),
            ).toEqual([
                `${K}.types.raw`,
                `${K}.types.text`,
                `${K}.types.number`,
                `${K}.types.boolean`,
                `${K}.types.date`,
                `${K}.types.select`,
            ]);
            expect(screen.getByText(`${K}.rawHint`)).toBeInTheDocument();
        });

        it('makes a row a draft once a type is picked, and live again when set back to raw', () => {
            const onParamsChange = renderPanel([{name: 'start', value: "'2026-01-01'"}]);

            fireEvent.change(typeOf('start'), {target: {value: 'text'}});
            expect(valueOf('start')).toHaveValue('2026-01-01');
            fireEvent.change(valueOf('start'), {target: {value: '2026-02-01'}});
            expect(onParamsChange).not.toHaveBeenCalled();
            expect(pendingStatus()).toBeInTheDocument();

            fireEvent.change(typeOf('start'), {target: {value: 'raw'}});
            expect(onParamsChange).toHaveBeenCalledExactlyOnceWith([
                {name: 'start', value: '2026-02-01'},
            ]);
            expect(pendingStatus()).not.toBeInTheDocument();
        });
    });

    describe('draft and applied values', () => {
        it('keeps an edit to a typed row as a draft until Apply', () => {
            const onParamsChange = renderPanel([limit, table]);

            fireEvent.change(valueOf('limit'), {target: {value: '50'}});

            expect(onParamsChange).not.toHaveBeenCalled();
            expect(valueOf('limit')).toHaveValue('50');
            expect(pendingStatus()).toHaveAttribute('role', 'status');
            expect(applyButton()).toBeEnabled();
        });

        it('applies every drafted row in one change', () => {
            const onParamsChange = renderPanel([limit, region, table]);

            fireEvent.change(valueOf('limit'), {target: {value: ' 50 '}});
            fireEvent.change(row('region').getByRole('combobox', {name: `${K}.value`}), {
                target: {value: 'US'},
            });
            fireEvent.change(typeOf('tbl'), {target: {value: 'text'}});
            expect(onParamsChange).not.toHaveBeenCalled();

            fireEvent.click(applyButton());

            expect(onParamsChange).toHaveBeenCalledExactlyOnceWith([
                {name: 'limit', value: '50', type: 'number'},
                {...region, value: 'US'},
                {name: 'tbl', value: 'orders', type: 'text'},
            ]);
            expect(pendingStatus()).not.toBeInTheDocument();
            expect(valueOf('limit')).toHaveValue('50');
        });

        it('changes nothing while a draft is invalid, and says why', () => {
            const onParamsChange = renderPanel([limit, region]);

            fireEvent.change(row('region').getByRole('combobox', {name: `${K}.value`}), {
                target: {value: 'US'},
            });
            fireEvent.change(valueOf('limit'), {target: {value: '1e3'}});

            expect(applyButton()).toBeDisabled();
            fireEvent.click(applyButton());
            expect(onParamsChange).not.toHaveBeenCalled();

            const alert = row('limit').getByRole('alert');
            expect(alert).toHaveTextContent(`${K}.issues.invalidNumber`);
            expect(valueOf('limit')).toHaveAttribute('aria-invalid', 'true');
            expect(valueOf('limit')).toHaveAttribute('aria-describedby', alert.id);

            fireEvent.change(valueOf('limit'), {target: {value: '1000'}});
            expect(row('limit').queryByRole('alert')).not.toBeInTheDocument();
            expect(valueOf('limit')).not.toHaveAttribute('aria-invalid');
            expect(applyButton()).toBeEnabled();
        });

        it('discards every draft and shows the applied values again', () => {
            const onParamsChange = renderPanel([limit, region]);

            fireEvent.change(valueOf('limit'), {target: {value: '50'}});
            fireEvent.change(typeOf('region'), {target: {value: 'text'}});
            fireEvent.click(screen.getByRole('button', {name: `${K}.discard`}));

            expect(onParamsChange).not.toHaveBeenCalled();
            expect(valueOf('limit')).toHaveValue('10');
            expect(typeOf('region')).toHaveValue('select');
            expect(pendingStatus()).not.toBeInTheDocument();
        });

        it('keeps a type change as a draft, with the applied type still in effect', () => {
            const onParamsChange = renderPanel([{name: 'since', value: 'yesterday'}]);

            fireEvent.change(typeOf('since'), {target: {value: 'number'}});

            expect(onParamsChange).not.toHaveBeenCalled();
            expect(row('since').getByRole('alert')).toHaveTextContent(`${K}.issues.invalidNumber`);
            expect(applyButton()).toBeDisabled();
        });

        it('shows the status and Apply while the panel is collapsed', () => {
            renderPanel([limit]);
            fireEvent.change(valueOf('limit'), {target: {value: '50'}});

            const toggle = screen.getByRole('button', {name: /editor\.notebook\.parameters/});
            expect(toggle).toHaveAttribute('aria-expanded', 'true');
            fireEvent.click(toggle);

            expect(toggle).toHaveAttribute('aria-expanded', 'false');
            expect(screen.queryByRole('group', {name: '@limit'})).not.toBeInTheDocument();
            expect(pendingStatus()).toBeInTheDocument();
            expect(applyButton()).toBeEnabled();
        });
    });

    describe('add and remove', () => {
        it('adds a parameter at once and leaves other drafts pending', () => {
            const onParamsChange = renderPanel([limit]);
            fireEvent.change(valueOf('limit'), {target: {value: '50'}});

            fireEvent.change(screen.getByPlaceholderText('editor.notebook.paramName'), {
                target: {value: 'p2'},
            });
            fireEvent.keyDown(screen.getByPlaceholderText('editor.notebook.paramName'), {
                key: 'Enter',
            });

            expect(onParamsChange).toHaveBeenCalledExactlyOnceWith([
                limit,
                {name: 'p2', value: ''},
            ]);
            expect(valueOf('limit')).toHaveValue('50');
            expect(pendingStatus()).toBeInTheDocument();
        });

        it('removes a parameter at once together with its draft', () => {
            const onParamsChange = renderPanel([limit, table]);
            fireEvent.change(valueOf('limit'), {target: {value: '50'}});

            fireEvent.click(row('limit').getByRole('button', {name: `${K}.remove`}));

            expect(onParamsChange).toHaveBeenCalledExactlyOnceWith([table]);
            expect(pendingStatus()).not.toBeInTheDocument();
        });
    });

    describe('typed controls', () => {
        it('sends NULL instead of the value, and not for a required parameter', () => {
            const onParamsChange = renderPanel([{name: 'note', value: 'x', type: 'text'}]);
            const nullBox = () => row('note').queryByRole('checkbox', {name: `${K}.null`});
            const required = row('note').getByRole('checkbox', {name: `${K}.required`});

            fireEvent.click(nullBox()!);
            expect(valueOf('note')).toBeDisabled();
            expect(valueOf('note')).toHaveValue('NULL');

            fireEvent.click(required);
            expect(nullBox()).not.toBeInTheDocument();
            expect(valueOf('note')).toBeEnabled();
            fireEvent.change(valueOf('note'), {target: {value: ''}});
            expect(row('note').getByRole('alert')).toHaveTextContent(`${K}.issues.required`);

            fireEvent.click(required);
            fireEvent.click(nullBox()!);
            fireEvent.click(applyButton());
            expect(onParamsChange).toHaveBeenCalledExactlyOnceWith([
                {name: 'note', value: '', type: 'text', isNull: true},
            ]);
        });

        it('asks for a value or NULL when an optional number is empty', () => {
            renderPanel([limit]);

            fireEvent.change(valueOf('limit'), {target: {value: ''}});

            expect(row('limit').getByRole('alert')).toHaveTextContent(`${K}.issues.emptyNeedsNull`);
            expect(applyButton()).toBeDisabled();
            expect(valueOf('limit')).toHaveAttribute('inputmode', 'decimal');
        });

        it('edits a boolean with a checkbox', () => {
            const onParamsChange = renderPanel([{name: 'active', value: 'false', type: 'boolean'}]);

            fireEvent.click(row('active').getByRole('checkbox', {name: `${K}.value`}));
            fireEvent.click(applyButton());

            expect(onParamsChange).toHaveBeenCalledExactlyOnceWith([
                {name: 'active', value: 'true', type: 'boolean'},
            ]);
        });

        it('edits a date with the date control and writes it as YYYY-MM-DD', () => {
            const onParamsChange = renderPanel([
                {name: 'start', value: '2026-01-01', type: 'date'},
            ]);
            const date = within(row('start').getByRole('group', {name: `${K}.value`}));
            const [day] = date.getAllByRole('combobox');

            fireEvent.change(day, {target: {value: '15'}});
            fireEvent.click(applyButton());

            expect(onParamsChange).toHaveBeenCalledExactlyOnceWith([
                {name: 'start', value: '2026-01-15', type: 'date'},
            ]);
        });

        it('flags a date it cannot read and lets the user accept the one on screen', () => {
            renderPanel([{name: 'start', value: '2025-02-29', type: 'date'}]);

            const alert = row('start').getByRole('alert');
            expect(alert).toHaveTextContent(`${K}.issues.invalidDate`);
            expect(row('start').getByRole('group', {name: `${K}.value`})).toHaveAttribute(
                'aria-describedby',
                alert.id,
            );

            fireEvent.click(row('start').getByRole('button', {name: 'dateInput.useShownValue'}));

            expect(row('start').queryByRole('alert')).not.toBeInTheDocument();
            expect(applyButton()).toBeEnabled();
        });

        it('edits list options one per line and keeps the value among them', () => {
            const onParamsChange = renderPanel([region]);
            const options = row('region').getByRole('textbox', {name: `${K}.options`});
            const value = () => row('region').getByRole('combobox', {name: `${K}.value`});
            expect(options).toHaveValue('EU\nUS');

            // A line break while typing is kept, and is not a change yet.
            fireEvent.change(options, {target: {value: 'EU\nUS\n'}});
            expect(options).toHaveValue('EU\nUS\n');
            expect(pendingStatus()).not.toBeInTheDocument();

            fireEvent.change(options, {target: {value: 'US\n APAC \nUS'}});
            expect(row('region').getByRole('alert')).toHaveTextContent(`${K}.issues.invalidOption`);
            expect(value()).toHaveAttribute('aria-invalid', 'true');
            expect(applyButton()).toBeDisabled();

            fireEvent.change(value(), {target: {value: 'APAC'}});
            fireEvent.click(applyButton());
            expect(onParamsChange).toHaveBeenCalledExactlyOnceWith([
                {name: 'region', value: 'APAC', type: 'select', options: ['US', 'APAC']},
            ]);
        });

        it('requires a list to have at least one option', () => {
            renderPanel([{name: 'p', value: ''}]);

            fireEvent.change(typeOf('p'), {target: {value: 'select'}});

            expect(row('p').getByRole('alert')).toHaveTextContent(`${K}.issues.noOptions`);
        });
    });

    describe('a connection without typed parameters', () => {
        it('keeps raw rows raw and says why', () => {
            const onParamsChange = renderPanel([table], false);

            expect(typeOf('tbl')).toBeDisabled();
            expect(screen.getByText(`${K}.unsupportedDriver`)).toBeInTheDocument();
            expect(screen.queryByText(`${K}.rawHint`)).not.toBeInTheDocument();

            fireEvent.change(valueOf('tbl'), {target: {value: 'customers'}});
            expect(onParamsChange).toHaveBeenCalledExactlyOnceWith([
                {name: 'tbl', value: 'customers'},
            ]);
        });

        it('flags a typed row and only lets it go back to raw', () => {
            const onParamsChange = renderPanel([limit], false);

            expect(row('limit').getByRole('alert')).toHaveTextContent(`${K}.unsupportedDriver`);
            expect(typeOf('limit')).toBeEnabled();
            const enabled = within(typeOf('limit'))
                .getAllByRole<HTMLOptionElement>('option')
                .filter((option) => !option.disabled)
                .map((option) => option.value);
            expect(enabled).toEqual(['raw', 'number']);

            fireEvent.change(typeOf('limit'), {target: {value: 'raw'}});
            fireEvent.click(applyButton());
            expect(onParamsChange).toHaveBeenCalledExactlyOnceWith([{name: 'limit', value: '10'}]);
        });
    });

    describe('drafts owned by the notebook', () => {
        it('reports drafts to the owner and shows the ones it is given', () => {
            const onParamsChange = vi.fn();
            const onDraftsChange = vi.fn();
            const view = (drafts: ParamDrafts) => (
                <ParamsPanel
                    params={[limit]}
                    onParamsChange={onParamsChange}
                    drafts={drafts}
                    onDraftsChange={onDraftsChange}
                    typedSupported
                />
            );
            const {rerender, unmount} = render(view({}));

            fireEvent.change(valueOf('limit'), {target: {value: '50'}});
            expect(onDraftsChange).toHaveBeenLastCalledWith({limit: {...limit, value: '50'}});
            expect(valueOf('limit')).toHaveValue('10');

            rerender(view({limit: {...limit, value: '50'}}));
            expect(valueOf('limit')).toHaveValue('50');

            // Another panel given the same drafts, as after a switch of view.
            unmount();
            render(view({limit: {...limit, value: '50'}}));
            expect(valueOf('limit')).toHaveValue('50');
            expect(pendingStatus()).toBeInTheDocument();

            fireEvent.click(applyButton());
            expect(onParamsChange).toHaveBeenCalledExactlyOnceWith([{...limit, value: '50'}]);
            expect(onDraftsChange).toHaveBeenLastCalledWith({});
        });
    });
});
