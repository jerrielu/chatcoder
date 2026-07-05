import { Bot } from "grammy";
import type { HandlerDeps } from "./handlers.js";
export interface CreateBotOptions extends HandlerDeps {
}
export declare function createBot(opts: CreateBotOptions): Bot;
/** Exported so tests can wire a mock Bot. */
export declare function wireBot(bot: Bot, deps: HandlerDeps): void;
export declare function formatUnexpectedError(e: unknown): string;
//# sourceMappingURL=bot.d.ts.map