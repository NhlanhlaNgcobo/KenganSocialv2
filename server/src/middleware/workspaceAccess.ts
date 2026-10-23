import type { Request, Response, NextFunction } from 'express';

export type WorkspaceRole = 'owner' | 'admin' | 'editor' | 'viewer';
export function workspaceRole(value: unknown): WorkspaceRole | null {
    return ['owner', 'admin', 'editor', 'viewer'].includes(String(value)) ? value as WorkspaceRole : null;
}

export function requireWorkspaceRole(...roles: WorkspaceRole[]) {
    return (req: Request, res: Response, next: NextFunction) => {
        if (!(req as any).workspaceId) return res.status(403).json({ error: 'WORKSPACE_REQUIRED' });
        if (!roles.includes((req as any).workspaceRole)) return res.status(403).json({ error: 'INSUFFICIENT_ROLE' });
        next();
    };
}

/** Default permission floor for tenant routes, including future write endpoints. */
export function enforceWorkspaceAccess(req: Request, res: Response, next: NextFunction) {
    const role = workspaceRole((req as any).workspaceRole);
    if (!(req as any).workspaceId) return res.status(403).json({ error: 'WORKSPACE_REQUIRED' });
    if (!role || (role === 'viewer' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method))) {
        return res.status(403).json({ error: 'INSUFFICIENT_ROLE' });
    }
    next();
}
