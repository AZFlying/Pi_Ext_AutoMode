import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		ctx.ui.notify("[AutoMode] loaded (T1 skeleton)", "info");
	});

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return undefined;
		const cmd = String(event.input.command ?? "");
		ctx.ui.notify(`[AutoMode] bash: ${cmd.slice(0, 80)}`, "info");
		return undefined; // T1：无条件放行
	});
}
