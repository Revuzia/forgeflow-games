import { registerHooks } from 'node:module';
registerHooks({
  resolve(specifier, context, nextResolve) {
    const r = nextResolve(specifier, context);
    if (/\/src\//.test(r.url)) process.stderr.write('IMPORT ' + (context.parentURL || '').replace(/.*\/blocktooth\//, '') + ' -> ' + r.url.replace(/.*\/blocktooth\//, '') + '\n');
    return r;
  },
});
