import type { NextFunction, Request, Response } from 'express';
import type { IdentityProvider } from './types.js';

declare global {
  namespace Express {
    interface Request {
      user?: Awaited<ReturnType<IdentityProvider['verify']>>;
    }
  }
}

export function requireBearerToken(identityProvider: IdentityProvider) {
  return async (request: Request, response: Response, next: NextFunction) => {
    const authorization = request.header('authorization');
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
    if (!token) {
      response.status(401).json({ error: 'AUTHENTICATION_REQUIRED' });
      return;
    }

    try {
      request.user = await identityProvider.verify(token);
      next();
    } catch {
      response.status(401).json({ error: 'INVALID_ACCESS_TOKEN' });
    }
  };
}
