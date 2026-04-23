import FirecrawlApp from '@mendable/firecrawl-js';
import { serverConfig } from '../env';

let _client: FirecrawlApp | null = null;

function getClient(): FirecrawlApp {
  if (!_client) {
    _client = new FirecrawlApp({ apiKey: serverConfig.FIRECRAWL_API_KEY! });
  }
  return _client;
}

export async function scrapeWebpage(url: string): Promise<string | null> {
  try {
    const result = await getClient().scrapeUrl(url, {
      formats: ['markdown'],
      onlyMainContent: true,
      timeout: 30000,
    });
    return result.success ? ((result as any).markdown ?? null) : null;
  } catch {
    return null;
  }
}
