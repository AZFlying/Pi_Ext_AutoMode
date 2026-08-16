import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { classify } from "./classifier";
import { allow, isAllowed } from "./session-rules";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		ctx.ui.notify("[AutoMode] loaded (T3 session-rules)", "info");
	});

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return undefined;
		const command = String(event.input.command ?? "");
		const verdict = classify(command);

		if (verdict.kind === "whitelist") return undefined;

		// 会话记忆命中（精确命令串，黑名单命令同样适用——放过的必是人工批准过的原串）
		if (isAllowed(command)) {
			ctx.ui.notify(`[AutoMode] session-allow: ${command.slice(0, 80)}`, "info");
			return undefined;
		}

		if (verdict.kind !== "blacklist") return undefined; // gray：T4 前静默放行

		if (!ctx.hasUI) {
			return { block: true, reason: `[AutoMode] 黑名单命令已阻止（无 UI）: ${verdict.rule}` };
		}
		const choice = await ctx.ui.select(
			`⚠️ 黑名单命令:\n\n  ${command}\n\n命中规则: ${verdict.rule}`,
			["放行一次", "本会话放行此命令", "拒绝"],
		);
		if (choice === "本会话放行此命令") {
			allow(command);
			return undefined;
		}
		if (choice !== "放行一次") {
			return { block: true, reason: `[AutoMode] 用户拒绝（命中规则: ${verdict.rule}）` };
		}
		return undefined;
	});
}
