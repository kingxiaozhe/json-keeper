// schema-infer.js — infer a JSON Schema (Draft 2020-12) and a TypeScript type from a value.
// Loaded after util.js; before the UI modules.
//
// The stance, which is the moat in the type domain: inference is guessing, and every guess must
// be visible. Other tools infer an empty array as any[] and a big integer as number, and you take
// that home and step on the rake. Here the uncertain cases (only-saw-null, empty array, empty
// object, a union across samples) are annotated in the *output itself* — x-inferred-uncertain in
// the Schema, a ⚠ comment in the TypeScript — not just in the UI, because the output gets copied
// away and the UI note doesn't travel with it. Big integers are certain but annotated (x-bigint /
// bigint) so the precision jsonbig fought for isn't quietly dropped downstream.
(function (global) {
  "use strict";
  const JK = (global.JK = global.JK || {});
  const { idKey } = JK.util;

  const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const typeOf = (v) => {
    if (v === null) return "null";
    if (Array.isArray(v)) return "array";
    const t = typeof v;
    if (t === "bigint") return "bigint";
    if (t === "number") return Number.isInteger(v) ? "integer" : "number";
    return t; // string | boolean | object
  };

  // ---- infer(value) -> { schema, uncertainties:[{path, reason}] } ----

  function infer(value) {
    const unc = [];
    const schema = { $schema: "https://json-schema.org/draft/2020-12/schema", ...inferOne(value, "", unc) };
    return { schema, uncertainties: unc };
  }

  function note(unc, path, reason) { unc.push({ path: path || "(root)", reason }); }

  function inferOne(value, path, unc) {
    const t = typeOf(value);
    switch (t) {
      case "null":
        note(unc, path, "only saw null — the real type is unknown");
        return { type: "null", "x-inferred-uncertain": "only saw null — real type unknown" };
      case "bigint":
        // Certain (we know it's a big integer) but annotated so downstream keeps the precision.
        return { type: "integer", "x-bigint": true };
      case "integer": return { type: "integer" };
      case "number": return { type: "number" };
      case "boolean": return { type: "boolean" };
      case "string": return { type: "string" };
      case "array": {
        if (value.length === 0) {
          note(unc, path, "empty array — no element to infer from");
          return { type: "array", "x-inferred-uncertain": "empty array — element type unknown" };
        }
        const items = mergeMany(value.map((v, i) => inferOne(v, path + "[" + i + "]", unc)), path, unc);
        return { type: "array", items };
      }
      case "object": {
        const keys = Object.keys(value);
        if (keys.length === 0) {
          note(unc, path, "empty object — no properties to infer from");
          return { type: "object", "x-inferred-uncertain": "empty object" };
        }
        const properties = {};
        for (const k of keys) properties[k] = inferOne(value[k], childPath(path, k), unc);
        return { type: "object", properties, required: keys.slice() };
      }
    }
  }

  const childPath = (parent, key) => (idKey(key) ? (parent ? parent + "." + key : key) : parent + "[" + JSON.stringify(key) + "]");

  // Merge several schemas (the elements of an array) into one. Differing scalar types become a
  // union — which is a guess, because the sample may not be exhaustive. Objects merge property by
  // property, and required narrows to the keys every element had (missing-vs-present, the same
  // correctness line as the table's missing-vs-null).
  function mergeMany(schemas, path, unc) {
    if (schemas.length === 1) return schemas[0];
    const kinds = new Set(schemas.map((s) => baseType(s)));

    if (kinds.size === 1 && kinds.has("object")) return mergeObjects(schemas, path, unc);
    if (kinds.size === 1 && kinds.has("array")) {
      const items = schemas.map((s) => s.items).filter(Boolean);
      return { type: "array", items: items.length ? mergeMany(items, path + "[]", unc) : undefined };
    }
    // Mixed / scalar union.
    const types = [...new Set(schemas.flatMap((s) => (Array.isArray(s.type) ? s.type : [s.type])))].sort();
    const bigint = schemas.some((s) => s["x-bigint"]);
    if (types.length > 1) {
      note(unc, path, "elements have differing types (" + types.join(", ") + ") — sample may be incomplete");
      const out = { type: types, "x-inferred-uncertain": "union inferred from a sample — may be incomplete" };
      if (bigint) out["x-bigint"] = true;
      return out;
    }
    const out = { type: types[0] };
    if (bigint) out["x-bigint"] = true;
    return out;
  }

  const baseType = (s) => (Array.isArray(s.type) ? "mixed" : s.type);

  function mergeObjects(schemas, path, unc) {
    const props = {};
    const count = {};
    for (const s of schemas) {
      const p = s.properties || {};
      for (const k of Object.keys(p)) {
        count[k] = (count[k] || 0) + 1;
        props[k] = props[k] ? mergeMany([props[k], p[k]], childPath(path, k), unc) : p[k];
      }
    }
    // required = keys present in EVERY element; the rest are optional (missing in some sample).
    const required = Object.keys(count).filter((k) => count[k] === schemas.length);
    return { type: "object", properties: props, required };
  }

  // ---- toTypeScript(value, {rootName}) -> { code, uncertainties } ----
  // Reuses infer so the two never disagree about what's uncertain.

  function toTypeScript(value, opts) {
    const rootName = (opts && opts.rootName) || "Root";
    const { schema, uncertainties } = infer(value);
    const code = tsFromSchema(schema, rootName);
    return { code, uncertainties };
  }

  const TS_KEYWORDS = new Set(["null", "undefined", "any", "unknown", "never", "void", "boolean", "number", "string", "object", "bigint", "symbol"]);
  // A key becomes a bare `k:` only if it's a safe identifier; otherwise it's quoted, so a key like
  // "a-b" or "1x" or "" can't produce syntactically broken TypeScript.
  const tsKey = (k) => (idKey(k) && !TS_KEYWORDS.has(k) ? k : JSON.stringify(k));

  // Root becomes an interface; nested objects render inline. Uncertainty rides as a trailing
  // comment so it survives the copy into a .ts file.
  function tsFromSchema(schema, rootName) {
    if (baseType(schema) === "object" && schema.properties) {
      return "interface " + rootName + " " + tsObject(schema, 0);
    }
    return "type " + rootName + " = " + tsType(schema, 0) + ";";
  }

  function tsObject(schema, depth) {
    const props = schema.properties || {};
    const required = new Set(schema.required || []);
    const pad = "  ".repeat(depth + 1);
    let out = "{\n";
    for (const k of Object.keys(props)) {
      const opt = required.has(k) ? "" : "?";
      const comment = uncertaintyComment(props[k]);
      out += pad + tsKey(k) + opt + ": " + tsType(props[k], depth + 1) + ";" + comment + "\n";
    }
    return out + "  ".repeat(depth) + "}";
  }

  function tsType(schema, depth) {
    if (schema["x-bigint"]) return "bigint";
    const t = schema.type;
    if (Array.isArray(t)) return t.map((x) => tsScalar(x)).join(" | ");
    switch (t) {
      case "object":
        return schema.properties ? tsObject(schema, depth) : "Record<string, unknown>";
      case "array":
        return schema.items ? tsType(schema.items, depth) + "[]" : "unknown[]";
      default:
        return tsScalar(t);
    }
  }

  function tsScalar(t) {
    switch (t) {
      case "integer": case "number": return "number";
      case "string": return "string";
      case "boolean": return "boolean";
      case "null": return "null";
      default: return "unknown";
    }
  }

  function uncertaintyComment(schema) {
    if (schema["x-bigint"]) return "  // exact big integer — kept as bigint to preserve precision";
    const u = schema["x-inferred-uncertain"];
    return u ? "  // ⚠ " + u + " — please confirm" : "";
  }

  JK.schema = { infer, toTypeScript };
})(typeof window !== "undefined" ? window : globalThis);
