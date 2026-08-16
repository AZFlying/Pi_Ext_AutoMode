// 静态分类器：白/灰/黑，纯函数无副作用，规则全为常量（随手可改）
// 判定顺序：全串正则黑名单 → 复合命令拆段 → 段级黑名单/白名单，取最坏结果

export type Verdict =
	| { kind: "whitelist" }
	| { kind: "gray" }
	| { kind: "blacklist"; rule: string };

// —— 黑名单 ——

const DANGEROUS_FLAGS = /\brm\s+-{1,2}[a-zA-Z]*[rf]/; // rm 的 flag 含 r 或 f，全串扫描（含 $() 内的 rm）
const PIPE_TO_SHELL = /\|\s*(sudo\s+)?(sh|bash|zsh)\b/;
const REDIRECT_TO_DEVICE = />\s*\/dev\/(sd|nvme|vd)/;
const FORK_BOMB = /:\(\)\s*\{/;
const GIT_NO_FORCE = /(^|\s)(-f\b|--force(?![\w-]))/; // -f/--force 在任意位置；--force-with-lease 是安全变体，不拦

// git 子命令分桶（两级匹配：git <subcmd> ...）
const GIT_BLACK: Record<string, (args: string) => string | null> = {
	push: (a) => (GIT_NO_FORCE.test(a) ? "git push --force" : null),
	reset: (a) => (a.includes("--hard") ? "git reset --hard" : null),
	clean: (a) => (a.includes("-f") ? "git clean -f" : null),
	checkout: (a) => (a.startsWith("--") ? "git checkout --" : null),
	restore: () => "git restore",
	"filter-branch": () => "git filter-branch",
	rebase: () => "git rebase",
	"cherry-pick": () => "git cherry-pick",
	branch: (a) => (/(\s|^)(-D|-d|--delete)\b/.test(a) ? "git branch -D" : null),
};

// —— 白名单 ——

const READ_ONLY_CMDS = new Set([
	"ls", "cat", "head", "tail", "grep", "rg", "wc", "pwd", "echo", "test",
	"which", "file", "stat", "du", "df", "sort", "uniq", "cut", "date",
	"whoami", "id",
]);
const GIT_WHITE = new Set(["status", "diff", "log", "show", "add", "commit", "branch"]);

// 含 shell 元字符（含换行/回车——bash 的命令分隔符）→ 白名单不生效，降灰
// （ls > ~/.bashrc、cat x | sudo tee y、echo ok\nsudo x 的统一堵法）
const HAS_METACHARS = /[|<>`;&\n\r]|\$\(/;

function classifyGit(sub: string, rest: string): Verdict {
	const black = GIT_BLACK[sub];
	if (black) {
		const rule = black(rest);
		if (rule) return { kind: "blacklist", rule };
	}
	if (GIT_WHITE.has(sub)) return { kind: "whitelist" };
	return { kind: "gray" };
}

// 单段分类（段内无 && || ; | & 换行）
function classifySegment(seg: string): Verdict {
	const [cmd, ...args] = seg.trim().split(/\s+/);
	const rest = args.join(" ");
	if (!cmd) return { kind: "gray" };

	// 段级黑名单（首 token 门控）
	if (cmd === "sudo") return { kind: "blacklist", rule: "sudo" };
	if (cmd.startsWith("mkfs")) return { kind: "blacklist", rule: "mkfs" };
	if (cmd === "dd" && /of=/.test(rest)) return { kind: "blacklist", rule: "dd of=" };
	if (cmd === "chmod" && rest.includes("777")) return { kind: "blacklist", rule: "chmod 777" };

	// 白名单（仅纯命令：无 shell 元字符）
	if (!HAS_METACHARS.test(seg)) {
		if (cmd === "git" && args[0]) return classifyGit(args[0], args.slice(1).join(" "));
		if (cmd === "git") return { kind: "gray" };
		if (READ_ONLY_CMDS.has(cmd)) return { kind: "whitelist" };
	}
	return { kind: "gray" };
}

export function classify(command: string): Verdict {
	// 全串正则黑名单（必须在拆段前：拆段会吃掉 |，管道类规则就再也匹配不上了）
	if (DANGEROUS_FLAGS.test(command)) return { kind: "blacklist", rule: "rm -r/-f" };
	if (PIPE_TO_SHELL.test(command)) return { kind: "blacklist", rule: "pipe to shell" };
	if (REDIRECT_TO_DEVICE.test(command)) return { kind: "blacklist", rule: "> /dev/sd*" };
	if (FORK_BOMB.test(command)) return { kind: "blacklist", rule: "fork bomb" };

	// 复合命令拆段（&& || ; | & 换行），逐段分类取最坏结果：
	// cd x && git push --force 不能因首 token 是 cd 而溜过 git 黑桶
	const segments = command.split(/\r|\n|&&|\|\||[;|&]/).filter((s) => s.trim());
	if (segments.length === 0) return { kind: "gray" };
	let worst: Verdict = { kind: "whitelist" };
	for (const seg of segments) {
		const v = classifySegment(seg);
		if (v.kind === "blacklist") return v; // 最坏，立即返回
		if (v.kind === "gray") worst = v;
	}
	return worst;
}
