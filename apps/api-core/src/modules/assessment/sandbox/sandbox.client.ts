import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Thin HTTP client for the sandbox-orchestrator. Kept separate from the
// submissions service so it can be mocked in unit tests and so we can swap
// the transport (HTTP → BullMQ producer) without touching the business
// logic.

// Includes 'pending' to match the Prisma enum (rows carry that status
// briefly before the orchestrator call returns). The orchestrator itself
// only emits the terminal verdicts.
export type RunnerVerdict =
  | 'pending'
  | 'ac'
  | 'wa'
  | 'tle'
  | 'mle'
  | 'ce'
  | 'ie'
  | 're';

export interface RunnerTestResult {
  test_case_id: string;
  passed: boolean;
  verdict: RunnerVerdict;
  actual_output: string;
  runtime_ms: number | null;
}

export interface RunnerResponse {
  verdict: RunnerVerdict;
  compile_error: string | null;
  stderr: string | null;
  runtime_ms: number | null;
  test_results: RunnerTestResult[];
}

export interface RunnerRequest {
  language: 'cpp' | 'c' | 'js' | 'python';
  source: string;
  test_cases: Array<{ id: string; input: string; expected_output: string }>;
}

@Injectable()
export class SandboxClient {
  private readonly log = new Logger(SandboxClient.name);

  constructor(private readonly config: ConfigService) {}

  async run(req: RunnerRequest): Promise<RunnerResponse> {
    const base = this.config.get<string>('app.sandbox.url') ?? 'http://localhost:5001';
    const url = `${base.replace(/\/$/, '')}/run`;
    const controller = new AbortController();
    // 45s is generous — worst case is 32 test cases × 5s wall = 160s, but in
    // practice compile-once flows keep this under 5s. Cap prevents stuck
    // api-core requests when the sandbox itself hangs.
    const timer = setTimeout(() => controller.abort(), 45_000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text();
        this.log.warn(`sandbox ${res.status}: ${body.slice(0, 200)}`);
        throw new InternalServerErrorException({
          code: 'sandbox_upstream_error',
          message: `sandbox returned ${res.status}`,
        });
      }
      return (await res.json()) as RunnerResponse;
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        throw new InternalServerErrorException({
          code: 'sandbox_timeout',
          message: 'sandbox-orchestrator did not respond in time',
        });
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
}
