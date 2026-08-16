import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { classify } from "./classifier";
import { evaluate } from "./evaluator";
import { allow, allowFamily, isAllowed, isFamilyAllowed } from "./session-rules";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		ctx.ui.notify("[AutoMode] loaded (T4 evaluator)", "info");
	});

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return undefined;
		const command = String(event.input.command ?? "");
		const verdict = classify(command);

		if (verdict.kind === "whitelist") return undefined;

		// 精确命令串记忆（黑名单弹窗 [2]，人工批准过的原串）
		if (isAllowed(command)) {
			ctx.ui.notify(`[AutoMode] session-allow: ${command.slice(0, 80)}`, "info");
			return undefined;
		}

		// 黑名单：直接弹窗，不经模型
		if (verdict.kind === "blacklist") {
			return dialog(ctx, `⚠️ 黑名单命令:\n\n  ${command}\n\n命中规则: ${verdict.rule}`, command, false);
		}

		// 灰色：族记忆命中（用户在高危弹窗选过 [2] 的族）
		if (isFamilyAllowed(command)) {
			ctx.ui.notify(`[AutoMode] family-allow: ${command.slice(0, 80)}`, "info");
			return undefined;
		}

		// 模型评估（失败 fail-closed 按 high）
		const ev = await evaluate(ctx, command);
		if (ev.risk === "low") {
			ctx.ui.notify(`[AutoMode] eval:low → 放行: ${command.slice(0, 60)}`, "info");
			return undefined;
		}
		if (ev.risk === "medium") {
			ctx.ui.notify(`[AutoMode] eval:medium → 放行｜${ev.reason}`, "warning");
			return undefined;
		}

		// high（含 degraded）
		const tag = ev.degraded ? "（评估失败，按高危处理）" : "";
		return dialog(ctx, `⚠️ 高危命令${tag}:\n\n  ${command}\n\n模型理由: ${ev.reason}`, command, true);
	});
}

// 三选项弹窗；[2] 粒度：黑名单=精确串，高危评估=首 token 族
async function dialog(ctx: any, message: string, command: string, family: boolean): Promise<undefined | { block: boolean; reason: string }> {
	if (!ctx.hasUI) {
		return { block: true, reason: `[AutoMode] 高危命令已阻止（无 UI）: ${command.slice(0, 120)}` };
	}
	const choice = await ctx.ui.select(message, ["放行一次", family ? "本会话放行此类" : "本会话放行此命令", "拒绝"]);
	if (choice === "本会话放行此类") {
		allowFamily(command);
		return undefined;
	}
	if (choice === "本会话放行此命令") {
		allow(command);
		return undefined;
	}
	if (choice !== "放行一次") {
		return { block: true, reason: `[AutoMode] 用户拒绝: ${message.split("\n").pop()?.trim()}` };
	}
	return undefined;
}
