export class CoreValidationError extends Error {
  constructor(message: string, public status = 400) { super(message); this.name = "CoreValidationError"; }
}
