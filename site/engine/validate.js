// Minimal JSON Schema (2020-12 subset) validator for model.v1.json: no dependencies, browser and Node.
export function validate(schema, doc) {
  const errors = [];
  const resolve = (ref) => ref === '#' ? schema : ref.slice(2).split('/').reduce((o, k) => o[k], schema);
  const typeOk = (t, v) => ({ object: v && typeof v === 'object' && !Array.isArray(v), array: Array.isArray(v), string: typeof v === 'string',
    number: typeof v === 'number', integer: Number.isInteger(v), boolean: typeof v === 'boolean', null: v === null })[t];
  function go(s, v, path) {
    if (s.$ref) return go(resolve(s.$ref), v, path);
    const err = (m) => { errors.push(`${path || '/'}: ${m}`); return false; };
    if ('const' in s && v !== s.const) return err('const');
    if (s.enum && !s.enum.includes(v)) return err('enum ' + JSON.stringify(v));
    if (s.type) { const ts = [].concat(s.type); if (!ts.some(t => typeOk(t, v))) return err('type ' + ts); }
    if (s.oneOf) { const n = s.oneOf.filter(o => { const e = errors.length; const ok = go(o, v, path) && errors.length === e; errors.length = e; return ok; }).length; if (n !== 1) return err('oneOf'); } // a branch matches only when it adds no errors (go() keeps going after a failed `required`)
    if (s.allOf) s.allOf.forEach(o => go(o, v, path));
    if (typeof v === 'number') {
      if (s.minimum != null && v < s.minimum) err('minimum'); if (s.maximum != null && v > s.maximum) err('maximum');
      if (s.exclusiveMinimum != null && v <= s.exclusiveMinimum) err('exclusiveMinimum');
    }
    if (typeof v === 'string') {
      if (s.pattern && !new RegExp(s.pattern).test(v)) err('pattern ' + s.pattern);
      if (s.maxLength != null && v.length > s.maxLength) err('maxLength');
    }
    if (Array.isArray(v)) {
      if (s.minItems != null && v.length < s.minItems) err('minItems'); if (s.maxItems != null && v.length > s.maxItems) err('maxItems');
      (s.prefixItems || []).forEach((p, i) => i < v.length && go(p, v[i], `${path}/${i}`));
      if (s.items) v.forEach((x, i) => i >= (s.prefixItems || []).length && go(s.items, x, `${path}/${i}`));
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      (s.required || []).forEach(k => { if (!(k in v)) err('required ' + k); });
      const props = s.properties || {};
      for (const k of Object.keys(v)) {
        if (k in props) go(props[k], v[k], `${path}/${k}`);
        else if (s.additionalProperties === false) err('additional ' + k);
        else if (s.additionalProperties && typeof s.additionalProperties === 'object') go(s.additionalProperties, v[k], `${path}/${k}`);
      }
    }
    return true;
  }
  go(schema, doc, '');
  return errors;
}
