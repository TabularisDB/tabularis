import {
    Activity,
    Brain,
    Database,
    FileText,
    Folder,
    GitBranch,
    LayoutDashboard,
    Settings,
    Shield,
    Users,
    Zap,
} from 'lucide-react';

const itemIcons = {
    overview: LayoutDashboard,
    branches: GitBranch,
    database: Database,
    users: Users,
    storage: Folder,
    functions: Zap,
    ai: Brain,
    realtime: Activity,
    settings: Settings,
    documents: FileText,
    security: Shield,
};

export function getPluginExplorerIcon(icon?: string) {
    return icon && Object.hasOwn(itemIcons, icon)
        ? itemIcons[icon as keyof typeof itemIcons]
        : FileText;
}
