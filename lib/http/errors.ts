/**
 * Typed upload error carrying an HTTP status, so shared upload cores can throw
 * once and both routes (map to a Response) and actions (use the message) handle
 * it uniformly.
 */
export class UploadError extends Error {
  readonly status: 400 | 403 | 404 | 409 | 413 | 415 | 422 | 500;
  constructor(
    status: 400 | 403 | 404 | 409 | 413 | 415 | 422 | 500,
    message: string,
  ) {
    super(message);
    this.name = "UploadError";
    this.status = status;
  }
}
