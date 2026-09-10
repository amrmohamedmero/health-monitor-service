import type { CheckResult } from './types';

export interface AnalysisResult {
  summary: string;
  suggestions: string[];
}

export interface AnalysisContext {
  serviceName: string;
}

/**
 * Optional hook: given the run's results, return a short root-cause read
 * and next step to fold into the outgoing message. Bring your own
 * implementation and API key — this package never calls an LLM unless
 * `MonitorConfig.analysis` is set. Runner code calls this only when there's
 * at least one non-ok result, and swallows/logs any error so a broken or
 * slow analysis provider never blocks an alert from being sent.
 */
export interface AnalysisProvider {
  analyze(results: CheckResult[], context: AnalysisContext): Promise<AnalysisResult>;
}

/**
 * Ready-made provider backed by the Claude Messages API. Requires an
 * Anthropic API key (console.anthropic.com) — this package makes no
 * assumption about which LLM vendor you use; write your own AnalysisProvider
 * for OpenAI/Gemini/a local model/etc. the same way.
 */
export function anthropicAnalysisProvider(opts: {
  apiKey: string;
  model?: string;
  maxTokens?: number;
}): AnalysisProvider {
  const model = opts.model ?? 'claude-sonnet-5';
  const maxTokens = opts.maxTokens ?? 200;

  return {
    async analyze(results, context) {
      const nonOk = results.filter(r => r.status !== 'ok');
      const lines = nonOk
        .map(r => `- [${r.status.toUpperCase()}] ${r.name}: ${r.message}${r.details ? ` (${r.details})` : ''}`)
        .join('\n');

      const prompt =
        `You are an SRE assistant. A health-monitoring system for "${context.serviceName}" ` +
        `just ran and found these issues:\n\n${lines}\n\n` +
        `In under 80 words, give a likely root cause and one concrete next step. ` +
        `Be specific and concise, no preamble, no markdown headers.`;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': opts.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!response.ok) {
        throw new Error(`Analysis provider failed: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as { content: { type: string; text?: string }[] };
      const text = (data.content.find(block => block.type === 'text')?.text ?? '').trim();

      return {
        summary: text,
        suggestions: text
          .split('\n')
          .map(line => line.trim())
          .filter(Boolean),
      };
    },
  };
}
