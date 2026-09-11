// Stands in for the real `server-only` package, which throws when imported outside a server
// component. Maintenance scripts run server modules deliberately:
//   NODE_PATH=scripts/shims pnpm exec tsx scripts/<name>.ts
module.exports = {};
