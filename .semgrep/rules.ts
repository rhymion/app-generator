// Test cases for .semgrep/rules.yml, checked with `semgrep --test .semgrep`.
declare const db: any;
declare const id: string;

// ruleid: prisma-unsafe-raw-query
db.$queryRawUnsafe(`SELECT * FROM t WHERE id = '${id}'`);
// ruleid: prisma-unsafe-raw-query
db.$executeRawUnsafe(`DELETE FROM t WHERE id = '${id}'`);
// ok: prisma-unsafe-raw-query
db.$queryRaw`SELECT * FROM t WHERE id = ${id}`;

// ruleid: dynamic-code-evaluation
eval(id);
// ruleid: dynamic-code-evaluation
new Function(id);
// ok: dynamic-code-evaluation
JSON.parse(id);
