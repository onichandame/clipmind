import { embedMany } from 'ai';
import { getAIProvider } from './ai';

const EMBEDDING_MODEL = "text-embedding-3-small";

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const provider = getAIProvider();
  
  const { embeddings } = await embedMany({
    model: provider.embedding(EMBEDDING_MODEL),
    values: texts,
  });
  
  return embeddings;
}
