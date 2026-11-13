import {Sparkles} from 'lucide-react';
import {RegistryDriverIcon} from '@/components/RegistryDriverIcon';

interface AiProviderIconProps {
    src?: string | null;
    size?: number;
}

/** Provider artwork is owned by the package and retains its original colors. */
export function AiProviderIcon({src, size = 24}: AiProviderIconProps) {
    const fallback = <Sparkles size={size} />;
    return (
        <span
            aria-hidden="true"
            className="inline-flex shrink-0 items-center justify-center text-primary"
            style={{width: size, height: size}}
        >
            {!src ? (
                fallback
            ) : (
                <RegistryDriverIcon key={src} src={src} size={size} fallback={fallback} />
            )}
        </span>
    );
}
