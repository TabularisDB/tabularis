export interface Note {
    id: string;
    project_id: string;
    title: string;
    body: string;
    summary: string | null;
    updated_at: string;
    created_at: string;
}
export interface Project {
    id: string;
    name: string;
    color: string;
}
export interface Attachment {
    id: string;
    note_id: string;
    name: string;
    size: number;
    content_type: string;
}
