import crypto from "crypto";

export class TestSession {
  private static instance: TestSession | null = null;
  private readonly sessionId: string;

  private constructor() {
    const timestamp = Date.now();
    const shortUuid = crypto.randomBytes(3).toString("hex");
    this.sessionId = `test-${timestamp}-${shortUuid}`;
  }

  public static getInstance(): TestSession {
    if (!TestSession.instance) {
      TestSession.instance = new TestSession();
    }
    return TestSession.instance;
  }

  public getSessionId(): string {
    return this.sessionId;
  }

  public getProjectName(projectName: string): string {
    return `${this.sessionId}-${projectName}`;
  }
}
