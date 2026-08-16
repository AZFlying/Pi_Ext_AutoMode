// 静态分类器：白/灰/黑，纯函数无副作用，规则全为常量（随手可改）
// 判定顺序：黑名单最优先（防 echo $(rm -rf /) 借无害首 token 溜过）

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

// git 子命令分桶（首 token 后跟子命令，两级匹配）
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

export function classify(command: string): Verdict {
	const tokens = command.trim().split(/\s+/);
	const [cmd, ...args] = tokens;
	const rest = args.join(" ");
	if (!cmd) return { kind: "gray" };

	// 黑名单（正则扫全串）
	if (DANGEROUS_FLAGS.test(command)) return { kind: "blacklist", rule: "rm -r/-f" };
	if (cmd === "sudo") return { kind: "blacklist", rule: "sudo" };
	if (cmd.startsWith("mkfs")) return { kind: "blacklist", rule: "mkfs" };
	if (cmd === "dd" && /of=/.test(rest)) return { kind: "blacklist", rule: "dd of=" };
	if (cmd === "chmod" && rest.includes("777")) return { kind: "blacklist", rule: "chmod 777" };
	if (PIPE_TO_SHELL.test(command)) return { kind: "blacklist", rule: "pipe to shell" };
	if (REDIRECT_TO_DEVICE.test(command)) return { kind: "blacklist", rule: "> /dev/sd*" };
	if (FORK_BOMB.test(command)) return { kind: "blacklist", rule: "fork bomb" };

	// 白名单（仅纯命令：无 shell 元字符）
	if (!HAS_METACHARS.test(command)) {
		if (cmd === "git" && args[0]) return classifyGit(args[0], args.slice(1).join(" "));
		if (cmd === "git" && !args[0]) return { kind: "gray" };
		if (READ_ONLY_CMDS.has(cmd)) return { kind: "whitelist" };
	}

	return { kind: "gray" };
}
