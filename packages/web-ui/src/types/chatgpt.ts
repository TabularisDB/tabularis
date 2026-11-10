export interface ChatGptProfile {
    id: string;
    label: string;
    email: string | null;
    connected: boolean;
    sharing: boolean;
}

export interface ChatGptSession {
    activeProfileId: string | null;
    profiles: ChatGptProfile[];
}

export interface ChatGptModel {
    slug: string;
    displayName: string;
}
