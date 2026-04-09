import { useState, useRef } from "react";
import { useLoaderData, useRevalidator } from "react-router";
import { desc } from "drizzle-orm";
import { db } from "../db/client";
import { assets } from "../db/schema";

export async function loader() {
  // 从数据库倒序查询所有资产
  const allAssets = await db.select().from(assets).orderBy(desc(assets.createdAt));
  return { assets: allAssets };
}

export default function AssetsLibrary() {
  const { assets } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setIsUploading(true);
      setUploadProgress(0);

      // 1. 拿真实钥匙 (带上 contentType)
      const tokenRes = await fetch('/api/upload-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, contentType: file.type })
      });
      if (!tokenRes.ok) throw new Error('无法获取上传签名');
      const { uploadUrl, objectKey } = await tokenRes.json();

      // 2. 真实推送到 OSS
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl, true);
        xhr.setRequestHeader('Content-Type', file.type);

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setUploadProgress(Math.round((e.loaded / e.total) * 100));
          }
        };
        
        xhr.onload = () => {
          if (xhr.status === 200) resolve(true);
          else reject(new Error(`上传失败，状态码: ${xhr.status}`));
        };
        xhr.onerror = () => reject(new Error('网络错误或被 CORS 拦截'));
        xhr.send(file);
      });

      // 3. 👉 核心闭环：通知 Webhook 落盘！
      const callbackRes = await fetch('/api/oss-callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          filename: file.name, 
          objectKey: objectKey, 
          fileSize: file.size 
        })
      });
      
      if (!callbackRes.ok) throw new Error('Webhook 落盘失败');

      // 4. 通知 React Router 刷新页面数据，视频卡片会立即显示！
      revalidator.revalidate();
      
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (error: any) {
      console.error(error);
      alert(error.message || '上传过程中发生错误');
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-8 font-sans">
      <div className="flex items-center justify-between mb-8 max-w-7xl mx-auto">
        <h1 className="text-2xl font-semibold tracking-tight">全部素材 (Assets)</h1>
        <div>
          <input 
            type="file" 
            accept="video/*" 
            className="hidden" 
            ref={fileInputRef} 
            onChange={handleFileUpload} 
          />
          <button 
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="flex items-center px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white text-sm font-medium rounded-md transition-colors"
          >
            {isUploading ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                上传中 {uploadProgress}%
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
                + 上传视频
              </span>
            )}
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto">
        {assets.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-zinc-800 rounded-xl text-zinc-500">
            <svg className="w-12 h-12 mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z"></path></svg>
            <p>还没有上传任何素材。点击右上角开始沉淀你的视频底座。</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {assets.map((asset) => (
              <div key={asset.id} className="group bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden hover:border-zinc-700 transition-all duration-200">
                <div className="aspect-video bg-zinc-800 relative flex items-center justify-center">
                  <svg className="w-8 h-8 text-zinc-600 group-hover:scale-110 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                  <div className="absolute top-2 right-2">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">✅ 已就绪</span>
                  </div>
                </div>
                <div className="p-4">
                  <h3 className="text-sm font-medium text-zinc-200 truncate" title={asset.filename}>{asset.filename}</h3>
                  <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
                    <span>{(asset.fileSize / (1024 * 1024)).toFixed(2)} MB</span>
                    <span>{new Date(asset.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
