import type {ComponentType} from 'react';

/**
 * State of one plugin-owned secret in the connection modal
 * (`connection-modal.extra_fields` slot).
 */
export interface PluginSecretFieldState {
    /** Value typed during this modal session. Stored values are never exposed. */
    value: string;
    /** Whether the connection had a value in the OS keychain when editing began. */
    hasStoredValue: boolean;
    /** Whether this modal will set (non-empty value) or clear (empty value) it on save. */
    dirty: boolean;
}

/**
 * Typed context shape per slot.
 *
 * Each key is a slot name; the value type lists the context fields that slot
 * guarantees. Compared to a single loose `SlotContext`, this lets authors get
 * non-optional access to the exact fields available where their component is
 * mounted (no more `context.columnName!` sprinkled everywhere).
 *
 * Keep this map aligned with the host-side slot providers in
 * `src/contexts/PluginSlotProvider.tsx` and related renderers.
 */
export type SlotContextMap = {
    'row-edit-modal.field.after': {
        connectionId: string;
        tableName: string;
        schema: string | null;
        driver: string;
        columnName: string;
        rowData: Record<string, unknown>;
        isInsertion: boolean;
    };
    'row-edit-modal.footer.before': {
        connectionId: string;
        tableName: string;
        schema: string | null;
        driver: string;
        rowData: Record<string, unknown>;
        isInsertion: boolean;
    };
    'row-editor-sidebar.field.after': {
        connectionId: string;
        tableName: string;
        schema: string | null;
        driver: string;
        columnName: string;
        rowData: Record<string, unknown>;
        rowIndex: number;
    };
    'row-editor-sidebar.header.actions': {
        connectionId: string;
        tableName: string;
        schema: string | null;
        driver: string;
        rowData: Record<string, unknown>;
        rowIndex: number;
    };
    'data-grid.toolbar.actions': {
        connectionId: string;
        tableName: string;
        schema: string | null;
        driver: string;
    };
    'data-grid.context-menu.items': {
        connectionId: string;
        tableName: string;
        schema: string | null;
        driver: string;
        columnName: string;
        rowIndex: number;
        rowData: Record<string, unknown>;
    };
    'sidebar.footer.actions': {
        connectionId: string;
        driver: string;
    };
    'settings.plugin.actions': {
        targetPluginId: string;
    };
    'settings.plugin.before_settings': {
        targetPluginId: string;
    };
    'connection-modal.connection_content': {
        driver: string;
        database: string;
        connectionName: string;
        onDatabaseChange: (value: string) => void;
    };
    'connection-modal.extra_fields': {
        driver: string;
        /** Current values of the plugin-owned extra connection fields. */
        extra: Record<string, string>;
        /** Update one extra field. Pass an empty string to clear it. */
        setExtraField: (key: string, value: string) => void;
        /** Whether the host username/password inputs are currently hidden. */
        credentialFieldsHidden: boolean;
        /**
         * Hide (or show again) the host username/password inputs. Hiding also
         * clears both values. Use it for drivers that authenticate without a
         * database login (e.g. Windows integrated authentication). While hidden,
         * the host ignores the login part of an imported connection string and
         * saves an explicit empty password, dropping any secret stored for the
         * connection. The host resets the flag whenever the driver changes.
         */
        setCredentialFieldsHidden: (hidden: boolean) => void;
        /**
         * Plugin-owned secrets of this connection, keyed by field name. A value
         * already stored in the OS keychain is never exposed: it is reported only
         * through `hasStoredValue`. Optional so bundles can detect older hosts.
         */
        secretFields?: Record<string, PluginSecretFieldState>;
        /**
         * Set a plugin-owned secret for Test Connection and Save. The value is
         * stored in the OS keychain, never in the connections file, and reaches
         * the driver as `params.extra[key]` at runtime. An empty value explicitly
         * clears the stored secret on save.
         */
        setSecretField?: (key: string, value: string) => void;
    };
};

/**
 * Union of all valid slot names. Source of truth for host-side validation
 * is `src/types/pluginSlots.ts`; this type must stay in sync.
 */
export type SlotName = keyof SlotContextMap;

/**
 * Props passed to a slot component that used `defineSlot`.
 */
export interface TypedSlotProps<S extends SlotName> {
    context: SlotContextMap[S];
    pluginId: string;
}

/**
 * Loose, legacy context shape kept for compatibility with plugins that were
 * written before the typed-slot contract existed. Prefer `defineSlot`.
 */
export interface SlotContext {
    connectionId?: string | null;
    tableName?: string | null;
    schema?: string | null;
    driver?: string | null;
    rowData?: Record<string, unknown>;
    columnName?: string;
    rowIndex?: number;
    isInsertion?: boolean;
    targetPluginId?: string;
    [key: string]: unknown;
}

export interface SlotComponentProps {
    context: SlotContext;
    pluginId: string;
}

/**
 * Manifest-level UI extension declaration (what authors put in the `.tabularium` manifest).
 */
export interface UIExtensionDeclaration {
    slot: SlotName;
    module: string;
    order?: number;
    driver?: string;
}

/**
 * Tagged slot definition.
 *
 * ```tsx
 * const MySlot = defineSlot("row-editor-sidebar.field.after", ({ context }) => {
 *   // context.columnName is string (not string | undefined)
 *   return <div>{context.columnName}</div>;
 * });
 * export default MySlot.component;
 * ```
 *
 * Export `.component` as the default export of your entry so the host loader
 * picks it up. The `__slot` tag is reserved for future host-side validation.
 */
export function defineSlot<S extends SlotName>(
    slot: S,
    component: ComponentType<TypedSlotProps<S>>,
): {readonly __slot: S; readonly component: ComponentType<TypedSlotProps<S>>} {
    return {__slot: slot, component} as const;
}
