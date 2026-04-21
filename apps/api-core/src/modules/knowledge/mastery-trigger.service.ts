import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Fire-and-forget trigger for the data-science service. Called by
 * assessment after an AC submission — we don't await the response and
 * we never throw: mastery rebuild is best-effort and must never block
 * the user's grading result.
 */
@Injectable()
export class MasteryTrigger {
  private readonly log = new Logger(MasteryTrigger.name);

  constructor(private readonly config: ConfigService) {}

  rebuildForUser(userId: string): void {
    const base = this.config.get<string>('app.dataScience.url');
    if (!base) return;
    const url = `${base.replace(/\/$/, '')}/v1/mastery/rebuild/${encodeURIComponent(userId)}`;
    void fetch(url, { method: 'POST' })
      .then((res) => {
        if (!res.ok) {
          this.log.warn(`mastery rebuild ${userId}: ${res.status}`);
        }
      })
      .catch((e) => {
        this.log.warn(`mastery rebuild ${userId} unreachable: ${(e as Error).message}`);
      });
  }
}
