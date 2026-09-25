# computer-mcp

A minimal, read-only personal Computer MCP proof of concept for connecting ChatGPT (or another MCP client) to files on your own Mac.

## Security model

v0.1 exposes only two tools:

- `list_directory`
- `read_file`

There is no shell execution, write, delete, Git, browser, or arbitrary code execution. Filesystem access is denied unless `ALLOWED_DIRECTORIES` is configured. Real paths are checked to reduce symlink traversal risk.

> This is a PoC, not a hardened production remote-access service.

## 1. Install

```bash
git clone https://github.com/tubban1/computer-mcp.git
cd computer-mcp
npm install
cp .env.example .env
```

Edit `.env` and use an **absolute** directory you are comfortable exposing, for example:

```env
PORT=8787
ALLOWED_DIRECTORIES=/Users/YOUR_MAC_USERNAME/Documents/Projects
```

You can allow several roots by separating them with commas.

## 2. Run

```bash
npm run dev
```

Health check:

```bash
curl http://127.0.0.1:8787/health
```

The MCP endpoint is:

```text
http://127.0.0.1:8787/mcp
```

## 3. Test locally

Use MCP Inspector:

```bash
npx @modelcontextprotocol/inspector@latest
```

Connect it to the Streamable HTTP endpoint above and test `list_directory` before `read_file`.

## 4. Connect ChatGPT

ChatGPT cannot reach `127.0.0.1` on your Mac from the cloud. Use a supported secure HTTPS tunnel or deploy a remote bridge, then give ChatGPT the resulting HTTPS MCP endpoint.

For the first test, keep the allowed directory narrow and non-sensitive. Do not expose the MCP endpoint publicly without authentication for ongoing use.

## Next milestone

After read-only connectivity is proven:

1. add authentication;
2. add a persistent device/remote bridge if needed;
3. integrate Desktop Commander as a provider;
4. only then consider gated write/edit/terminal tools with explicit approval and audit logs.
