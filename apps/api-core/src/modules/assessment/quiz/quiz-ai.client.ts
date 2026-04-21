import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface QuizQuestionFromAi {
  id: string;
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
}

interface QuizGenerateResponse {
  questions: QuizQuestionFromAi[];
  model: string;
  generated_ms: number;
}

/**
 * Thin HTTP wrapper around ai-gateway's /v1/quiz/generate. The gateway
 * itself handles the DeepSeek call + JSON validation + fallback. We only
 * translate transport errors into a `ServiceUnavailableException` so the
 * controller can return a clean 503 to the client.
 */
@Injectable()
export class QuizAiClient {
  private readonly log = new Logger(QuizAiClient.name);

  constructor(private readonly config: ConfigService) {}

  async generate(input: {
    lessonTitle: string;
    lessonContent: string;
    locale: 'vi' | 'en';
    numQuestions?: number;
  }): Promise<QuizGenerateResponse> {
    const base = this.config.get<string>('app.ai.gatewayUrl') ?? 'http://localhost:5002';
    const url = `${base.replace(/\/$/, '')}/v1/quiz/generate`;

    let resp: Response;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lesson_title: input.lessonTitle,
          lesson_content: input.lessonContent,
          locale: input.locale,
          num_questions: input.numQuestions ?? 4,
        }),
        // Quiz generation is a one-shot DeepSeek call; 60s is generous.
        signal: AbortSignal.timeout(65_000),
      });
    } catch (e) {
      this.log.warn(`ai-gateway unreachable: ${(e as Error).message}`);
      throw new ServiceUnavailableException({
        code: 'quiz_gateway_unreachable',
        message: 'Quiz generation service is not available',
      });
    }

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      this.log.warn(`ai-gateway ${resp.status}: ${body.slice(0, 300)}`);
      throw new ServiceUnavailableException({
        code: 'quiz_upstream_error',
        message: `Quiz generation failed (${resp.status})`,
      });
    }

    return (await resp.json()) as QuizGenerateResponse;
  }
}
