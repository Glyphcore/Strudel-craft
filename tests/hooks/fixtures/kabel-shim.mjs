// Node loader hook: @strudel/core's dist imports the browser-only audio package @kabelsalat/web (SalatRepl). Headless runs resolve it to an empty class.
// This only replaces that unrelated audio dependency; Strudel's pattern code is untouched.
export async function resolve(spec, ctx, next) {
  if (spec === '@kabelsalat/web') return { url: 'data:text/javascript,export class SalatRepl{};export default {}', shortCircuit: true };
  return next(spec, ctx);
}
