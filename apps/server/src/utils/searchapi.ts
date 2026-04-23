import pRetry from 'p-retry';
import { serverConfig } from '../env';

const SEARCHAPI_URL = 'https://www.searchapi.io/api/v1/search';

export interface SearchResult {
  title: string;
  link: string;
  snippet: string;
}

export async function googleSearch(query: string, pageSize = 5): Promise<SearchResult[]> {
  return pRetry(
    async () => {
      const params = new URLSearchParams({
        engine: 'google',
        q: query,
        num: String(pageSize),
        api_key: serverConfig.SEARCHAPI_KEY!,
      });
      const res = await fetch(`${SEARCHAPI_URL}?${params}`);
      if (!res.ok) throw new Error(`SearchAPI ${res.status}: ${await res.text()}`);
      const data = await res.json();
      return ((data.organic_results as any[]) ?? []).map((r) => ({
        title: r.title as string,
        link: r.link as string,
        snippet: (r.snippet as string) ?? '',
      }));
    },
    { retries: 3, minTimeout: 2000, factor: 2 },
  );
}
