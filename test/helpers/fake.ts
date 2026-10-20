import { defaults } from "../../src/config.ts";
import type { OpenCodeClient } from "../../src/adapters/opencode.ts";
export function fakeClient() {
  const config = defaults(); let sequence = 0;
  const created: Record<string, any>[] = [], prompts: Record<string, any>[] = [], interrupts: string[] = [];
  const messages = new Map<string, any[]>();
  let finish = "stop", onlyReasoning = false, outcome = "succeeded", modelChanged = false;
  let assistantError: any;
  let onPrompt: ((input: any) => Promise<void> | void) | undefined;
  let onWait: ((input: any) => Promise<void> | void) | undefined;
  const client = {
    model: { list: async () => ({ data: Object.values(config.models).map(m => ({ providerID: m.providerID, id: m.modelID, enabled: true, status: "active", variants: [{ id: "low" }] })) }) },
    session: {
      get: async ({ sessionID }: any) => ({ id: sessionID, location: { directory: "/test" }, outcome: sessionID === "parent" ? undefined : outcome }),
      create: async (input: any) => { const child = { ...input, id: `child-${created.length}` }; created.push(child); messages.set(child.id, []); return child; },
      context: async ({ sessionID }: any) => structuredClone(messages.get(sessionID) ?? []),
      prompt: async (input: any) => {
        prompts.push(input); await onPrompt?.(input);
        const id = `input-${++sequence}`; const child = created.find(s => s.id === input.sessionID)!;
        messages.get(child.id)!.push({ type: "user", id, text: input.text }, { type: "assistant", id: `assistant-${sequence}`, time: { completed: 100 }, finish,
          agent: "debater", model: { ...child.model, ...(modelChanged ? { id: "changed" } : {}) }, error: assistantError,
          content: [...(onlyReasoning ? [] : [{ type: "text", text: `reply ${sequence}` }, { type: "text", text: "final text" }]), { type: "reasoning", text: "secret reasoning" }],
        });
        return { id };
      },
      wait: async (input: any) => { await onWait?.(input); },
      interrupt: async ({ sessionID }: any) => { interrupts.push(sessionID); return { interrupted: true }; },
    },
  };
  return { client: client as unknown as OpenCodeClient, raw: client, created, prompts, interrupts, messages,
    change: (patch: { finish?: string; onlyReasoning?: boolean; outcome?: string; modelChanged?: boolean; assistantError?: any; onPrompt?: typeof onPrompt; onWait?: typeof onWait }) => {
      if (patch.finish !== undefined) finish = patch.finish;
      if (patch.onlyReasoning !== undefined) onlyReasoning = patch.onlyReasoning;
      if (patch.outcome !== undefined) outcome = patch.outcome;
      if (patch.modelChanged !== undefined) modelChanged = patch.modelChanged;
      if (patch.assistantError !== undefined) assistantError = patch.assistantError;
      if (patch.onPrompt !== undefined) onPrompt = patch.onPrompt;
      if (patch.onWait !== undefined) onWait = patch.onWait;
    },
  };
}
