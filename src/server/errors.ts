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

export class ValidationError extends Error {
  readonly status = 400;
  constructor(message = "Validation error.") {
    super(message);
    this.name = "ValidationError";
  }
}

export class DuplicatePropertyError extends Error {
  readonly status = 409;
  readonly existingProperty: {
    id: string;
    societyName: string;
    flatNumber: string;
    bedroomCount: number;
    propertyType: string;
  };
  constructor(
    message: string,
    existingProperty: {
      id: string;
      societyName: string;
      flatNumber: string;
      bedroomCount: number;
      propertyType: string;
    }
  ) {
    super(message);
    this.name = "DuplicatePropertyError";
    this.existingProperty = existingProperty;
  }
}

