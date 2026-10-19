/** Keep vendor result payloads for diagnosis, excluding credentials and reasoning blocks. */
export function sanitizeVendorResponse(value: unknown): unknown {
  const secrets = [
    process.env.DATAFORSEO_LOGIN,
    process.env.DATAFORSEO_PASSWORD,
    process.env.OPENAI_API_KEY,
  ].filter((v): v is string => !!v);
  const scrub = (node: unknown): unknown => {
    if (typeof node === "string")
      return secrets.reduce(
        (text, secret) => text.split(secret).join("[REDACTED]"),
        node,
      );
    if (Array.isArray(node)) return node.map(scrub);
    if (node && typeof node === "object") {
      const record = node as Record<string, unknown>;
      if (
        typeof record.type === "string" &&
        /reasoning|thinking/.test(record.type)
      )
        return null;
      return Object.fromEntries(
        Object.entries(record)
          .filter(
            ([key]) =>
              !/authorization|password|login|token|api_?key|headers|request/i.test(
                key,
              ),
          )
          .map(([key, item]) => [key, scrub(item)]),
      );
    }
    return node;
  };
  return scrub(value);
}
