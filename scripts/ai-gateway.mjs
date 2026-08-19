// scripts/ai-gateway.mjs
// Robust AI Gateway streaming example for this repository
// - Uses the `ai` package's `streamText` helper
// - Attempts automatic fallback when VERCEL_OIDC_TOKEN is present
// - Implements retry/backoff on transient errors and graceful shutdown

import { streamText } from 'ai';

// If you're using Vercel's `vc env pull .env.local`, you'll have VERCEL_OIDC_TOKEN
// available locally. Some runtimes / libraries expect AI_API_KEY or similar env var,
// so we map it as a fallback here (safe — we don't overwrite an existing AI key).
if (!process.env.AI_API_KEY && process.env.VERCEL_OIDC_TOKEN) {
  process.env.AI_API_KEY = process.env.VERCEL_OIDC_TOKEN;
}

const DEFAULT_PROMPT = process.argv.slice(2).join(' ') || 'Explain quantum computing in simple terms.';
const MODEL = process.env.AI_MODEL || 'openai/gpt-5.5';

let abort = false;
process.on('SIGINT', () => {
  console.log('\nReceived SIGINT — attempting graceful shutdown...');
  abort = true;
});

async function streamWithRetry({ prompt, model, maxRetries = 5 }) {
  let attempt = 0;
  let lastError = null;

  while (attempt <= maxRetries && !abort) {
    attempt++;
    try {
      console.log(`\n[ai-gateway] Starting stream (model=${model}) — attempt ${attempt}/${maxRetries}`);

      const result = await streamText({ model, prompt, /* other options if required */ });

      // result.textStream is assumed to be an async iterable of text chunks
      for await (const chunk of result.textStream) {
        // If process-level abort is requested, break out early
        if (abort) {
          console.log('\n[ai-gateway] Aborted by user.');
          // If the underlying stream supports a cancel/close call, call it here (not standardized)
          if (result?.cancel) try { result.cancel(); } catch(e){}
          return;
        }
        process.stdout.write(chunk);
      }

      // Completed successfully
      console.log('\n\n[ai-gateway] Stream completed successfully.');
      return result;

    } catch (err) {
      lastError = err;
      // Log error details for debugging
      console.error('\n[ai-gateway] Stream error on attempt', attempt, err && err.message ? err.message : err);

      // If we've exhausted attempts, throw
      if (attempt >= maxRetries) break;

      // Exponential backoff with jitter
      const backoffMs = Math.min(1000 * Math.pow(2, attempt), 20000);
      const jitter = Math.floor(Math.random() * 300);
      const waitMs = backoffMs + jitter;
      console.log(`[ai-gateway] Retrying in ${Math.round(waitMs/1000)}s...`);
      await new Promise(resolve => setTimeout(resolve, waitMs));

      // continue to next attempt
    }
  }

  // If we exit loop with error
  console.error('\n[ai-gateway] Failed after retries. Last error:');
  console.error(lastError);
  throw lastError;
}

(async function main(){
  try {
    // Basic env checks
    if (!process.env.AI_API_KEY) {
      console.warn('[ai-gateway] Warning: AI_API_KEY (or VERCEL_OIDC_TOKEN) not set. If your environment uses Vercel OIDC, run `vc env pull .env.local` and ensure .env.local is loaded.');
    }

    await streamWithRetry({ prompt: DEFAULT_PROMPT, model: MODEL, maxRetries: 5 });
  } catch (e) {
    console.error('[ai-gateway] Fatal error:', e && e.message ? e.message : e);
    process.exit(1);
  }
})();
