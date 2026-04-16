export let globalHotTopicsCache: string = "（系统启动中，热点数据正在拉取，请稍候）";

export const updateHotTopicsCache = (newCache: string) => {
    globalHotTopicsCache = newCache;
};
