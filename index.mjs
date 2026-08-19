// index.mjs
// Minimal entry that is tolerant of multiple stream shapes from the `ai` package
import { streamText } from 'ai';

if (!process.env.AI_API_KEY && process.env.VERCEL_OIDC_TOKEN) {
  process.env.AI_API_KEY = process.env.VERCEL_OIDC_TOKEN;
}

const MODEL = process.env.AI_MODEL || 'openai/gpt-5.5';
const PROMPT = process.argv.slice(2).join(' ') || 'Explain quantum computing in simple terms.';

function isAsyncIterable(obj) {
  return obj && typeof obj[Symbol.asyncIterator] === 'function';
}

async function toAsyncIterator(result) {
  if (!result) throw new Error('No result from streamText');

  if (isAsyncIterable(result)) return result;
  if (isAsyncIterable(result.textStream)) return result.textStream;
  if (isAsyncIterable(result.stream)) return result.stream;

  // Node Readable-like
  if (result.readable && typeof result[Symbol.asyncIterator] === 'function') return result;

  // Web ReadableStream -> convert to async iterator
  if (result.body && typeof result.body.getReader === 'function') {
    const reader = result.body.getReader();
    const decoder = new TextDecoder();
    return {
      async *[Symbol.asyncIterator]() {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          yield typeof value === 'string' ? value : decoder.decode(value, { stream: true });
        }
      }
    };
  }

  // If it's a Promise that resolves to one of the above shapes
  if (typeof result.then === 'function') {
    const awaited = await result;
    return toAsyncIterator(awaited);
  }

  throw new Error('Unsupported stream shape from ai.streamText result — run diagnostics (see README).');
}

let abort = false;
process.on('SIGINT', () => {
  console.log('\n[ai] SIGINT received — shutting down gracefully...');
  abort = true;
});

(async () => {
  try {
    const result = await streamText({ model: MODEL, prompt: PROMPT });
    const it = await toAsyncIterator(result);

    for await (const chunk of it) {
      if (abort) {
        console.log('\n[ai] aborted by user');
        break;
      }
      process.stdout.write(chunk);
    }

    console.log('\n[ai] done.');
    process.exit(0);
  } catch (err) {
    console.error('[ai] fatal:', err && err.message ? err.message : err);
    process.exit(1);
  }
})();
