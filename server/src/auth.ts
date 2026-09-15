import jwt from 'jsonwebtoken';

export type UserRole = 'editor' | 'viewer' | 'commenter' | 'navigator';

export const VALID_ROLES: readonly UserRole[] = ['editor', 'viewer', 'commenter', 'navigator'] as const;

export interface TokenPayload {
  userId: string;
  role: UserRole;
  name?: string;
  color?: string;
}

export const JWT_SECRET = process.env.JWT_SECRET || 'glasscode-secure-secret-key-live-share';

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as TokenPayload;
    if (!decoded.role || !VALID_ROLES.includes(decoded.role)) {
      return null;
    }
    return decoded;
  } catch (err) {
    return null;
  }
}
