# ==========================================
# Stage 1: Base & Setup PNPM
# ==========================================
FROM node:20-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ==========================================
# Stage 2: Deployer (仅抽离依赖，不执行耗时编译)
# ==========================================
FROM base AS deployer
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json ./apps/server/
COPY packages/db/package.json ./packages/db/

RUN pnpm install --frozen-lockfile

COPY apps/server ./apps/server
COPY packages/db ./packages/db

# 利用 deploy 剥离纯净的工作区结构。
# --prod 会剔除所有 devDependencies（极大缩减体积），保留运行时依赖
# 针对 pnpm v10+ 的 Breaking Change 强制启用 --legacy 模式
RUN pnpm deploy --filter server --prod --legacy /app/out

# ==========================================
# Stage 3: Production Runner
# ==========================================
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# 最佳实践：创建非 root 专属用户
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 hono

# 在 Runner 阶段全局安装 tsx (剥离了 ts 的类型检查，仅利用 esbuild 极速转译)
RUN npm install -g tsx@4.7.1

# 拷贝部署后的纯净依赖与源码
COPY --from=deployer --chown=hono:nodejs /app/out ./

# 切换为低权限用户
USER hono

# 明确暴露的各项配置项
ENV PORT=8787
EXPOSE 8787

# 直接以 JIT 模式启动源码
CMD ["npm", "run", "start"]
