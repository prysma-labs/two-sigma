import assert from "node:assert/strict";
import test from "node:test";
import { agentHeaders, agentUrl } from "../lib/proxy.ts";

const env = {
  AGENT_SHARED_SECRET: "shared-secret",
  AGENT_URL_QUANT: "https://quant.example/",
  AGENT_URL_ONCHAIN: "https://onchain.example",
  AGENT_URL_FUNDAMENTAL: "https://fundamental.example",
  AGENT_URL_MARKET: "https://market.example",
};

test("the selected agent is reached on that VM", () => {
  const quant = agentUrl("quant", "/api/events", env);
  const market = agentUrl("market", "/api/messages", env);
  assert.equal(quant, "https://quant.example/api/events");
  assert.equal(market, "https://market.example/api/messages");
  assert.notEqual(quant, market);
  assert.equal(agentHeaders(env).get("authorization"), "Bearer shared-secret");
});

test("a missing secret is refused", () => {
  assert.throws(() => agentHeaders({}), /AGENT_SHARED_SECRET/);
});
