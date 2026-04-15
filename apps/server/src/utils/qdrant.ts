const COLLECTION_NAME = 'clipmind_chunks';
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

export async function ensureCollectionExists() {
  const config = getQdrantConfig();
  const res = await fetch(`${config.url}/collections/${COLLECTION_NAME}`, {
    headers: config.headers,
  });

  if (res.status === 404) {
    console.log(`[Qdrant] Initializing collection: ${COLLECTION_NAME}`);
    const createRes = await fetch(`${config.url}/collections/${COLLECTION_NAME}`, {
      method: 'PUT',
      headers: config.headers,
      body: JSON.stringify({
        vectors: { size: VECTOR_SIZE, distance: 'Cosine' }
      })
    });
    if (!createRes.ok) throw new Error(`Collection creation failed: ${await createRes.text()}`);
  }
}

export async function deleteVectorsByAssetId(assetId: string) {
  const config = getQdrantConfig();

  const res = await fetch(`${config.url}/collections/${COLLECTION_NAME}/points/delete`, {
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

export async function upsertVectors(points: { id: string, vector: number[], payload: any }[]) {
  const config = getQdrantConfig();
  await ensureCollectionExists();

  const res = await fetch(`${config.url}/collections/${COLLECTION_NAME}/points?wait=true`, {
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
