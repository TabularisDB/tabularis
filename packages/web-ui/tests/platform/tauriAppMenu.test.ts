import {beforeEach, describe, expect, it, vi} from 'vitest';

import {installTauriAppMenu} from '@/platform/tauriCapabilities';

interface FakeItem {
    id?: string;
    text?: string;
    item?: string;
    action?: (id: string) => void;
    close: () => Promise<void>;
}

interface SubmenuRecord {
    title: string;
    inserted: {items: FakeItem[]; position: number | null}[];
}

const menuState = vi.hoisted(() => ({
    menus: [] as {submenus: SubmenuRecord[]}[],
    setAsAppMenu: vi.fn(),
    previousMenuClose: vi.fn(async () => undefined),
    opened: 0,
    closed: 0,
}));

vi.mock('@tauri-apps/api/menu', () => {
    const track = () => {
        menuState.opened += 1;
        return async () => {
            menuState.closed += 1;
        };
    };
    class Submenu {
        readonly close = track();
        constructor(readonly record: SubmenuRecord) {}
        async text() {
            return this.record.title;
        }
        async insert(items: FakeItem[], position: number) {
            this.record.inserted.push({items, position});
        }
        async append(items: FakeItem[]) {
            this.record.inserted.push({items, position: null});
        }
    }
    return {
        Submenu,
        Menu: {
            default: async () => {
                const submenus = ['Tabularis', 'File', 'Edit', 'View', 'Window', 'Help'].map(
                    (title) => ({title, inserted: []}),
                );
                menuState.menus.push({submenus});
                return {
                    close: track(),
                    items: async () => submenus.map((record) => new Submenu(record)),
                    setAsAppMenu: menuState.setAsAppMenu,
                };
            },
        },
        MenuItem: {new: async (opts: Omit<FakeItem, 'close'>) => ({...opts, close: track()})},
        PredefinedMenuItem: {
            new: async (opts: Omit<FakeItem, 'close'>) => ({...opts, close: track()}),
        },
    };
});

describe('installTauriAppMenu', () => {
    beforeEach(() => {
        menuState.menus = [];
        menuState.opened = 0;
        menuState.closed = 0;
        menuState.previousMenuClose.mockClear();
        menuState.setAsAppMenu.mockReset();
        menuState.setAsAppMenu.mockResolvedValue({close: menuState.previousMenuClose});
    });

    it('adds entries to the default menu and installs it', async () => {
        const run = vi.fn();
        await installTauriAppMenu([
            {submenu: null, position: 1, entries: [{id: 'a', label: 'A', run}, 'separator']},
            {submenu: 'Help', position: null, entries: [{id: 'b', label: 'B', run}]},
        ]);

        const [app, , edit, , , help] = menuState.menus[0].submenus;
        expect(app.inserted).toMatchObject([
            {items: [{id: 'a', text: 'A', action: run}, {item: 'Separator'}], position: 1},
        ]);
        expect(help.inserted).toMatchObject([
            {items: [{id: 'b', text: 'B', action: run}], position: null},
        ]);
        expect(edit.inserted).toEqual([]);
        expect(menuState.setAsAppMenu).toHaveBeenCalledOnce();
    });

    it('skips a section whose submenu does not exist', async () => {
        await installTauriAppMenu([
            {submenu: 'Tools', position: 0, entries: [{id: 'c', label: 'C', run: vi.fn()}]},
        ]);

        expect(menuState.menus[0].submenus.every((s) => s.inserted.length === 0)).toBe(true);
        expect(menuState.setAsAppMenu).toHaveBeenCalledOnce();
    });

    it('closes every handle it created and the menu it replaced', async () => {
        await installTauriAppMenu([
            {submenu: null, position: 1, entries: [{id: 'a', label: 'A', run: vi.fn()}]},
        ]);

        expect(menuState.opened).toBeGreaterThan(0);
        expect(menuState.closed).toBe(menuState.opened);
        expect(menuState.previousMenuClose).toHaveBeenCalledOnce();
    });

    it('lets the latest of two overlapping calls install its menu', async () => {
        const first = installTauriAppMenu([
            {submenu: null, position: 1, entries: [{id: 'old', label: 'Old', run: vi.fn()}]},
        ]);
        const second = installTauriAppMenu([
            {submenu: null, position: 1, entries: [{id: 'new', label: 'New', run: vi.fn()}]},
        ]);
        await Promise.all([first, second]);

        expect(menuState.setAsAppMenu).toHaveBeenCalledOnce();
        expect(menuState.closed).toBe(menuState.opened);
        const installed = menuState.setAsAppMenu.mock.contexts[0] as {
            items: () => Promise<{record: SubmenuRecord}[]>;
        };
        const [app] = await installed.items();
        expect(app.record.inserted[0].items[0]).toMatchObject({id: 'new'});
    });

    it('still closes its handles when installing fails', async () => {
        menuState.setAsAppMenu.mockRejectedValue(new Error('denied'));

        await expect(
            installTauriAppMenu([
                {submenu: null, position: 1, entries: [{id: 'a', label: 'A', run: vi.fn()}]},
            ]),
        ).rejects.toThrow('denied');
        expect(menuState.closed).toBe(menuState.opened);
    });
});
