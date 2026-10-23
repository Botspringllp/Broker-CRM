import { headers } from "next/headers";
import { auth } from "./auth";
import { UserRole } from "@prisma/client";

export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor(message = "Authentication required.") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(message = "Access denied: insufficient permissions.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends Error {
  readonly status = 404;
  constructor(message = "Resource not found.") {
    super(message);
    this.name = "NotFoundError";
  }
}

export interface TenantContext {
  userId: string;
  tenantId: string;
  role: UserRole;
  user: {
    id: string;
    email: string;
    name: string;
    role: UserRole;
    tenantId: string;
    isActive: boolean;
  };
  session: {
    id: string;
    token: string;
    expiresAt: Date;
  };
}

/**
 * Retrieves the current authenticated session from request headers.
 * Resolves session and user server-side.
 */
export async function getAuthenticatedSession(customHeaders?: Headers) {
  try {
    const reqHeaders = customHeaders ?? (await headers());
    const session = await auth.api.getSession({
      headers: reqHeaders,
    });
    return session;
  } catch {
    return null;
  }
}

/**
 * Centralized Server-Side Tenant Context Resolver.
 * Resolves the authenticated user's permitted tenant membership.
 *
 * SECURITY INVARIANT:
 * Client-supplied tenant IDs (e.g. headers, query params, request body)
 * are NEVER trusted as authorization. The tenantId is resolved strictly
 * from the verified server-side session and database user record.
 */
export async function requireTenantContext(
  customHeaders?: Headers,
  options?: { allowInactive?: boolean }
): Promise<TenantContext> {
  const session = await getAuthenticatedSession(customHeaders);

  if (!session || !session.user) {
    throw new UnauthorizedError("Authentication required. Please sign in.");
  }

  const rawUser = session.user as {
    id: string;
    email: string;
    name: string;
    role?: string;
    tenantId?: string;
    isActive?: boolean;
  };

  if (!rawUser.tenantId) {
    throw new ForbiddenError("User is not associated with an authorized tenant.");
  }

  if (rawUser.isActive === false && !options?.allowInactive) {
    throw new ForbiddenError("User account is inactive. Please contact your administrator.");
  }

  const userRole = (rawUser.role as UserRole) || UserRole.TELECALLER;

  return {
    userId: rawUser.id,
    tenantId: rawUser.tenantId,
    role: userRole,
    user: {
      id: rawUser.id,
      email: rawUser.email,
      name: rawUser.name,
      role: userRole,
      tenantId: rawUser.tenantId,
      isActive: rawUser.isActive ?? true,
    },
    session: {
      id: session.session.id,
      token: session.session.token,
      expiresAt: new Date(session.session.expiresAt),
    },
  };
}

/**
 * Deny-by-default role permission assertion.
 * Ensures the authenticated user possesses one of the explicitly allowed roles.
 */
export function requireRole(context: TenantContext, allowedRoles: UserRole[]): void {
  if (!allowedRoles.includes(context.role)) {
    throw new ForbiddenError(
      `Access denied: role '${context.role}' lacks permission for this action.`
    );
  }
}

/**
 * Cross-Tenant Boundary Guard.
 * Strictly asserts that a record belongs to the user's authenticated tenant.
 * Throws NotFoundError rather than ForbiddenError to prevent record ID enumeration attacks.
 */
export function assertTenantOwnership(
  recordTenantId: string,
  contextTenantId: string,
  resourceName = "Record"
): void {
  if (recordTenantId !== contextTenantId) {
    throw new NotFoundError(`${resourceName} not found.`);
  }
}

