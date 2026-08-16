import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { classify } from "./classifier";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		ctx.ui.notify("[AutoMode] loaded (T2 classifier)", "info");
	});

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return undefined;
		const command = String(event.input.command ?? "");
		const verdict = classify(command);
		ctx.ui.notify(`[AutoMode] ${verdict.kind}: ${command.slice(0, 80)}`, "info"); // T5 移除

		if (verdict.kind !== "blacklist") return undefined; // whitelist/gray（T4 前灰色静默放行）

		if (!ctx.hasUI) {
			return { block: true, reason: `[AutoMode] 黑名单命令已阻止（无 UI）: ${verdict.rule}` };
		}
		const choice = await ctx.ui.select(
			`⚠️ 黑名单命令:\n\n  ${command}\n\n命中规则: ${verdict.rule}`,
			["放行一次", "拒绝"],
		);
		if (choice !== "放行一次") {
			return { block: true, reason: `[AutoMode] 用户拒绝（命中规则: ${verdict.rule}）` };
		}
		return undefined;
	});
}
