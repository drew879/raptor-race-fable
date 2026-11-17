// Prints the layout's numbers and runs its rule checks.  Run:  node docs/level-1/check.mjs
import { build, check, stats } from './course.mjs';

const level = build();
console.log(stats(level));
for (const c of check(level)) console.log(c.ok ? 'ok  ' : 'FAIL', c.rule, '->', c.value);
console.log(level.rows.map((r) => `${r.s} ${r.kind}${r.branch ? ' (' + r.branch + ')' : ''}${r.onlyFor ? ' [find route]' : ''}`).join('\n'));
