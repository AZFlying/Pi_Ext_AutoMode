// 会话级放行记忆：精确命令串，命中即免弹窗
// 会话 = pi 进程生命周期；/reload 重导入模块即清空（会话语义，有意不持久化）

const allowed = new Set<string>();

export function allow(command: string): void {
	allowed.add(command);
}

export function isAllowed(command: string): boolean {
	return allowed.has(command);
}
