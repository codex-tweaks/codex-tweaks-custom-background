function requestTimeout(milliseconds) {
  const controller = new AbortController();
  const timeout = Math.max(1, Math.min(Number(milliseconds) || 10000, 60000));
  const timer = setTimeout(() => controller.abort(new Error("request timeout")), timeout);
  return { controller, clear: () => clearTimeout(timer) };
}

export function activate({ rpc }) {
  rpc.handle("network.request", async (parameters = {}) => {
    const url = String(parameters.url ?? "").trim();
    const method = String(parameters.method ?? "GET").toUpperCase();
    const responseType = String(parameters.responseType ?? "text");
    if (!url) throw new Error("url is required");
    if (method !== "GET" && method !== "HEAD") throw new Error("unsupported method");
    if (!["base64", "json", "text", "none"].includes(responseType)) {
      throw new Error("unsupported responseType");
    }

    const timeout = requestTimeout(parameters.timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        redirect: "follow",
        signal: timeout.controller.signal,
        headers: { "user-agent": "Codex-Tweaks/codex-custom-background" },
      });
      const contentType = response.headers.get("content-type") ?? "";
      let body = null;
      if (method !== "HEAD" && responseType !== "none") {
        if (responseType === "base64") {
          body = Buffer.from(await response.arrayBuffer()).toString("base64");
        } else if (responseType === "json") {
          body = await response.json();
        } else {
          body = await response.text();
        }
      }
      return {
        ok: response.ok,
        status: response.status,
        finalUrl: response.url,
        contentType,
        body,
      };
    } finally {
      timeout.clear();
    }
  });
}
