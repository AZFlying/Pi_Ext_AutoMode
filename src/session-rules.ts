// 会话级放行记忆：精确命令串（黑名单弹窗 [2]）+ 首 token 族（高危评估弹窗 [2]）
// 会话 = pi 进程生命周期；/reload 重导入模块即清空（会话语义，有意不持久化）

const allowed = new Set<string>();
const allowedFamilies = new Set<string>();

export function allow(command: string): void {
	allowed.add(command);
}

export function isAllowed(command: string): boolean {
	return allowed.has(command);
}

// 族 key：git 记两级 git <subcmd>，其余记首 token
export function familyKey(command: string): string {
	const [cmd, second] = command.trim().split(/\s+/);
	if (cmd === "git" && second) return `git ${second}`;
	return cmd || "";
}

export function allowFamily(command: string): void {
	const key = familyKey(command);
	if (key) allowedFamilies.add(key);
}

export function isFamilyAllowed(command: string): boolean {
	return allowedFamilies.has(familyKey(command));
}
