// Canonical workflow guidance copy — single source of truth for all three UX states.

export const INITIAL_GREETING =
  "你好！我是 ClipMind，你的 AI 短视频编导。\n\n**请在右侧选择创作起点：**\n- **我有素材** — 上传视频素材，AI 帮你分析并生成剪辑方案\n- **我有想法** — 从创意或热点出发，AI 帮你规划完整拍摄脚本";

export const MATERIAL_MODE_FOLLOWUP =
  "好的，我们走**素材驱动**工作流！整个流程分三步：\n\n**① 上传 / 选择素材** — 在右侧点击「上传素材」或从素材库勾选你要用的片段\n**② 告诉我视频目标** — 素材准备好后，在这里说明你想做什么类型的视频（如：30 秒产品种草）\n**③ 生成剪辑方案** — AI 基于你的素材内容自动生成结构化剪辑脚本\n\n👉 **现在先去右侧上传或选择素材吧！**";

export const IDEA_MODE_FOLLOWUP =
  "好的，我们走**想法驱动**工作流！整个流程分三步：\n\n**① 描述你的创意** — 在这里告诉我想做什么（如：北京胡同美食 Vlog），我会结合今日热点生成拍摄大纲\n**② 完善大纲** — 审阅并修改右侧大纲，直到满意为止\n**③ 匹配素材 & 生成方案** — 大纲确定后，搜索素材并输出完整剪辑脚本\n\n👉 **现在告诉我你想做什么视频吧！**";

export const MATERIAL_MODE_PROMPT_CONTEXT =
  "当前项目处于【素材驱动工作流】。用户从已有素材出发进行创作。优先引导用户上传或选择素材（使用 search_assets），再根据素材内容制定创作方向和剪辑方案。若用户已选好素材但未说明目标，主动询问视频类型与时长要求。";

export const IDEA_MODE_PROMPT_CONTEXT =
  "当前项目处于【想法驱动工作流】。用户从创意或热点出发进行创作。优先引导用户描述创作概念，结合今日热点生成拍摄大纲（使用 updateOutline），再进行素材匹配。若用户尚未提供创意方向，主动从今日热点中推荐 1-2 个传播潜力较强的话题。";
