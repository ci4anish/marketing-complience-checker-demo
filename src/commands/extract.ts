export interface ExtractOptions {
  subset: string;
  out: string;
}

export async function runExtract(_opts: ExtractOptions): Promise<void> {
  throw new Error("extract: not yet implemented");
}
