// 模型风险评估：registry.complete 调用（pi 内部解析凭据，不传 key/headers）+ 超时/重试 + JSON 解析
// 一切失败路径 fail-closed：返回 degraded high，绝不静默放行

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { EVAL_MODEL_ID, EVAL_PROVIDER, EVAL_SYSTEM_PROMPT } from "./prompts.ts";

export type EvalResult = {
	risk: "low" | "medium" | "high";
	reason: string;
	degraded: boolean; // true = 评估失败，按 high 处置
};

const TIMEOUT_MS = 15_000;

// 纯函数：从模型输出提取 JSON，失败返回 null
export function parseEvalResult(text: string): { risk: "low" | "medium" | "high"; reason: string } | null {
	const m = text.match(/\{[^{}]*\}/); // 首个 {...}（模型被要求只输出一行）
	if (!m) return null;
	try {
		const obj = JSON.parse(m[0]);
		if (obj.risk !== "low" && obj.risk !== "medium" && obj.risk !== "high") return null;
		return { risk: obj.risk, reason: String(obj.reason ?? "").slice(0, 200) || "（模型未给理由）" };
	} catch {
		return null;
	}
}

function degraded(reason: string): EvalResult {
	return { risk: "high", reason, degraded: true };
}

function callComplete(
	ctx: ExtensionContext,
	model: NonNullable<ReturnType<ExtensionContext["modelRegistry"]["find"]>>,
	command: string,
	signal: AbortSignal,
): Promise<{ text: string; stopReason?: string }> {
	return ctx.modelRegistry
		.complete(model, {
			systemPrompt: EVAL_SYSTEM_PROMPT,
			messages: [{ role: "user", content: command, timestamp: Date.now() }],
			tools: [],
		}, { signal })
		.then((msg) => ({
			text: msg.content.filter((p) => p.type === "text").map((p) => p.text).join(""),
			stopReason: msg.stopReason,
		}));
}

export async function evaluate(ctx: ExtensionContext, command: string): Promise<EvalResult> {
	const model = ctx.modelRegistry.find(EVAL_PROVIDER, EVAL_MODEL_ID);
	if (!model) return degraded(`评估模型 ${EVAL_PROVIDER}/${EVAL_MODEL_ID} 不可用`);

	for (let attempt = 1; attempt <= 2; attempt++) {
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
		try {
			const { text, stopReason } = await callComplete(ctx, model, command, ctrl.signal);
			if (stopReason === "aborted") {
				return degraded("评估调用被中断"); // 用户主动中断，不重试
			}
			if (stopReason === "error" || !text.trim()) {
				if (attempt === 2) return degraded(`评估响应异常（stopReason=${stopReason ?? "none"}）`);
				continue; // 重试一次
			}
			const parsed = parseEvalResult(text);
			if (parsed) return { ...parsed, degraded: false };
			if (attempt === 2) return degraded(`评估输出无法解析: ${text.trim().slice(0, 120)}`);
		} catch (e) {
			if (attempt === 2) return degraded(`评估调用失败: ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			clearTimeout(timer);
		}
	}
	return degraded("评估失败"); // 不可达，保险
}
