/** Strip internal admin routes from the full spec before publishing at /docs. */

const PUBLIC_PATH_PREFIXES = ["/v1/vin", "/v1/live"];

type JsonObj = Record<string, unknown>;

function collectSchemaRefs(value: unknown, refs = new Set<string>()): Set<string> {
  if (value === null || typeof value !== "object") return refs;
  if (Array.isArray(value)) {
    for (const item of value) collectSchemaRefs(item, refs);
    return refs;
  }
  for (const [key, child] of Object.entries(value as JsonObj)) {
    if (key === "$ref" && typeof child === "string") {
      const match = child.match(/^#\/components\/schemas\/(.+)$/);
      if (match) refs.add(match[1]);
    } else {
      collectSchemaRefs(child, refs);
    }
  }
  return refs;
}

export function toPublicOpenApiSpec(full: JsonObj): JsonObj {
  const allPaths = (full.paths ?? {}) as JsonObj;
  const paths: JsonObj = {};
  for (const [route, def] of Object.entries(allPaths)) {
    if (PUBLIC_PATH_PREFIXES.some((prefix) => route.startsWith(prefix))) {
      paths[route] = def;
    }
  }

  const allSchemas = ((full.components as JsonObj | undefined)?.schemas ?? {}) as JsonObj;
  const needed = new Set<string>();
  for (const def of Object.values(paths)) collectSchemaRefs(def, needed);

  let grew = true;
  while (grew) {
    grew = false;
    for (const name of [...needed]) {
      const before = needed.size;
      collectSchemaRefs(allSchemas[name], needed);
      if (needed.size > before) grew = true;
    }
  }

  const schemas: JsonObj = {};
  for (const name of needed) {
    if (allSchemas[name]) schemas[name] = allSchemas[name];
  }

  const bearer = ((full.components as JsonObj | undefined)?.securitySchemes as JsonObj | undefined)
    ?.bearerAuth as JsonObj | undefined;

  return {
    openapi: full.openapi,
    info: {
      ...(full.info as JsonObj),
      title: "GetCarAPI",
      description:
        "Client API for VIN history and Korean live inventory. " +
        "Check a VIN for free; retrieve history or live stock with your account token.",
    },
    servers: full.servers,
    tags: [
      {
        name: "vin",
        description:
          "VIN check (Bearer required, no credit) and full history retrieval (Bearer required, one credit per successful response).",
      },
      {
        name: "live",
        description:
          "Live Korean inventory from Encar, Autowini and KB ChaChaCha. Bearer token required. JSON list + single-vehicle detail.",
      },
    ],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          ...bearer,
          description:
            "API token for your account. Pass as `Authorization: Bearer <token>`. " +
            "Required for all VIN and live routes, including VIN check.",
        },
      },
      schemas,
    },
    security: [],
  };
}
