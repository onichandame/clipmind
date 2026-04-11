const fs = require('fs');
const targetFile = 'app/routes/home.tsx';

try {
    let content = fs.readFileSync(targetFile, 'utf-8');

    // 精确锁定残留的 fetcher.submit 逻辑
    const targetRegex = /onClick=\{\(\) => fetcher\.submit\(\{ intent: "create" \}, \{ method: "post" \}\)\}/g;

    if (!targetRegex.test(content)) {
        console.error("❌ Node Patch Failed: 未在文件中找到匹配的 fetcher.submit，请检查文件状态。");
        process.exit(1);
    }

    // 执行全局替换
    content = content.replace(targetRegex, 'onClick={() => createMutation.mutate()}');
    
    fs.writeFileSync(targetFile, content);
    console.log("✅ Node 脚本执行成功：最后两处 fetcher 残留已彻底替换。");
} catch (error) {
    console.error("❌ 执行出错:", error.message);
    process.exit(1);
}
