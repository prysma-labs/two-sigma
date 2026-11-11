# twosigma

Four research chats: quant, on-chain, fundamental, and market structure. Each agent keeps its own conversation. The site at https://www.twosigma.fun/ proxies the one you pick in the sidebar.

## Start

```bash
cp web/.env.example web/.env.local
cp agent/agent.env.example agent/agent.env
```

Fill in both files. Do not commit them.

```bash
cd web && npm install && npm test && npm run dev
cd agent && npm install && npm start
```
