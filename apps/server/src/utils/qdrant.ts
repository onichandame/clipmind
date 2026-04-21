export const QDRANT_CHUNKS_COLLECTION = 'clipmind_chunks';
export const QDRANT_SUMMARY_COLLECTION = 'clipmind_assets_summary';
const VECTOR_SIZE = 1536; // Dimensions for text-embedding-3-small

function getQdrantConfig() {
  const url = process.env.QDRANT_URL;
  if (!url) throw new Error("QDRANT_URL environment variable is required.");

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (process.env.QDRANT_API_KEY) {
    headers['api-key'] = process.env.QDRANT_API_KEY;
  }

  return { url, headers };
}

export async function ensureCollectionExists(collectionName: string = QDRANT_CHUNKS_COLLECTION) {
  const config = getQdrantConfig();
  const res = await fetch(`${config.url}/collections/${collectionName}`, {
    headers: config.headers,
  });

  if (res.status === 404) {
    console.log(`[Qdrant] Initializing collection: ${collectionName}`);
    const createRes = await fetch(`${config.url}/collections/${collectionName}`, {
      method: 'PUT',
      headers: config.headers,
      body: JSON.stringify({
        vectors: { size: VECTOR_SIZE, distance: 'Cosine' }
      })
    });
    if (!createRes.ok) throw new Error(`Collection creation failed: ${await createRes.text()}`);
  }
}

export async function deleteVectorsByAssetId(assetId: string, collectionName: string = QDRANT_CHUNKS_COLLECTION) {
  const config = getQdrantConfig();

  const res = await fetch(`${config.url}/collections/${collectionName}/points/delete`, {
    method: 'POST',
    headers: config.headers,
    body: JSON.stringify({
      filter: {
        must: [
          { key: "assetId", match: { value: assetId } }
        ]
      }
    })
  });

  if (!res.ok) {
    throw new Error(`Qdrant Delete failed: ${await res.text()}`);
  }
}

export async function upsertVectors(points: { id: string, vector: number[], payload: any }[], collectionName: string = QDRANT_CHUNKS_COLLECTION) {
  const config = getQdrantConfig();
  await ensureCollectionExists(collectionName);

  const res = await fetch(`${config.url}/collections/${collectionName}/points?wait=true`, {
    method: 'PUT',
    headers: config.headers,
    body: JSON.stringify({
      points: points.map(p => ({
        id: p.id,
        vector: p.vector,
        payload: p.payload
      }))
    })
  });

  if (!res.ok) throw new Error(`Qdrant Upsert failed: ${await res.text()}`);
}

export async function searchVectors(queryVector: number[], topK: number = 20, collectionName: string = QDRANT_CHUNKS_COLLECTION) {
  const config = getQdrantConfig();
  // 防御性编程：强制限制最大召回量，防止撑爆大模型 Context
  const limit = Math.min(topK, 20);

  const res = await fetch(`${config.url}/collections/${collectionName}/points/search`, {
    method: 'POST',
    headers: config.headers,
    body: JSON.stringify({
      vector: queryVector,
      limit: limit,
      with_payload: true
    })
  });

  if (!res.ok) {
    throw new Error(`Qdrant Search failed: ${await res.text()}`);
  }

  const data = await res.json();
  return data.result || [];
}

// 供精搜片段使用的高级过滤查询
export async function searchVectorsWithFilter(queryVector: number[], assetIds: string[], topK: number = 20) {
  const config = getQdrantConfig();
  const limit = Math.min(topK, 20);

  const filter = assetIds.length > 0 ? {
    must: [
      { key: "assetId", match: { any: assetIds } }
    ]
  } : undefined;

  const res = await fetch(`${config.url}/collections/${QDRANT_CHUNKS_COLLECTION}/points/search`, {
    method: 'POST',
    headers: config.headers,
    body: JSON.stringify({
      vector: queryVector,
      limit: limit,
      filter: filter,
      with_payload: true
    })
  });

  if (!res.ok) {
    throw new Error(`Qdrant Filter Search failed: ${await res.text()}`);
  }

  const data = await res.json();
  return data.result || [];
}
