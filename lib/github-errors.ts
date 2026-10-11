export class GithubError extends Error {
  constructor(message: string, public status = 503) {
    super(message); this.name = "GithubError";
  }
}
