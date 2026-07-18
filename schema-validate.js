// schema-validate.js — a hand-written JSON Schema validator (Draft 2020-12 subset). Loaded after
// tree.js (childAccessor) and util.js (isIntegerLike); before the UI modules.
//
// Self-written because zero-dependency is a hard rule and ajv compiles schemas with new Function,
// which is the security red line. Three things this got wrong on the first pass and the review
// fixed, all encoded here:
//
//  1. Keyword policy is THREE-way, not two. Silently skipping an *assertion* keyword we don't
//     implement lets the user believe validation passed when it didn't — worse than not
//     supporting it. But treating *annotation* keywords ($schema, description, $defs, and our own
//     x-bigint/x-inferred-uncertain) as errors makes the product's own exported Schema light up
//     with false warnings in the product's own validator. So: supported / silently-ignored
//     annotations / flagged unsupported assertions.
//  2. A BigInt must satisfy BOTH "integer" and "number". The obvious `typeof v === "number" &&
//     Number.isInteger(v)` is false for a bigint, which would flag 136986234663732436n — the very
//     value this product exists for — as "not an integer". isIntegerLike handles it.
//  3. $ref needs cycle detection — and a cycle is revisiting the same (schema, value) pair, not
//     merely recursing deep. {"$ref":"#"} on a fixed value repeats the pair and is caught; a
//     linked list or a 70-level object is finite and distinct at each step, so it must pass. A
//     plain depth counter would wrongly flag the deep-but-finite case as circular.
(function (global) {
  "use strict";
  const JK = (global.JK = global.JK || {});
  const { isIntegerLike } = JK.util;
  const childAccessor = JK.tree.childAccessor;

  const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  // A cycle is revisiting the SAME (schema, value) pair through a $ref — that's going in circles
  // without consuming data. Counting total recursion instead would flag a merely-deep-but-finite
  // document (a 70-level object, a long linked list) as circular, which is wrong. So cycles are
  // caught by the visited-pair set below; this cap is only a stack-overflow backstop for
  // pathologically deep *data*, set far above any real schema.
  const MAX_REFS = 5000;

  // The keyword policy is three-way, but only ONE list is needed to implement it:
  //  · supported keywords are handled inline in walk() (type, properties, required, items, …);
  //  · annotation keywords ($schema, description, $defs, our own x-*) and genuinely unknown
  //    keywords are BOTH ignored — that's the spec's default for anything not recognised, so no
  //    whitelist is required, and it's exactly what keeps the product's own exported Schema from
  //    lighting up in the product's own validator;
  //  · only the known ASSERTION keywords we don't implement are flagged, because those change the
  //    result and skipping them silently would let "it validated" be a lie.
  // (An earlier version carried explicit SUPPORTED/ANNOTATION sets too — both were dead, never
  // read, since the default path already ignores everything outside this one list.)
  const ASSERTION_UNSUPPORTED = new Set(["allOf", "anyOf", "oneOf", "not", "if", "then", "else",
    "patternProperties", "pattern", "format", "uniqueItems", "multipleOf", "contains",
    "propertyNames", "dependentSchemas", "dependentRequired", "unevaluatedProperties", "unevaluatedItems"]);

  function validate(schema, value) {
    const errors = [];
    walk(schema, value, "", schema, [], errors);
    return { ok: errors.length === 0, errors };
  }

  function err(errors, apath, keyword, msg) { errors.push({ apath, keyword, msg }); }

  // refPath = the (schema, value) pairs reached by following $refs on the way here. Structural
  // descent (properties/items) passes it UNCHANGED — data is finite, it can't loop; only a $ref
  // extends it. Revisiting a pair already on the path is a real cycle.
  function walk(schema, value, apath, root, refPath, errors) {
    if (refPath.length > MAX_REFS) { err(errors, apath, "$ref", "schema nesting exceeded " + MAX_REFS); return; }
    if (!isObj(schema)) return; // boolean schemas / non-objects: nothing to assert here
    if (schema.$ref !== undefined) {
      const r = resolveRef(schema.$ref, root);
      if (r.error) { err(errors, apath, "$ref", r.error); return; }
      if (refPath.some((p) => p.schema === r.schema && p.value === value)) {
        err(errors, apath, "$ref", "circular $ref — this schema references itself without consuming input");
        return;
      }
      walk(r.schema, value, apath, root, refPath.concat({ schema: r.schema, value }), errors);
      // $ref siblings are ignored in 2019-09+/2020-12 for the applicators we support; keep it simple.
      return;
    }

    // flag unsupported assertion keywords once, so "it validated" can't be a lie by omission
    for (const k of Object.keys(schema)) {
      if (ASSERTION_UNSUPPORTED.has(k)) err(errors, apath, k, 'keyword "' + k + '" is not supported — this check was skipped, result may be incomplete');
    }

    if (schema.type !== undefined && !typeMatches(schema.type, value)) {
      err(errors, apath, "type", "expected " + (Array.isArray(schema.type) ? schema.type.join("/") : schema.type) + ", got " + jsonType(value));
      // wrong type: downstream keyword checks would be noise, but keep going for structure below
    }
    if (schema.enum !== undefined && !schema.enum.some((e) => deepEqual(e, value))) {
      err(errors, apath, "enum", "value is not one of the allowed options");
    }
    if (schema.const !== undefined && !deepEqual(schema.const, value)) {
      err(errors, apath, "const", "value must equal the const");
    }

    if (typeof value === "number" || typeof value === "bigint") numericChecks(schema, value, apath, errors);
    if (typeof value === "string") {
      if (schema.minLength !== undefined && value.length < schema.minLength) err(errors, apath, "minLength", "shorter than minLength " + schema.minLength);
      if (schema.maxLength !== undefined && value.length > schema.maxLength) err(errors, apath, "maxLength", "longer than maxLength " + schema.maxLength);
    }
    if (Array.isArray(value)) {
      if (schema.minItems !== undefined && value.length < schema.minItems) err(errors, apath, "minItems", "fewer than minItems " + schema.minItems);
      if (schema.maxItems !== undefined && value.length > schema.maxItems) err(errors, apath, "maxItems", "more than maxItems " + schema.maxItems);
      if (schema.items) value.forEach((el, i) => walk(schema.items, el, childAccessor(apath, i, true), root, refPath, errors));
    }
    if (isObj(value)) objectChecks(schema, value, apath, root, refPath, errors);
  }

  function objectChecks(schema, value, apath, root, refPath, errors) {
    if (Array.isArray(schema.required)) {
      for (const k of schema.required) {
        if (!Object.prototype.hasOwnProperty.call(value, k)) {
          // The missing key has no node to point at, so the error marks the object that lacks it
          // (root for a top-level miss) — that's the row the user can actually see highlighted.
          err(errors, apath, "required", 'missing required property "' + k + '"');
        }
      }
    }
    const props = schema.properties || {};
    for (const k of Object.keys(value)) {
      if (Object.prototype.hasOwnProperty.call(props, k)) {
        walk(props[k], value[k], childAccessor(apath, k, false), root, refPath, errors);
      } else if (schema.additionalProperties === false) {
        err(errors, childAccessor(apath, k, false), "additionalProperties", 'property "' + k + '" is not allowed');
      } else if (isObj(schema.additionalProperties)) {
        walk(schema.additionalProperties, value[k], childAccessor(apath, k, false), root, refPath, errors);
      }
    }
  }

  function numericChecks(schema, v, apath, errors) {
    if (schema.minimum !== undefined && lt(v, schema.minimum)) err(errors, apath, "minimum", "less than minimum " + schema.minimum);
    if (schema.maximum !== undefined && gt(v, schema.maximum)) err(errors, apath, "maximum", "greater than maximum " + schema.maximum);
    if (schema.exclusiveMinimum !== undefined && !gt(v, schema.exclusiveMinimum)) err(errors, apath, "exclusiveMinimum", "not greater than exclusiveMinimum " + schema.exclusiveMinimum);
    if (schema.exclusiveMaximum !== undefined && !lt(v, schema.exclusiveMaximum)) err(errors, apath, "exclusiveMaximum", "not less than exclusiveMaximum " + schema.exclusiveMaximum);
  }

  // Compare across BigInt/Number. When both sides are integer-like, compare as BigInt so a huge
  // exact bound isn't rounded through a float. Number() only when a float is involved. Never route
  // a bigint through Number.isInteger (returns false) — that would send the value that most needs
  // BigInt comparison into the lossy branch.
  function lt(a, b) { return (isIntegerLike(a) && isIntegerLike(b)) ? BigInt(a) < BigInt(b) : Number(a) < Number(b); }
  function gt(a, b) { return (isIntegerLike(a) && isIntegerLike(b)) ? BigInt(a) > BigInt(b) : Number(a) > Number(b); }

  function typeMatches(type, v) {
    const types = Array.isArray(type) ? type : [type];
    return types.some((t) => matchType(t, v));
  }
  function matchType(t, v) {
    switch (t) {
      case "null": return v === null;
      case "boolean": return typeof v === "boolean";
      case "string": return typeof v === "string";
      case "integer": return isIntegerLike(v);                              // bigint counts
      case "number": return typeof v === "number" || typeof v === "bigint"; // bigint counts
      case "array": return Array.isArray(v);
      case "object": return isObj(v);
      default: return false;
    }
  }
  function jsonType(v) {
    if (v === null) return "null";
    if (Array.isArray(v)) return "array";
    const t = typeof v;
    if (t === "bigint") return "integer";
    if (t === "number") return Number.isInteger(v) ? "integer" : "number";
    return t;
  }

  // Same-document $ref only. A remote $ref is refused explicitly — that's the zero-network line,
  // not a missing feature. JSON Pointer: percent-decode, then ~1 -> / and ~0 -> ~ (in that order,
  // so ~01 becomes ~1, not /).
  function resolveRef(ref, root) {
    ref = String(ref);
    if (ref[0] !== "#") return { error: 'remote $ref "' + ref + '" is refused — this viewer makes no network requests' };
    const frag = ref.slice(1);
    if (frag === "" || frag === "/") return { schema: root };
    const parts = frag.split("/").slice(1).map(decodePointer);
    let node = root;
    for (const p of parts) {
      if (node == null || typeof node !== "object") return { error: '$ref target not found: ' + ref };
      node = node[p];
    }
    if (node === undefined) return { error: '$ref target not found: ' + ref };
    return { schema: node };
  }
  function decodePointer(seg) {
    let s = seg;
    try { s = decodeURIComponent(seg); } catch { /* leave as-is on bad %-encoding */ }
    return s.replace(/~1/g, "/").replace(/~0/g, "~");
  }

  function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a === "bigint" || typeof b === "bigint") return String(a) === String(b) && typeof a === typeof b;
    if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEqual(a[k], b[k]));
  }

  JK.schema = Object.assign(JK.schema || {}, { validate });
})(typeof window !== "undefined" ? window : globalThis);
