export interface AuthUser {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    createdAt: string;
    role: string | null;
}

export interface AuthUsersPage {
    users: AuthUser[];
    total: number;
}

export interface AuthUserDetails {
    user: AuthUser;
    sessions: {id: string; createdAt: string; expiresAt: string}[];
    capabilities: {
        profileUpdate: boolean;
        sessionRevoke: boolean;
        passwordReset: boolean;
    };
}
