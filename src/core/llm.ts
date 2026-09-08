import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { z } from "zod";

/**
 * Thin OpenAI wrapper — one function, one job: a structured-output call whose
 * response is guaranteed (by the API) to match the given zod schema.
 * No framework: the pipeline is linear and every prompt lives in src/prompts.ts
 * where it can be read and graded (see DECISIONS.md D6).
 */

const DEFAULT_MODEL = "gpt-5.1";

export function modelName(): string {
  return process.env.OPENAI_MODEL || DEFAULT_MODEL;
}

// Lazy: constructed on first LLM call, not at import time — so tooling that
// only renders/scores existing reports can import this module without a key.
let _client: OpenAI | null = null;
const client = (): OpenAI => (_client ??= new OpenAI()); // reads OPENAI_API_KEY from env

export async function structuredCall<T extends z.ZodType>(opts: {
  schema: T;
  schemaName: string;
  system: string;
  user: string;
}): Promise<z.infer<T>> {
  const response = await client().responses.parse({
    model: modelName(),
    instructions: opts.system,
    input: opts.user,
    text: { format: zodTextFormat(opts.schema, opts.schemaName) },
  });

  if (!response.output_parsed) {
    throw new Error(`Model returned no parsed output (status: ${response.status})`);
  }
  return response.output_parsed as z.infer<T>;
}
