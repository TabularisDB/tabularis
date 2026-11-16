import Markdown, {type Components} from 'react-markdown';

/*
 * Notes come from local files that may be shared through Git, so their
 * Markdown is treated as untrusted: raw HTML is dropped, links are shown as
 * text instead of navigating the app window, and images are reduced to their
 * alt text so a note cannot load remote content.
 */
const SAFE_COMPONENTS: Components = {
    a: ({children, href}) => (
        <span className="text-accent underline" title={href ?? undefined}>
            {children}
        </span>
    ),
    img: ({alt}) => (alt ? <span className="text-muted">[{alt}]</span> : null),
};

const PROSE =
    'text-sm text-secondary break-words ' +
    '[&_h1]:text-base [&_h1]:font-semibold [&_h1]:text-primary [&_h1]:mb-1 ' +
    '[&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-primary [&_h2]:mb-1 ' +
    '[&_h3]:text-sm [&_h3]:font-medium [&_h3]:text-primary [&_h3]:mb-1 ' +
    '[&_p]:mb-1 [&_p]:leading-relaxed ' +
    '[&_code]:bg-surface-secondary [&_code]:px-1 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono ' +
    '[&_pre]:bg-surface-secondary [&_pre]:p-2 [&_pre]:rounded [&_pre]:overflow-x-auto [&_pre]:mb-1 ' +
    '[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 ' +
    '[&_blockquote]:border-l-2 [&_blockquote]:border-default [&_blockquote]:pl-2 [&_blockquote]:text-muted ' +
    '[&_strong]:font-semibold [&_strong]:text-primary [&_em]:italic';

export function SchemaNoteMarkdown({content}: {content: string}) {
    return (
        <div className={PROSE}>
            <Markdown skipHtml components={SAFE_COMPONENTS}>
                {content}
            </Markdown>
        </div>
    );
}
