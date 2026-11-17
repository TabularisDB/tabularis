import {lazy} from 'react';
import {EditorErrorBoundary} from '@/components/ui/EditorErrorBoundary';

const ConnectionEditorRoute = lazy(() =>
    import('@/pages/ConnectionEditorRoute').then((module) => ({
        default: module.ConnectionEditorRoute,
    })),
);

/** The boundary must mount before the route module, not inside that module. */
export function LazyConnectionEditorRoute() {
    return (
        <EditorErrorBoundary>
            <ConnectionEditorRoute />
        </EditorErrorBoundary>
    );
}
