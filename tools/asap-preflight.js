const { preflight } = require('../app/asap/scope');
console.log(JSON.stringify(preflight(process.env), null, 2));
process.exitCode = preflight(process.env).ready ? 0 : 2;
